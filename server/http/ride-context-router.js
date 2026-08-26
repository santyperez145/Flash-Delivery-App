// Contexto de viaje del pasajero (ticket ARC-001, paso 7).
//
// Décimo grupo de rutas extraído de `server/index.js`. Los dos subgrupos son las
// dos cosas que un pasajero guarda antes de viajar: **a dónde suele ir, y quién
// tiene que enterarse de que salió**. Comparten dueño, ciclo de vida y política
// de privacidad, y ninguno tiene sentido para otro rol.
//
// Los dos guardan datos sensibles por motivos distintos y por eso se auditan:
// un destino frecuente revela dónde vive o trabaja alguien, y un contacto de
// confianza es el teléfono de un tercero que no usa la plataforma.
//
// Ambos son sólo PostgreSQL: el fallback SQLite no modela ninguno de los dos.
import { Router } from "express";
import { z } from "zod";

import {
  deletePostgresRideDestination,
  getPostgresRideDestinations,
  recordPostgresRideDestination,
} from "../destination-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import {
  createPostgresTrustedContact,
  deletePostgresTrustedContact,
  getPostgresTrustedContacts,
} from "../trusted-contact-repository.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const rideDestinationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().min(3).max(240),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// El teléfono se exige en formato internacional: un contacto de confianza sin
// prefijo de país es inútil justo cuando hace falta.
const trustedContactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  relationship: z.enum(["family", "friend", "partner", "coworker", "other"]),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678"),
});

export const rideContextRouter = Router();
const router = rideContextRouter;

router.get(
  "/api/ride-destinations",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        destinations: await getPostgresRideDestinations(req.auth.userId),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudieron cargar los destinos recientes");
    }
  },
);
router.post(
  "/api/ride-destinations",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(rideDestinationSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const destination = await recordPostgresRideDestination({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      return res.status(201).json({
        ok: true,
        requestId: req.requestId,
        destination,
        destinations: await getPostgresRideDestinations(req.auth.userId),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar el destino reciente");
    }
  },
);
router.delete(
  "/api/ride-destinations/:destinationId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const destinations = await deletePostgresRideDestination({
        userPublicId: req.auth.userId,
        destinationId: req.params.destinationId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride_destination.deleted",
        entityType: "ride_destination",
        entityId: req.params.destinationId,
        requestId: req.requestId,
      });
      return ok(res, { deleted: true, destinations });
    } catch (error) {
      return failFrom(
        res,
        // Un uuid mal formado no es una falla del servidor: el recurso no existe.
        error.code === "22P02" ? { status: 404, message: "Destino reciente no encontrado" } : error,
        "No se pudo eliminar el destino",
      );
    }
  },
);
router.get(
  "/api/ride-trusted-contacts",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      return ok(res, {
        contacts: await getPostgresTrustedContacts(req.auth.userId),
      });
    } catch (_error) {
      return fail(res, 500, "No se pudieron cargar los contactos de confianza");
    }
  },
);
router.post(
  "/api/ride-trusted-contacts",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(trustedContactSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const contact = await createPostgresTrustedContact({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride_trusted_contact.created",
        entityType: "ride_trusted_contact",
        entityId: contact.id,
        requestId: req.requestId,
        afterData: { relationship: contact.relationship, last4: contact.last4 },
      });
      return res.status(201).json({
        ok: true,
        requestId: req.requestId,
        contact,
        contacts: await getPostgresTrustedContacts(req.auth.userId),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar el contacto de confianza");
    }
  },
);
router.delete(
  "/api/ride-trusted-contacts/:contactId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      const contacts = await deletePostgresTrustedContact({
        userPublicId: req.auth.userId,
        contactId: req.params.contactId,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride_trusted_contact.deleted",
        entityType: "ride_trusted_contact",
        entityId: req.params.contactId,
        requestId: req.requestId,
      });
      return ok(res, { deleted: true, contacts });
    } catch (error) {
      return failFrom(
        res,
        // Un uuid mal formado no es una falla del servidor: el recurso no existe.
        error.code === "22P02"
          ? { status: 404, message: "Contacto de confianza no encontrado" }
          : error,
        "No se pudo eliminar el contacto",
      );
    }
  },
);
