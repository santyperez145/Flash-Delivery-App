// Analítica de producto: los eventos que entran y las métricas que salen
// (ticket ARC-001, paso 2).
//
// Las dos rutas son los dos extremos de un mismo caño. La aplicación deposita
// eventos; operaciones lee el agregado. Cambiar qué lleva un evento toca a las
// dos, y por eso viajan juntas.
//
// La extracción anterior había puesto `product-metrics` con los listados de
// backoffice, porque las dos son lecturas administrativas sin mutación. Ese
// parecido es de audiencia —el mismo error que este ticket viene corrigiendo en
// `/api/admin` y `/api/operations`—: un agregado sobre el caño de analítica no
// comparte nada con un listado paginado de comercios salvo quién lo mira.
//
// La ingesta responde 202 y no 201: acepta el lote y no promete haberlo
// procesado. Cualquier otra cosa ataría la interfaz del cliente a la velocidad
// del análisis.
//
// El esquema rechaza propiedades cuyo nombre sugiera dato personal —correo,
// teléfono, dirección, coordenadas, nombre, texto libre—. Es una lista negra
// sobre el nombre de la clave, así que no es una garantía: es un cepo contra el
// accidente más común, que es mandar el evento con el objeto entero adentro.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresAuth } from "../auth-repository.js";
import { getProductMetrics, ingestProductEvents } from "../product-analytics-repository.js";
import { createLocalProductEvents, getLocalProductMetrics } from "../store.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const productEventSchema = z
  .object({
    id: z.string().uuid(),
    name: z.enum([
      "home_viewed",
      "search_started",
      "merchant_viewed",
      "cart_updated",
      "checkout_started",
      "quote_received",
      "job_created",
      "activity_viewed",
    ]),
    surface: z.enum(["web", "customer_app", "driver_app", "merchant_app"]),
    sessionId: z.string().uuid(),
    occurredAt: z.string().datetime(),
    properties: z
      .record(z.string(), z.union([z.string().max(80), z.number().finite(), z.boolean(), z.null()]))
      .default({}),
  })
  .superRefine((event, ctx) => {
    const timestamp = new Date(event.occurredAt).getTime();
    if (timestamp < Date.now() - 86400000 || timestamp > Date.now() + 300000)
      ctx.addIssue({ code: "custom", message: "Fecha de analytics fuera de ventana" });
    for (const key of Object.keys(event.properties))
      if (/email|phone|address|coord|lat|lng|token|name|note|query|text/i.test(key))
        ctx.addIssue({ code: "custom", message: `Propiedad sensible no permitida: ${key}` });
  });
const productEventsSchema = z.object({ events: z.array(productEventSchema).min(1).max(20) });

export const productAnalyticsRouter = Router();
const router = productAnalyticsRouter;

router.post("/api/analytics/events", requireAuth, async (req, res) => {
  const parsed = parseOrFail(productEventsSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const result = usesPostgresAuth()
      ? await ingestProductEvents({ userPublicId: req.auth.userId, events: parsed.data.events })
      : createLocalProductEvents({ userId: req.auth.userId, events: parsed.data.events });
    return res.status(202).json({ ok: true, requestId: req.requestId, ...result });
  } catch (error) {
    return failFrom(res, error, "No se pudieron registrar los eventos");
  }
});

router.get(
  "/api/operations/product-metrics",
  requireAuth,
  requireAnyRole("admin"),
  async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    try {
      res.set("Cache-Control", "no-store, private");
      const metrics = usesPostgresAuth()
        ? await getProductMetrics({ days })
        : getLocalProductMetrics({ days });
      return ok(res, { metrics });
    } catch (error) {
      return failFrom(res, error, "No se pudieron calcular las métricas de producto");
    }
  },
);
