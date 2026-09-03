// Credenciales y sesiones: entrar, seguir adentro y salir
// (ticket ARC-001, paso 2).
//
// Quince rutas. Doce bajo `/api/auth` y tres bajo `/api/me/sessions`, que son
// el mismo dominio con otro prefijo: la sesión que se lista y se revoca es la
// que el login creó. Es el sexto caso de ruta archivada lejos de su familia por
// cómo empieza la URL.
//
// **La sesión se entrega distinto según quién pregunta.** `deliverSession` mira
// si el pedido viene de un navegador: si viene, el refresh token va en una
// cookie `httpOnly` y se saca del cuerpo de la respuesta, de modo que ningún
// script de la página pueda leerlo. Una aplicación móvil no tiene ese problema
// —no hay DOM donde robarlo— y lo recibe en el JSON, porque no tiene dónde
// guardar una cookie de sesión.
//
// El MFA administrativo es de dos pasos y por eso hay dos tokens distintos.
// `issueMfaChallenge` firma un token de cinco minutos cuyo único propósito es
// decir «esta persona ya puso la contraseña»; sólo `mfa/complete` lo cambia por
// una sesión. Un token de acceso emitido antes del segundo factor haría que el
// segundo factor no sirviera para nada.
//
// El alta y la recuperación de contraseña responden lo mismo exista o no la
// cuenta. Distinguirlas convertiría cualquiera de las dos en un oráculo de qué
// direcciones están registradas.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";

import {
  confirmEmailVerification,
  consumePasswordRecovery,
  createPostgresSession,
  findAuthUserByEmail,
  findAuthUserByPublicId,
  getPostgresUserSessions,
  recordPostgresLoginFailure,
  recordPostgresLoginSuccess,
  registerAuthUser,
  requestPasswordRecovery,
  resendEmailVerification,
  revokeOtherPostgresSessions,
  revokeOwnedPostgresSession,
  revokePostgresSession,
  rotatePostgresSession,
  usesPostgresAuth,
} from "../auth-repository.js";
import { requireAuth } from "./authentication.js";
import { requireTrustedWebOrigin } from "./web-origin.js";
import { hasRole } from "./authorization.js";
import { config } from "../config.js";
import { audit, readDb } from "../fallback-runtime.js";
import {
  beginAdminMfaEnrollment,
  confirmAdminMfa,
  getAdminMfaStatus,
  verifyAdminMfa,
} from "../mfa-repository.js";
import { recordPostgresAudit } from "../audit-repository.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";
import {
  consumeAuthSession,
  createAuthSession,
  revokeAuthSession,
} from "../store-auth-sessions.js";
import { createId, writeDb } from "../store.js";
import { publicUser, sanitizeUser } from "../user-view.js";

const loginSchema = z.object({
  email: z.string().email("Email invalido"),
  password: z.string().min(4, "Password demasiado corto"),
  deviceName: z.string().trim().max(160).optional(),
  audience: z.enum(["customer", "driver", "merchant"]).optional(),
});

const registerSchema = z.object({
  name: z.string().min(2, "Nombre obligatorio"),
  email: z.string().email("Email invalido"),
  password: z.string().min(8, "Password minimo 8 caracteres").max(128, "Password demasiado largo"),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/, "Usa formato internacional, por ejemplo +5491112345678")
    .optional(),
  deviceName: z.string().trim().max(160).optional(),
});
const passwordRecoveryRequestSchema = z.object({
  email: z.string().email("Email inválido"),
});
const passwordRecoveryConsumeSchema = z.object({
  token: z.string().min(40).max(128),
  password: z.string().min(8, "Password mínimo 8 caracteres").max(128, "Password demasiado largo"),
});
const emailVerificationRequestSchema = z.object({
  email: z.string().email("Email inválido"),
});
const emailVerificationConfirmSchema = emailVerificationRequestSchema.extend({
  code: z.string().regex(/^\d{6}$/, "Código inválido"),
});
const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
const mfaCompleteSchema = mfaCodeSchema.extend({
  challenge: z.string().min(20),
  deviceName: z.string().trim().max(160).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(32),
  deviceName: z.string().trim().max(160).optional(),
});

function issueAccessToken(user, { mfaVerified = false } = {}) {
  return jwt.sign({ sub: user.id, roles: user.roles, mfa: mfaVerified }, jwtSecret, {
    expiresIn: "15m",
  });
}

function issueMfaChallenge(user) {
  return jwt.sign({ sub: user.id, purpose: "admin_mfa" }, jwtSecret, {
    expiresIn: "5m",
  });
}

