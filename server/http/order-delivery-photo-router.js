// Foto de entrega de un pedido dejado en la puerta (P-02b).
//
// La sube quien reparte, al llegar; la ven el cliente, quien repartió y
// operaciones. La guarda que la exige vive en `POST /api/orders/:orderId/advance`.
import { Router } from "express";
import { z } from "zod";

import { recordPostgresAudit } from "../operations-repository.js";
import {
  addPostgresOrderDeliveryPhoto,
  getPostgresOrderDeliveryPhoto,
} from "../order-delivery-photo-repository.js";
import { usesPostgresCommerce } from "../postgres.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { deliveryProofLimiter } from "./rate-limits.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const fotoSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  contentBase64: z.string().min(4).max(2100000),
  capturedAt: z.string().datetime().optional(),
  location: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
    })
    .optional(),
});

export const orderDeliveryPhotoRouter = Router();

orderDeliveryPhotoRouter.post(
  "/api/orders/:orderId/delivery-photo",
  deliveryProofLimiter,
  requireAuth,
  requireAnyRole("driver"),
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La foto de entrega requiere PostgreSQL");
    const parsed = parseOrFail(fotoSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const foto = await addPostgresOrderDeliveryPhoto({
        orderPublicId: req.params.orderId,
        actorPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "order.delivery_photo_recorded",
        entityType: "order",
        entityId: req.params.orderId,
        requestId: req.requestId,
        afterData: { evidenceId: foto.id, sha256: foto.sha256, sizeBytes: foto.sizeBytes },
      });
      res.status(201);
      return ok(res, { photo: foto });
    } catch (error) {
      return failFrom(res, error, "No se pudo guardar la foto");
    }
  },
);

orderDeliveryPhotoRouter.get(
  "/api/orders/:orderId/delivery-photo",
  requireAuth,
  async (req, res) => {
    if (!usesPostgresCommerce()) return fail(res, 503, "La foto de entrega requiere PostgreSQL");
    try {
      const foto = await getPostgresOrderDeliveryPhoto({
        orderPublicId: req.params.orderId,
        actorPublicId: req.auth.userId,
        admin: isAdmin(req),
      });
      res.set("Cache-Control", "no-store, private");
      // Como la evidencia de los envíos: JSON con la imagen en base64, que el cliente
      // muestra sin guardar un archivo.
      return ok(res, {
        photo: { mimeType: foto.mimeType },
        contentBase64: foto.content.toString("base64"),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudo leer la foto");
    }
  },
);
