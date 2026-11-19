// Altas de socios (FE-05): la postulación de un comercio y su revisión por
// operaciones. La lógica, y la aprobación que crea el comercio, viven en
// `merchant-application-repository.js`.
//
// **Postularse no pide un rol.** Cualquier cuenta con sesión puede hacerlo: quien
// tiene un local suele llegar como cliente, y exigirle otro rol antes de postularse
// es pedirle el resultado para dejarlo empezar. Lo que sí se exige es la sesión: la
// solicitud queda atada a una persona a la que avisarle.
//
// **Revisar lo hace operaciones; decidir, sólo admin.** Soporte lee la cola para
// responder «¿en qué quedó mi solicitud?», pero aprobar crea un comercio y otorga un
// rol, y eso es autoridad administrativa (migración 134).
import { Router } from "express";
import { z } from "zod";

import {
  decideMerchantApplication,
  listAdminMerchantApplications,
  listMyMerchantApplications,
  MERCHANT_APPLICATION_STATUSES,
  MERCHANT_VERTICALS,
  parseApplicationCursor,
  submitMerchantApplication,
} from "../merchant-application-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { merchantApplicationLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const texto = (min, max, campo) =>
  z
    .string()
    .trim()
    .min(min, `${campo}: escribí al menos ${min} caracteres`)
    .max(max, `${campo}: hasta ${max} caracteres`);

const solicitudSchema = z.object({
  businessName: texto(2, 120, "Nombre del comercio"),
  legalName: texto(2, 160, "Razón social"),
  // Se aceptan los guiones con que se escribe un CUIT (30-12345678-9) y se guarda
  // sin ellos. El dígito verificador lo controla el repositorio.
  taxId: z
    .string()
    .trim()
    .regex(/^[0-9]{2}-?[0-9]{8}-?[0-9]$/, "El CUIT tiene 11 números")
    .transform((valor) => valor.replace(/-/g, "")),
  vertical: z.enum(MERCHANT_VERTICALS, { message: "Elegí un rubro" }),
  // E.164 de Argentina: +54 y el número sin el 0 ni el 15 (móviles con el 9).
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+54[0-9]{10,11}$/, "El teléfono va con +54 y el código de área, sin 0 ni 15"),
  address: texto(5, 240, "Dirección"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  notes: z.string().trim().max(500, "Las notas admiten 500 caracteres").optional(),
});

// El motivo es obligatorio al pedir cambios o rechazar: es lo único que le dice a la
// persona qué hacer. Mismo rango que las intervenciones de OPS-001.
const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject", "needs_changes"]),
    reason: z.string().trim().min(5).max(500).optional(),
  })
  .refine((datos) => datos.decision === "approve" || Boolean(datos.reason), {
    message: "Escribí el motivo: es lo que va a leer quien se postuló",
  });

const listadoSchema = z.object({
  status: z.enum(MERCHANT_APPLICATION_STATUSES).default("pending"),
  cursor: z.string().max(512).optional(),
});

export const applicationsRouter = Router();
const soloPostgres = (res) => fail(res, 503, "Las altas de comercios requieren PostgreSQL");

applicationsRouter.post(
  "/api/applications/merchant",
  merchantApplicationLimiter,
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(solicitudSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      res.set("Cache-Control", "no-store, private");
      const application = await submitMerchantApplication({
        userPublicId: req.auth.userId,
        input: parsed.data,
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, application });
    } catch (error) {
      return failFrom(res, error, "No se pudo enviar la solicitud");
    }
  },
);

applicationsRouter.get("/api/applications/me", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce()) return soloPostgres(res);
  try {
    // Lleva el CUIT y el teléfono de la persona: no se guarda en ningún caché.
    res.set("Cache-Control", "no-store, private");
    return ok(res, { applications: await listMyMerchantApplications(req.auth.userId) });
  } catch (error) {
    return failFrom(res, error, "No se pudieron leer tus solicitudes");
  }
});

applicationsRouter.get(
  "/api/admin/merchant-applications",
  requireAuth,
  requireAnyRole("admin", "support"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(listadoSchema, req.query || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    const cursor = parseApplicationCursor(parsed.data.cursor);
    if (cursor === false) return fail(res, 400, "Cursor inválido");
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(res, await listAdminMerchantApplications({ status: parsed.data.status, cursor }));
    } catch (error) {
      return failFrom(res, error, "No se pudieron leer las solicitudes");
    }
  },
);

applicationsRouter.post(
  "/api/admin/merchant-applications/:applicationId/decision",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(decisionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const resultado = await decideMerchantApplication({
        applicationPublicId: String(req.params.applicationId).slice(0, 64),
        decision: parsed.data.decision,
        reason: parsed.data.reason || null,
        actorPublicId: req.auth.userId,
        actorRoles: req.auth.roles,
        requestId: req.requestId,
      });
      // Quien se postuló tiene la app abierta esperando la respuesta: se entera sin
      // recargar, y si la aprobaron su sesión ya trae el rol nuevo.
      await publishRealtimeEvent({
        req,
        type: "merchant_application.updated",
        entityType: "user",
        entityId: resultado.application.applicant.id,
        action: `merchant_application.${resultado.application.status}`,
      });
      return ok(res, resultado);
    } catch (error) {
      return failFrom(res, error, "No se pudo registrar la decisión");
    }
  },
);