async function issueSession(user, deviceName, { mfaVerified = false } = {}) {
  const session = usesPostgresAuth()
    ? await createPostgresSession(user, deviceName)
    : createAuthSession(user.id, deviceName);
  return {
    token: issueAccessToken(user, { mfaVerified }),
    refreshToken: session.refreshToken,
    refreshExpiresAt: session.expiresAt,
  };
}

const refreshCookieName = config.isProduction ? "__Host-flash_refresh" : "flash_refresh";
function isWebSessionRequest(req) {
  return req.get("x-flash-client") === "web";
}
function readRefreshCookie(req) {
  if (!isWebSessionRequest(req)) return "";
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== refreshCookieName) continue;
    try {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}
function setRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie(refreshCookieName, refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: config.isProduction ? "/" : "/api",
    expires: new Date(expiresAt),
  });
}
function clearRefreshCookie(res) {
  res.clearCookie(refreshCookieName, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    path: config.isProduction ? "/" : "/api",
  });
}
function deliverSession(req, res, session) {
  if (!isWebSessionRequest(req)) return session;
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  const { refreshToken: _refreshToken, ...publicSession } = session;
  return publicSession;
}

const requireAdminIdentity = (req, res, next) =>
  hasRole(req, "admin") ? next() : fail(res, 403, "MFA administrativo requiere rol admin");

const jwtSecret = config.jwtSecret;

export const authRouter = Router();
const router = authRouter;

router.post("/api/auth/login", async (req, res) => {
  const parsed = parseOrFail(loginSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { email, password } = parsed.data;
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? await findAuthUserByEmail(email)
    : db.users.find(
        (entry) =>
          entry.email.toLowerCase() ===
          String(email || "")
            .trim()
            .toLowerCase(),
      );
  const passwordMatches = bcrypt.compareSync(
    password,
    user?.password || "$2b$10$qJvN1MRgLJYlRirjP6N7ruoJc0mKlf2klq7iW03DIdDgV7gKDCl7.",
  );
  const accountLocked = Boolean(
    user?.loginLockedUntil && new Date(user.loginLockedUntil) > new Date(),
  );
  if (!user || accountLocked || !passwordMatches) {
    if (usesPostgresAuth() && user && !accountLocked) await recordPostgresLoginFailure(email);
    return fail(res, 401, "Credenciales invalidas");
  }
  if (usesPostgresAuth() && !user.emailVerifiedAt)
    return res.status(403).json({
      ok: false,
      requestId: req.requestId,
      message: "Debes verificar tu email",
      verificationRequired: true,
      email: user.email,
    });
  if (parsed.data.audience && !user.roles?.includes(parsed.data.audience)) {
    const productName =
      parsed.data.audience === "driver"
        ? "Flash Driver"
        : parsed.data.audience === "merchant"
          ? "Flash Negocios"
          : "Flash";
    return fail(res, 403, `Esta cuenta no pertenece a ${productName}`);
  }
  if (usesPostgresAuth()) await recordPostgresLoginSuccess(user.id);
  if (
    usesPostgresAuth() &&
    user.roles?.includes("admin") &&
    (await getAdminMfaStatus(user.id)).enabled
  ) {
    return ok(res, {
      user: sanitizeUser(user),
      mfaRequired: true,
      mfaChallenge: issueMfaChallenge(user),
    });
  }
  return ok(res, {
    user: usesPostgresAuth() ? sanitizeUser(user) : publicUser(db, user.id),
    ...deliverSession(
      req,
      res,
      await issueSession(user, parsed.data.deviceName || req.get("user-agent") || "unknown"),
    ),
  });
});

router.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
  if (!hasRole(req, "admin")) return fail(res, 403, "MFA administrativo requiere rol admin");
  return ok(res, { mfa: await getAdminMfaStatus(req.auth.userId) });
});

router.post("/api/auth/mfa/enroll", requireAuth, requireAdminIdentity, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "MFA real requiere PostgreSQL");
  try {
    const enrollment = await beginAdminMfaEnrollment({
      userPublicId: req.auth.userId,
      email: req.auth.user.email,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "admin.mfa_enrollment_started",
      entityType: "user",
      entityId: req.auth.userId,
      requestId: req.requestId,
    });
    return ok(res, { enrollment });
  } catch (error) {
    return failFrom(res, error, "No se pudo iniciar MFA");
  }
});

