// Rutas de infraestructura del proceso (ARC-001).
//
// Salud, OpenAPI y el 410 de `/api/state` no son dominio: son el contrato de
// arranque y de deprecación del estado global. Quedar en `index.js` mezclaba
// el cableado del servidor con el montaje de routers de producto.
import { Router } from "express";

import { config } from "../config.js";
import { openApiDocument } from "../openapi.js";
import { getTimestamp } from "../store.js";
import { requireAuth } from "./authentication.js";
import { fail, ok } from "./responses.js";

export const platformStatusRouter = Router();

platformStatusRouter.get("/api/health", (_req, res) => {
  ok(res, {
    service: "flash-fullstack-api",
    environment: config.env,
    storageMode: config.databaseUrl ? "postgres-primary" : "sqlite-demo",
    timestamp: getTimestamp(),
  });
});

platformStatusRouter.get("/api/openapi.json", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
  return res.json(openApiDocument);
});

platformStatusRouter.get("/api/state", requireAuth, (_req, res) => {
  res.set("Cache-Control", "no-store");
  return fail(res, 410, "El estado global fue retirado; usa bootstrap y recursos segmentados");
});
