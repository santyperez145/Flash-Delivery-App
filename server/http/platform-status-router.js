// Rutas de infraestructura del proceso (ARC-001).
//
// Salud, OpenAPI, el 410 de `/api/state` y el reset de demo SQLite no son
// dominio de un vertical: son el contrato de arranque y de entorno local.
import { Router } from "express";

import { config } from "../config.js";
import { openApiDocument } from "../openapi.js";
import { getTimestamp, resetDb } from "../store.js";
import { requireAuth } from "./authentication.js";
import { requireAnyRole } from "./authorization.js";
import { publishRealtimeEvent } from "./realtime.js";
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

platformStatusRouter.post("/api/reset", requireAuth, requireAnyRole("admin"), async (req, res) => {
  if (config.databaseUrl)
    return fail(res, 409, "Reset deshabilitado mientras PostgreSQL es la fuente real");
  await publishRealtimeEvent({
    req,
    type: "platform.reset",
    action: "platform.reset",
  });
  ok(res, { state: resetDb() });
});
