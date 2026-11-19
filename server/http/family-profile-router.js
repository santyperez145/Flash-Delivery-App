// Perfil familiar (PAG-05). La lógica vive en `family-profile-repository.js`; el
// cobro y los reintegros, en los repositorios de cada servicio y en
// `wallet-repository.js`.
import { Router } from "express";
import { z } from "zod";

import {
  getFamilyProfile,
  inviteFamilyMember,
  leaveFamilyProfile,
  removeFamilyMember,
  respondFamilyInvitation,
  setFamilyMemberLimit,
} from "../family-profile-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { failFromStepUp, stepUpMfa } from "./mfa-step-up.js";
import { familyProfileLimiter } from "./rate-limits.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

// Pesos enteros; `null` es sin tope. El máximo es técnico (que entre en centavos).
const tope = z
  .number()
  .int("El tope va en pesos enteros")
  .min(1000, "El tope mínimo es $1.000")
  .max(90_000_000_000_000)
  .nullable();
const invitacionSchema = z.object({
  email: z.string().trim().email("Email inválido").max(254),
  monthlyLimit: tope.optional(),
  mfaCode: z.string().trim().max(32).optional(),
});
const topeSchema = z.object({ monthlyLimit: tope, mfaCode: z.string().trim().max(32).optional() });

export const familyProfileRouter = Router();
const soloPostgres = (res) => fail(res, 503, "El perfil familiar requiere PostgreSQL");
const auditar = (req, action, entityId, afterData = {}) =>
  recordPostgresAudit({
    actorPublicId: req.auth.userId,
    roles: req.auth.roles,
    action,
    entityType: "family_profile",
    entityId,
    requestId: req.requestId,
    afterData,
  });

familyProfileRouter.get(
  "/api/me/family",
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      res.set("Cache-Control", "no-store, private");
      return ok(res, { family: await getFamilyProfile(req.auth.userId) });
    } catch (error) {
      return failFrom(res, error, "No se pudo leer el perfil familiar");
    }
  },
);

familyProfileRouter.post(
  "/api/family/members",
  familyProfileLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(invitacionSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      // Sumar a alguien le da permiso para gastar de tu Wallet: con la verificación en
      // dos pasos activa, pide el código, como comprar una tarjeta de regalo.
      await stepUpMfa(req, parsed.data.mfaCode);
      const member = await inviteFamilyMember({
        userPublicId: req.auth.userId,
        email: parsed.data.email,
        monthlyLimit: parsed.data.monthlyLimit ?? null,
      });
      await auditar(req, "family.member_invited", member.id, {
        monthlyLimit: member.monthlyLimit,
      });
      return res.status(201).json({ ok: true, requestId: req.requestId, member });
    } catch (error) {
      return failFromStepUp(res, error, "No se pudo invitar al perfil familiar");
    }
  },
);

familyProfileRouter.patch(
  "/api/family/members/:memberId",
  familyProfileLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    const parsed = parseOrFail(topeSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      // Cambiar el tope es cambiar cuánto pueden gastar de tu Wallet.
      await stepUpMfa(req, parsed.data.mfaCode);
      const member = await setFamilyMemberLimit({
        userPublicId: req.auth.userId,
        memberPublicId: req.params.memberId,
        monthlyLimit: parsed.data.monthlyLimit,
      });
      await auditar(req, "family.limit_changed", member.id, { monthlyLimit: member.monthlyLimit });
      return ok(res, { member });
    } catch (error) {
      return failFromStepUp(res, error, "No se pudo cambiar el tope");
    }
  },
);

familyProfileRouter.delete(
  "/api/family/members/:memberId",
  familyProfileLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      const member = await removeFamilyMember({
        userPublicId: req.auth.userId,
        memberPublicId: req.params.memberId,
      });
      await auditar(req, "family.member_removed", member.id);
      return ok(res, { member });
    } catch (error) {
      return failFrom(res, error, "No se pudo sacar del perfil familiar");
    }
  },
);

for (const [accion, accept] of [
  ["accept", true],
  ["decline", false],
])
  familyProfileRouter.post(
    `/api/family/invitations/:memberId/${accion}`,
    familyProfileLimiter,
    requireAuth,
    requireAnyRole("customer"),
    async (req, res) => {
      if (!usesPostgresCommerce()) return soloPostgres(res);
      try {
        const member = await respondFamilyInvitation({
          userPublicId: req.auth.userId,
          memberPublicId: req.params.memberId,
          accept,
        });
        await auditar(
          req,
          accept ? "family.invitation_accepted" : "family.invitation_declined",
          member.id,
        );
        return ok(res, { member });
      } catch (error) {
        return failFrom(res, error, "No se pudo responder la invitación");
      }
    },
  );

familyProfileRouter.post(
  "/api/family/leave",
  familyProfileLimiter,
  requireAuth,
  requireAnyRole("customer"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return soloPostgres(res);
    try {
      const member = await leaveFamilyProfile({ userPublicId: req.auth.userId });
      await auditar(req, "family.member_left", member.id);
      return ok(res, { member });
    } catch (error) {
      return failFrom(res, error, "No se pudo dejar el perfil familiar");
    }
  },
);
