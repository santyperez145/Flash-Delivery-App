// Dividir la tarifa de un viaje (PAG-02). La lógica y el dinero viven en
// `ride-fare-split-repository.js`.
import { Router } from "express";
import { z } from "zod";

import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import {
  inviteToSplitFare,
  listMyFareSplitInvitations,
  listRideFareSplits,
  respondToFareSplit,
} from "../ride-fare-split-repository.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fareSplitLimiter } from "./rate-limits.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const invitacionSchema = z.object({ email: z.string().trim().email("Email inválido").max(254) });

export const rideFareSplitRouter = Router();
const soloPostgres = (res) => fail(res, 503, "Dividir la tarifa requiere PostgreSQL");

rideFareSplitRouter.post(
  "/api/rides/:rideId/splits",
  // La respuesta dice si un email tiene cuenta: el límite evita usarla para averiguarlo.
  fareSplitLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(invitacionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const split = await inviteToSplitFare({
        ridePublicId: req.params.rideId,
        userPublicId: req.auth.userId,
        email: parsed.data.email,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "ride.fare_split_invited",
        entityType: "ride",
        entityId: req.params.rideId,
        requestId: req.requestId,
        afterData: { splitId: split.id },
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, split });
    } catch (error) {
      return failFrom(res, error, "No se pudo invitar a dividir la tarifa");
    }
  },
);

rideFareSplitRouter.get(
  "/api/rides/:rideId/splits",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(res, {
        splits: await listRideFareSplits({
          ridePublicId: req.params.rideId,
          userPublicId: req.auth.userId,
        }),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo leer la división de la tarifa");
    }
  },
);

rideFareSplitRouter.get(
  "/api/me/fare-split-invitations",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(res, { invitations: await listMyFareSplitInvitations(req.auth.userId) });
    } catch (error) {
      return failFrom(res, error, "No se pudieron leer las invitaciones");
    }
  },
);

for (const [accion, accept] of [
  ["accept", true],
  ["decline", false],
])
  rideFareSplitRouter.post(
    `/api/ride-splits/:splitId/${accion}`,
    fareSplitLimiter,
    requireAuth,
    requireAnyRole("customer"),
    async (req, res) => {
      if (!usesPostgresCommerce()) return soloPostgres(res);
      try {
        const split = await respondToFareSplit({
          splitPublicId: req.params.splitId,
          userPublicId: req.auth.userId,
          accept,
        });
        await recordPostgresAudit({
          actorPublicId: req.auth.userId,
          roles: req.auth.roles,
          action: accept ? "ride.fare_split_accepted" : "ride.fare_split_declined",
          entityType: "ride",
          entityId: split.rideId,
          requestId: req.requestId,
          afterData: { splitId: split.id, status: split.status },
        });
        await publishRealtimeEvent({
          req,
          type: "ride.split",
          entityType: "ride",
          entityId: split.rideId,
          action: `ride.fare_split_${split.status}`,
        });
        return ok(res, { split });
      } catch (error) {
        return failFrom(res, error, "No se pudo responder la invitación");
      }
    },
  );
