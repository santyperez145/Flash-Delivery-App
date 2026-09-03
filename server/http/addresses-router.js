// Rutas de direcciones guardadas (ticket ARC-001, paso 3).
//
// Segundo grupo de rutas extraído de `server/index.js`, y el primero con la
// superficie completa que tienen los otros 54: autenticación, doble runtime
// PostgreSQL/SQLite, auditoría y evento de tiempo real. El grupo de mapas del
// paso 2 no la tenía, así que no probaba que el patrón sirva para el resto.
//
// Su factory llegó a recibir cuatro dependencias del núcleo. Esa lista era la
// medida de cuánto quedaba por extraer, y se vació en dos pasos sin tocar una
// sola de estas cinco rutas: el hub de realtime se llevó una, y `requireAuth`,
// `readDb` y `audit` las otras tres. El router se importa y se monta; no hay
// nada que inyectarle.
//
// El esquema de validación viaja con el grupo. Vivía en `index.js` junto a los
// otros veinte esquemas, y sólo lo usan estas rutas.
import { Router } from "express";
import { z } from "zod";

import {
  createPostgresAddress,
  deletePostgresAddress,
  getPostgresAddresses,
  setPostgresDefaultAddress,
  updatePostgresAddress,
} from "../address-repository.js";
import { usesPostgresAuth } from "../auth-repository.js";
import { audit, readDb } from "../fallback-runtime.js";
import { verifyGeocodeValidation } from "../geocoding-validation.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { createId, writeDb } from "../store.js";
import { requireAuth } from "./authentication.js";
import { publishRealtimeEvent } from "./realtime.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

// Un cliente no acumula direcciones sin límite: veinte cubre cualquier uso real
// y acota lo que un abuso puede hacer crecer.
const MAX_DIRECCIONES = 20;

const addressSchema = z.object({
  label: z.string().trim().min(1).max(60),
  address: z.string().trim().min(3).max(240),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  validationToken: z.string().min(20).max(4096).optional(),
  isDefault: z.boolean().default(false),
});

export const addressesRouter = Router();

