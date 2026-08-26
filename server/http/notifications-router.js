// Notificaciones, preferencias y dispositivos (ticket ARC-001, paso 6).
//
// Cuarto grupo de rutas extraído de `server/index.js`, y el primero desde que el
// núcleo compartido quedó completo: el archivo no recibe nada por parámetro, sólo
// importa lo que usa. Eso es todo lo que cambió respecto de los pasos 3 y 4, y es
// exactamente lo que buscaban.
//
// Los tres subgrupos viajan juntos porque son un solo dominio visto de punta a
// punta: **qué se te notifica** (preferencias), **qué se te notificó**
// (notificaciones) y **a dónde se entrega** (dispositivos). Separar el token de
// dispositivo de la preferencia que decide si se usa dejaría dos archivos que
// nadie puede leer por separado.
//
// La huella de dispositivo se guarda como HMAC, nunca en claro: identifica al
// aparato para revocarlo sin que la base contenga con qué rastrearlo.
import crypto from "node:crypto";

import { Router } from "express";
import { z } from "zod";

import { auditRuntime } from "../audit-trail.js";
import { usesPostgresCommerce } from "../commerce-repository.js";
import { config } from "../config.js";
import { readDb } from "../fallback-runtime.js";
import {
  getPostgresDevices,
  getPostgresNotificationPreferences,
  registerPostgresDevice,
  revokePostgresDevice,
  updatePostgresNotificationPreference,
} from "../notification-repository.js";
import {
  getPostgresNotifications,
  markPostgresNotificationRead,
  recordPostgresAudit,
} from "../operations-repository.js";
import {
  getLocalNotificationPreferences,
  getLocalNotifications,
  markLocalNotificationRead,
  updateLocalNotificationPreference,
} from "../store.js";
import { requireAuth } from "./authentication.js";
import { fail, ok, parseOrFail } from "./responses.js";

// Las cinco categorías que un usuario puede silenciar por separado. Es una lista
// cerrada a propósito: una categoría nueva exige decidir su valor por omisión, y
// aceptar cualquier string dejaría preferencias que no apagan nada.
const CATEGORIAS = ["service_updates", "promotions", "support", "wallet", "account"];

const deviceSchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  pushToken: z.string().trim().min(16).max(512),
  appVersion: z.string().trim().max(40).optional(),
  deviceFingerprint: z.string().trim().min(8).max(256),
});

const notificationPreferenceSchema = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
});

export const notificationsRouter = Router();

notificationsRouter.get("/api/notifications", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce())
    return ok(res, { notifications: getLocalNotifications(req.auth.userId) });
  try {
    return ok(res, {
      notifications: await getPostgresNotifications(req.auth.userId),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las notificaciones");
  }
});
notificationsRouter.patch(
  "/api/notifications/:notificationId/read",
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce()) {
      try {
        return ok(res, {
          notifications: markLocalNotificationRead({
            userId: req.auth.userId,
            notificationId: req.params.notificationId,
          }),
        });
      } catch (error) {
        return fail(res, error.status || 500, error.message || "No se pudo marcar la notificación");
      }
    }
    try {
      return ok(res, {
        notifications: await markPostgresNotificationRead({
          publicId: req.params.notificationId,
          userPublicId: req.auth.userId,
        }),
      });
    } catch (error) {
      return fail(res, error.status || 500, error.message || "No se pudo marcar la notificación");
    }
  },
);
notificationsRouter.get("/api/notification-preferences", requireAuth, async (req, res) => {
  if (!usesPostgresCommerce())
    return ok(res, { preferences: getLocalNotificationPreferences(req.auth.userId) });
  try {
    return ok(res, {
      preferences: await getPostgresNotificationPreferences(req.auth.userId),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar las preferencias");
  }
});
notificationsRouter.patch(
  "/api/notification-preferences/:category",
  requireAuth,
  async (req, res) => {
    const category = String(req.params.category);
    if (!CATEGORIAS.includes(category)) return fail(res, 400, "Categoría inválida");
    const parsed = parseOrFail(notificationPreferenceSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    if (!usesPostgresCommerce()) {
      const preferences = updateLocalNotificationPreference({
        userId: req.auth.userId,
        category,
        ...parsed.data,
      });
      await auditRuntime(
        readDb(),
        req,
        "notification_preference",
        category,
        "notification_preference.updated",
        parsed.data,
      );
      return ok(res, {
        preferences,
      });
    }
    try {
      const preferences = await updatePostgresNotificationPreference({
        userPublicId: req.auth.userId,
        category,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "notification_preference.updated",
        entityType: "notification_preference",
        entityId: category,
        requestId: req.requestId,
        afterData: parsed.data,
      });
      return ok(res, { preferences });
    } catch (error) {
      return fail(
        res,
        error.status || 500,
        error.message || "No se pudo actualizar la preferencia",
      );
    }
  },
);
notificationsRouter.get("/api/devices", requireAuth, async (req, res) => {
  try {
    return ok(res, { devices: await getPostgresDevices(req.auth.userId) });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar los dispositivos");
  }
});
notificationsRouter.post("/api/devices", requireAuth, async (req, res) => {
  const parsed = parseOrFail(deviceSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const fingerprint = crypto
        .createHmac("sha256", config.jwtSecret)
        .update(parsed.data.deviceFingerprint)
        .digest("hex"),
      device = await registerPostgresDevice({
        userPublicId: req.auth.userId,
        platform: parsed.data.platform,
        pushToken: parsed.data.pushToken,
        appVersion: parsed.data.appVersion,
        fingerprint,
      });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "device.registered",
      entityType: "user_device",
      entityId: device.id,
      requestId: req.requestId,
      afterData: { platform: device.platform, appVersion: device.appVersion },
    });
    return res.status(201).json({ ok: true, requestId: res.locals.requestId, device });
  } catch (error) {
    return fail(res, error.status || 500, error.message || "No se pudo registrar el dispositivo");
  }
});
notificationsRouter.delete("/api/devices/:deviceId", requireAuth, async (req, res) => {
  try {
    await revokePostgresDevice({
      userPublicId: req.auth.userId,
      devicePublicId: req.params.deviceId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "device.revoked",
      entityType: "user_device",
      entityId: req.params.deviceId,
      requestId: req.requestId,
    });
    return ok(res, { revoked: true });
  } catch (error) {
    return fail(res, error.status || 500, error.message || "No se pudo revocar el dispositivo");
  }
});