router.post("/api/auth/mfa/confirm", requireAuth, requireAdminIdentity, async (req, res) => {
  const parsed = parseOrFail(mfaCodeSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const mfa = await confirmAdminMfa({
      userPublicId: req.auth.userId,
      code: parsed.data.code,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "admin.mfa_enabled",
      entityType: "user",
      entityId: req.auth.userId,
      requestId: req.requestId,
    });
    return ok(res, {
      mfa,
      ...deliverSession(
        req,
        res,
        await issueSession(
          req.auth.user,
          req.body?.deviceName || req.get("user-agent") || "unknown",
          { mfaVerified: true },
        ),
      ),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo confirmar MFA");
  }
});

router.post("/api/auth/mfa/complete", async (req, res) => {
  const parsed = parseOrFail(mfaCompleteSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const challenge = jwt.verify(parsed.data.challenge, jwtSecret);
    if (challenge.purpose !== "admin_mfa") return fail(res, 401, "Desafío MFA inválido");
    const user = await findAuthUserByPublicId(challenge.sub);
    if (!user?.roles?.includes("admin")) return fail(res, 401, "Desafío MFA inválido");
    const verification = await verifyAdminMfa({
      userPublicId: user.id,
      code: parsed.data.code,
    });
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: user.roles,
      action: verification.recoveryCodeUsed ? "admin.mfa_recovery_used" : "admin.mfa_verified",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
    });
    return ok(res, {
      user: sanitizeUser(user),
      verification,
      ...deliverSession(
        req,
        res,
        await issueSession(user, parsed.data.deviceName || req.get("user-agent") || "unknown", {
          mfaVerified: true,
        }),
      ),
    });
  } catch (error) {
    // Un desafío vencido o mal firmado es un error del cliente y se le dice cuál
    // de los dos; cualquier otra falla es interna y no describe su causa.
    const jwtInvalido = { status: 401, message: "Desafío MFA inválido" };
    const jwtVencido = { status: 401, message: "Desafío MFA expirado" };
    return failFrom(
      res,
      error.name === "TokenExpiredError"
        ? jwtVencido
        : error.name === "JsonWebTokenError"
          ? jwtInvalido
          : error,
      "No se pudo verificar MFA",
    );
  }
});

router.post("/api/auth/refresh", async (req, res) => {
  const parsed = parseOrFail(refreshSchema, {
    ...(req.body || {}),
    refreshToken: req.body?.refreshToken || readRefreshCookie(req),
  });
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const rotated = usesPostgresAuth()
    ? await rotatePostgresSession(
        parsed.data.refreshToken,
        parsed.data.deviceName || req.get("user-agent") || "unknown",
      )
    : consumeAuthSession(
        parsed.data.refreshToken,
        parsed.data.deviceName || req.get("user-agent") || "unknown",
      );
  if (!rotated) return fail(res, 401, "Sesion expirada o revocada");
  const db = usesPostgresAuth() ? null : readDb();
  const user = usesPostgresAuth()
    ? rotated.user
    : db.users.find((entry) => entry.id === rotated.userId);
  if (!user) return fail(res, 401, "Usuario no existe");
  if (
    usesPostgresAuth() &&
    user.roles?.includes("admin") &&
    (await getAdminMfaStatus(user.id)).enabled
  ) {
    await revokePostgresSession(rotated.refreshToken);
    if (isWebSessionRequest(req)) clearRefreshCookie(res);
    return ok(res, {
      user: sanitizeUser(user),
      mfaRequired: true,
      mfaChallenge: issueMfaChallenge(user),
    });
  }
  return ok(res, {
    user: usesPostgresAuth() ? sanitizeUser(user) : publicUser(db, user.id),
    token: issueAccessToken(user),
    ...deliverSession(req, res, {
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt,
    }),
  });
});

router.post("/api/auth/logout", async (req, res) => {
  const parsed = parseOrFail(refreshSchema.pick({ refreshToken: true }), {
    ...(req.body || {}),
    refreshToken: req.body?.refreshToken || readRefreshCookie(req),
  });
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (usesPostgresAuth()) await revokePostgresSession(parsed.data.refreshToken);
  else revokeAuthSession(parsed.data.refreshToken);
  if (isWebSessionRequest(req)) clearRefreshCookie(res);
  return ok(res, { loggedOut: true });
});
router.get("/api/me/sessions", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return ok(res, { sessions: [] });
  try {
    res.set("Cache-Control", "no-store, private");
    return ok(res, { sessions: await getPostgresUserSessions(req.auth.userId) });
  } catch (error) {
    return failFrom(res, error, "No se pudieron cargar las sesiones");
  }
});
router.delete("/api/me/sessions/:sessionId", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) return fail(res, 503, "El cierre remoto requiere PostgreSQL");
  try {
    const result = await revokeOwnedPostgresSession({
      userPublicId: req.auth.userId,
      sessionPublicId: req.params.sessionId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "auth.session_revoked",
      entityType: "refresh_session",
      entityId: req.params.sessionId,
      requestId: req.requestId,
    });
    return ok(res, result);
  } catch (error) {
    return failFrom(res, error, "No se pudo cerrar la sesión");
  }
});
router.post(
  "/api/me/sessions/revoke-others",
  requireTrustedWebOrigin,
  requireAuth,
  async (req, res) => {
    const parsed = parseOrFail(refreshSchema.pick({ refreshToken: true }), {
      ...(req.body || {}),
      refreshToken: req.body?.refreshToken || readRefreshCookie(req),
    });
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!usesPostgresAuth()) return fail(res, 503, "El cierre remoto requiere PostgreSQL");
    try {
      const result = await revokeOtherPostgresSessions({
        userPublicId: req.auth.userId,
        currentRefreshToken: parsed.data.refreshToken,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "auth.other_sessions_revoked",
        entityType: "user",
        entityId: req.auth.userId,
        requestId: req.requestId,
        afterData: result,
      });
      return ok(res, result);
    } catch (error) {
      return failFrom(res, error, "No se pudieron cerrar las demás sesiones");
    }
  },
);

