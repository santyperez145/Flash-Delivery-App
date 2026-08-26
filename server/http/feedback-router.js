// Favoritos y calificaciones (ticket ARC-001, paso 7).
//
// Sexto grupo de rutas extraído de `server/index.js`. Los dos subgrupos son la
// opinión del cliente sobre quién le vendió y quién le entregó: **el favorito la
// expresa antes de pedir, la calificación después de recibir**. Comparten
// repositorio y no tienen sentido por separado.
//
// Las cuatro rutas son sólo PostgreSQL. Sobre el fallback SQLite `/api/favorites`
// devuelve la lista vacía en lugar de fallar —el fallback es para desarrollo y no
// modela favoritos— y las otras tres fallan desde el repositorio. Es degradación
// explícita, no un olvido: se prefiere una lista vacía visible a un 500 en una
// pantalla que sólo adorna.
import { Router } from "express";
import { z } from "zod";

import { usesPostgresCommerce } from "../postgres.js";
import {
  createPostgresRating,
  getPostgresFavoriteMerchantIds,
  getPostgresRatings,
  setPostgresFavorite,
} from "../feedback-repository.js";
import { recordPostgresAudit } from "../operations-repository.js";
import { requireAuth } from "./authentication.js";
import { isAdmin, requireAnyRole } from "./authorization.js";
import { fail, failFrom, ok, parseOrFail } from "./responses.js";

const favoriteSchema = z.object({ favorite: z.boolean() });

// El tope de 1.000 caracteres del comentario y los 10 tags son lo que separa una
// calificación de un canal de texto libre sin moderar.
const ratingSchema = z.object({
  jobId: z.string().min(3).max(64),
  subjectType: z.enum(["driver", "merchant", "customer"]),
  score: z.coerce.number().int().min(1).max(5),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  comment: z.string().trim().max(1000).default(""),
});

export const feedbackRouter = Router();

feedbackRouter.get("/api/favorites", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      restaurantIds: usesPostgresCommerce()
        ? await getPostgresFavoriteMerchantIds(req.auth.userId)
        : [],
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar favoritos");
  }
});
feedbackRouter.put(
  "/api/favorites/:restaurantId",
  requireAuth,
  requireAnyRole("customer", "admin"),
  async (req, res) => {
    const parsed = parseOrFail(favoriteSchema, req.body || {});
    if (!parsed.ok) return fail(res, 400, parsed.message);
    try {
      const restaurantIds = await setPostgresFavorite({
        userPublicId: req.auth.userId,
        merchantPublicId: req.params.restaurantId,
        favorite: parsed.data.favorite,
      });
      await recordPostgresAudit({
        actorPublicId: req.auth.userId,
        roles: req.auth.roles,
        action: parsed.data.favorite ? "favorite.added" : "favorite.removed",
        entityType: "merchant",
        entityId: req.params.restaurantId,
        requestId: req.requestId,
      });
      return ok(res, { restaurantIds });
    } catch (error) {
      return failFrom(res, error, "No se pudo actualizar favoritos");
    }
  },
);
feedbackRouter.get("/api/ratings", requireAuth, async (req, res) => {
  try {
    return ok(res, {
      ratings: await getPostgresRatings({
        userPublicId: req.auth.userId,
        includeAll: isAdmin(req),
      }),
    });
  } catch (_error) {
    return fail(res, 500, "No se pudieron cargar calificaciones");
  }
});
feedbackRouter.post("/api/ratings", requireAuth, async (req, res) => {
  const parsed = parseOrFail(ratingSchema, req.body || {});
  if (!parsed.ok) return fail(res, 400, parsed.message);
  try {
    const rating = await createPostgresRating({
      jobPublicId: parsed.data.jobId,
      authorPublicId: req.auth.userId,
      subjectType: parsed.data.subjectType,
      score: parsed.data.score,
      tags: parsed.data.tags,
      comment: parsed.data.comment,
    });
    await recordPostgresAudit({
      actorPublicId: req.auth.userId,
      roles: req.auth.roles,
      action: "rating.created",
      entityType: "rating",
      entityId: rating.id,
      requestId: req.requestId,
      afterData: {
        jobId: rating.jobId,
        subjectType: rating.subjectType,
        score: rating.score,
      },
    });
    return res.status(201).json({ ok: true, requestId: res.locals.requestId, rating });
  } catch (error) {
    return failFrom(res, error, "No se pudo guardar la calificación");
  }
});
