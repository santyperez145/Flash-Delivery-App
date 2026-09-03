// Primera suite Supertest (CI-001): ejercita el Express real sin abrir puerto.
//
// `FLASH_HTTP_LISTEN=0` evita `app.listen` al importar `server/index.js`. Así
// Vitest monta el mismo árbol de rutas que producción —no un stub.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.FLASH_HTTP_LISTEN = "0";

import request from "supertest";
import { afterAll, describe, expect, test } from "vitest";

const { app } = await import("../../server/index.js");
const { closePostgres } = await import("../../server/postgres.js");
const { closeRedis } = await import("../../server/redis.js");

describe("HTTP surface (supertest)", () => {
  afterAll(async () => {
    await closePostgres().catch(() => {});
    await closeRedis().catch(() => {});
  });

  test("GET /api/health responde 200 con el contrato mínimo", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.service).toBe("flash-fullstack-api");
    expect(response.headers["x-request-id"]).toMatch(/^[a-zA-Z0-9._:-]{8,128}$/);
  });

  test("ruta desconocida bajo /api responde 404 tipado", async () => {
    const response = await request(app).get("/api/ruta-que-no-existe-supertest");
    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toMatch(/no encontrada/i);
  });
});