router.post("/api/auth/password-recovery/request", async (req, res) => {
  const parsed = parseOrFail(passwordRecoveryRequestSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const fingerprint = crypto
        .createHmac("sha256", jwtSecret)
        .update(`${req.ip || ""}|${req.get("user-agent") || ""}`)
        .digest("hex"),
      recovery = await requestPasswordRecovery({
        email: parsed.data.email,
        requesterFingerprintHash: fingerprint,
      });
    return ok(res, {
      message: "Si la cuenta existe, enviamos las instrucciones de recuperación.",
      ...(!config.isProduction && recovery
        ? { developmentToken: recovery.token, expiresAt: recovery.expiresAt }
        : {}),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudo procesar la recuperación");
  }
});
router.post("/api/auth/password-recovery/confirm", async (req, res) => {
  const parsed = parseOrFail(passwordRecoveryConsumeSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const result = await consumePasswordRecovery({
      token: parsed.data.token,
      password: parsed.data.password,
    });
    return ok(res, {
      passwordChanged: true,
      revokedSessions: result.revokedSessions,
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo cambiar la contraseña");
  }
});
router.post("/api/auth/email-verification/resend", async (req, res) => {
  const parsed = parseOrFail(emailVerificationRequestSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const challenge = await resendEmailVerification(parsed.data.email);
    return ok(res, {
      message: "Si la cuenta está pendiente, enviamos un código nuevo.",
      ...(!config.isProduction && challenge
        ? { developmentCode: challenge.code, expiresAt: challenge.expiresAt }
        : {}),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudo reenviar el código");
  }
});
router.post("/api/auth/email-verification/confirm", async (req, res) => {
  const parsed = parseOrFail(emailVerificationConfirmSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const user = await confirmEmailVerification(parsed.data);
    return ok(res, { verified: true, user: sanitizeUser(user) });
  } catch (error) {
    return failFrom(res, error, "No se pudo verificar el email");
  }
});

router.post("/api/auth/register", async (req, res) => {
  const parsed = parseOrFail(registerSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  const { name, email, password, phone } = parsed.data;
  const db = usesPostgresAuth() ? null : readDb();
  const exists = usesPostgresAuth()
    ? await findAuthUserByEmail(email)
    : db.users.some((entry) => entry.email.toLowerCase() === String(email).trim().toLowerCase());
  if (exists) return fail(res, 409, "Ese email ya existe");
  let user = {
    id: createId("USR"),
    name: String(name),
    email: String(email).trim().toLowerCase(),
    password: bcrypt.hashSync(String(password), 10),
    roles: ["customer"],
    phone: String(phone || ""),
    wallet: 0,
    defaultAddress: "",
  };
  if (usesPostgresAuth()) {
    user = await registerAuthUser({
      publicId: user.id,
      name: user.name,
      email: user.email,
      passwordHash: user.password,
      phone: user.phone,
    });
  } else {
    db.users.push(user);
  }
  const verificationCode = user.verificationCode;
  delete user.verificationCode;
  if (usesPostgresAuth())
    await recordPostgresAudit({
      actorPublicId: user.id,
      roles: user.roles,
      action: "user.registered",
      entityType: "user",
      entityId: user.id,
      requestId: req.requestId,
      afterData: { email: user.email },
    });
  else {
    audit(db, { auth: { userId: user.id } }, "user", user.id, "user.registered", {
      email: user.email,
    });
    writeDb(db);
  }
  if (usesPostgresAuth())
    return ok(res, {
      user: sanitizeUser(user),
      verificationRequired: true,
      ...(!config.isProduction
        ? {
            developmentCode: verificationCode.code,
            expiresAt: verificationCode.expiresAt,
          }
        : {}),
    });
  return ok(res, {
    user: publicUser(db, user.id),
    ...deliverSession(
      req,
      res,
      await issueSession(user, req.body?.deviceName || req.get("user-agent") || "unknown"),
    ),
  });
});
