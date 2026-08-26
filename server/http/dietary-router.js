// Preferencias alimentarias del cliente (ticket ARC-001, paso 6).
//
// Quinto grupo de rutas extraído de `server/index.js`. Son dos rutas, pero un
// dominio propio: lo que el cliente no come y lo que le hace daño.
//
// **El contrato de los dos runtimes no es el mismo, y eso es deliberado.** El
// fallback SQLite devuelve las etiquetas dietarias como strings; PostgreSQL las
// devuelve como objetos con `.code`. Esa diferencia tiene su propia suite
// —`test:dietary-local`, que corre en el job `local-fallback` de `ci-fast`—
// porque en agosto de 2026 estuvo apuntada al runtime equivocado y pasaba
// afirmando el contrato de la otra base.
//
// Las dos rutas exigen rol `customer` o `admin`: un alérgeno declarado es dato
// de salud, y ni el comercio ni el conductor tienen por qué leerlo.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresAuth } from "../auth-repository.js";
import { auditRuntime } from "../audit-trail.js";
import {
  getUserDietaryPreferences,
  replaceUserDietaryPreferences,
} from "../dietary-preference-repository.js";
import { readDb } from "../fallback-runtime.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { getLocalDietaryPreferences, replaceLocalDietaryPreferences } from "../store.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

// Los topes son los del catálogo, no arbitrarios: cinco etiquetas dietarias y
// nueve alérgenos son las listas completas, así que un valor mayor sólo puede
// venir de repeticiones, que el `refine` rechaza aparte.
const userDietaryPreferenceSchema = z.object({
  dietaryLabels: z
    .array(z.enum(["vegetarian", "vegan", "gluten_free", "halal", "kosher"]))
    .max(5)
    .refine((values) => new Set(values).size === values.length, "No repitas preferencias"),
  avoidedAllergens: z
    .array(
      z.enum([
        "gluten",
        "milk",
        "eggs",
        "peanuts",
        "tree_nuts",
        "soy",
        "fish",
        "shellfish",
        "sesame",
      ]),
    )
    .max(9)
    .refine((values) => new Set(values).size === values.length, "No repitas alérgenos"),
  hideIncompatible: z.boolean(),
});

export const dietaryRouter = Router();

dietaryRouter.get(
  "/api/dietary-preferences",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    try {
      if (!usesPostgresAuth()) {
        return ok(res, {
          preferences: getLocalDietaryPreferences(req.auth.userId),
        });
      }
      return ok(res, {
        preferences: await getUserDietaryPreferences(req.auth.userId),
      });
    } catch (error) {
      return failFrom(res, error, "No se pudieron cargar las preferencias alimentarias");
    }
  },
);
dietaryRouter.put(
  "/api/dietary-preferences",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(userDietaryPreferenceSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      if (!usesPostgresAuth()) {
        const preferences = replaceLocalDietaryPreferences({
          userId: req.auth.userId,
          ...parsed.data,
        });
        await auditRuntime(
          readDb(),
          req,
          "user",
          req.auth.userId,
          "user.dietary_preferences_updated",
          {
            dietaryCount: parsed.data.dietaryLabels.length,
            allergenCount: parsed.data.avoidedAllergens.length,
            hideIncompatible: parsed.data.hideIncompatible,
          },
        );
        return ok(res, { preferences });
      }
      const preferences = await replaceUserDietaryPreferences({
        userPublicId: req.auth.userId,
        ...parsed.data,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: "user.dietary_preferences_updated",
        entityType: "user",
        entityId: req.auth.userId,
        requestId: req.requestId,
        afterData: {
          dietaryCount: parsed.data.dietaryLabels.length,
          allergenCount: parsed.data.avoidedAllergens.length,
          hideIncompatible: parsed.data.hideIncompatible,
        },
      });
      return ok(res, { preferences });
    } catch (error) {
      return failFrom(res, error, "No se pudieron actualizar las preferencias alimentarias");
    }
  },
);