addressesRouter.get("/api/addresses", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) {
    const db = readDb();
    return ok(res, {
      addresses: (db.addresses || []).filter((entry) => entry.userId === req.auth.userId),
    });
  }
  return ok(res, { addresses: await getPostgresAddresses(req.auth.userId) });
});
addressesRouter.post("/api/addresses", requireAuth, async (req, res) => {
  const parsed = parseOrFail(addressSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) {
    const db = readDb();
    const user = db.users.find((entry) => entry.id === req.auth.userId);
    if (!user) return fail(res, 404, "Usuario no encontrado");
    const owned = (db.addresses || []).filter((entry) => entry.userId === user.id);
    if (owned.length >= MAX_DIRECCIONES)
      return fail(res, 409, "Alcanzaste el límite de direcciones guardadas");
    const { validationToken: _validationToken, ...addressInput } = parsed.data;
    const address = {
      id: createId("ADDR"),
      userId: user.id,
      ...addressInput,
      isDefault: parsed.data.isDefault || owned.length === 0,
    };
    if (address.isDefault) {
      (db.addresses || []).forEach((entry) => {
        if (entry.userId === user.id) entry.isDefault = false;
      });
      user.defaultAddress = address.address;
    }
    db.addresses = [...(db.addresses || []), address];
    audit(db, req, "address", address.id, "address.created", {
      label: address.label,
      isDefault: address.isDefault,
    });
    writeDb(db);
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: address.id,
      action: "address.created",
    });
    return res.status(201).json({
      ok: true,
      requestId: req.requestId,
      address,
      addresses: db.addresses.filter((entry) => entry.userId === user.id),
    });
  }
  try {
    if (!parsed.data.validationToken)
      return fail(res, 409, "Buscá y confirmá una dirección válida antes de guardarla");
    const validated = verifyGeocodeValidation(parsed.data.validationToken, req.auth.userId);
    const address = await createPostgresAddress({
      userPublicId: req.auth.userId,
      label: parsed.data.label,
      isDefault: parsed.data.isDefault,
      ...validated,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.created",
      entityType: "address",
      entityId: address.id,
      requestId: req.requestId,
      afterData: {
        label: address.label,
        isDefault: address.isDefault,
        geocodingProvider: address.geocodingProvider,
        providerPlaceIdPresent: Boolean(address.providerPlaceId),
      },
    });
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: address.id,
      action: "address.created",
    });
    return res.status(201).json({
      ok: true,
      requestId: req.requestId,
      address,
      addresses: await getPostgresAddresses(req.auth.userId),
    });
  } catch (error) {
    return failFrom(res, error, "No se pudo guardar la dirección");
  }
});
addressesRouter.put("/api/addresses/:addressId", requireAuth, async (req, res) => {
  const parsed = parseOrFail(addressSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  if (!usesPostgresAuth()) {
    const db = readDb();
    const address = (db.addresses || []).find(
      (entry) => entry.id === req.params.addressId && entry.userId === req.auth.userId,
    );
    if (!address) return fail(res, 404, "Dirección no encontrada");
    const nextIsDefault = parsed.data.isDefault || address.isDefault;
    if (nextIsDefault) {
      (db.addresses || []).forEach((entry) => {
        if (entry.userId === req.auth.userId) entry.isDefault = false;
      });
      const user = db.users.find((entry) => entry.id === req.auth.userId);
      if (user) user.defaultAddress = parsed.data.address;
    }
    const { validationToken: _validationToken, ...addressInput } = parsed.data;
    Object.assign(address, { ...addressInput, isDefault: nextIsDefault });
    audit(db, req, "address", address.id, "address.updated", {
      label: address.label,
      isDefault: address.isDefault,
    });
    writeDb(db);
    return ok(res, {
      address,
      addresses: db.addresses.filter((entry) => entry.userId === req.auth.userId),
    });
  }
  try {
    if (!parsed.data.validationToken)
      return fail(res, 409, "Buscá y confirmá una dirección válida antes de actualizarla");
    const validated = verifyGeocodeValidation(parsed.data.validationToken, req.auth.userId);
    const address = await updatePostgresAddress({
      userPublicId: req.auth.userId,
      addressId: req.params.addressId,
      label: parsed.data.label,
      isDefault: parsed.data.isDefault,
      ...validated,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.updated",
      entityType: "address",
      entityId: address.id,
      requestId: req.requestId,
      afterData: {
        label: address.label,
        isDefault: address.isDefault,
        geocodingProvider: address.geocodingProvider,
        providerPlaceIdPresent: Boolean(address.providerPlaceId),
      },
    });
    return ok(res, {
      address,
      addresses: await getPostgresAddresses(req.auth.userId),
    });
  } catch (error) {
    return failFrom(
      res,
      // Un uuid mal formado no es una falla del servidor: la dirección no existe.
      error.code === "22P02" ? { status: 404, message: "Dirección no encontrada" } : error,
      "No se pudo actualizar la dirección",
    );
  }
});
addressesRouter.patch("/api/addresses/:addressId/default", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) {
    const db = readDb();
    const address = (db.addresses || []).find(
      (entry) => entry.id === req.params.addressId && entry.userId === req.auth.userId,
    );
    if (!address) return fail(res, 404, "Dirección no encontrada");
    (db.addresses || []).forEach((entry) => {
      if (entry.userId === req.auth.userId) entry.isDefault = false;
    });
    address.isDefault = true;
    const user = db.users.find((entry) => entry.id === req.auth.userId);
    if (user) user.defaultAddress = address.address;
    audit(db, req, "address", address.id, "address.default_changed", {
      isDefault: true,
    });
    writeDb(db);
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: address.id,
      action: "address.default_changed",
    });
    return ok(res, {
      address,
      addresses: db.addresses.filter((entry) => entry.userId === req.auth.userId),
    });
  }
  try {
    const address = await setPostgresDefaultAddress({
      userPublicId: req.auth.userId,
      addressId: req.params.addressId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.default_changed",
      entityType: "address",
      entityId: address.id,
      requestId: req.requestId,
      afterData: { isDefault: true },
    });
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: address.id,
      action: "address.default_changed",
    });
    return ok(res, {
      address,
      addresses: await getPostgresAddresses(req.auth.userId),
    });
  } catch (error) {
    return failFrom(
      res,
      // Un uuid mal formado no es una falla del servidor: la dirección no existe.
      error.code === "22P02" ? { status: 404, message: "Dirección no encontrada" } : error,
      "No se pudo cambiar la dirección principal",
    );
  }
});
addressesRouter.delete("/api/addresses/:addressId", requireAuth, async (req, res) => {
  if (!usesPostgresAuth()) {
    const db = readDb();
    const addressIndex = (db.addresses || []).findIndex(
      (entry) => entry.id === req.params.addressId && entry.userId === req.auth.userId,
    );
    if (addressIndex < 0) return fail(res, 404, "Dirección no encontrada");
    const [deletedAddress] = db.addresses.splice(addressIndex, 1);
    if (deletedAddress.isDefault) {
      const nextDefault = db.addresses.find((entry) => entry.userId === req.auth.userId);
      const user = db.users.find((entry) => entry.id === req.auth.userId);
      if (nextDefault) {
        nextDefault.isDefault = true;
        if (user) user.defaultAddress = nextDefault.address;
      } else if (user) {
        user.defaultAddress = "";
      }
    }
    audit(db, req, "address", deletedAddress.id, "address.deleted", {});
    writeDb(db);
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: deletedAddress.id,
      action: "address.deleted",
    });
    return ok(res, {
      deleted: true,
      addresses: db.addresses.filter((entry) => entry.userId === req.auth.userId),
    });
  }
  try {
    const addresses = await deletePostgresAddress({
      userPublicId: req.auth.userId,
      addressId: req.params.addressId,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "address.deleted",
      entityType: "address",
      entityId: req.params.addressId,
      requestId: req.requestId,
    });
    await publishRealtimeEvent({
      req,
      type: "user.updated",
      entityType: "address",
      entityId: req.params.addressId,
      action: "address.deleted",
    });
    return ok(res, { deleted: true, addresses });
  } catch (error) {
    return failFrom(
      res,
      // Un uuid mal formado no es una falla del servidor: la dirección no existe.
      error.code === "22P02" ? { status: 404, message: "Dirección no encontrada" } : error,
      "No se pudo eliminar la dirección",
    );
  }
});
