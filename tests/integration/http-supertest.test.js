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

  test("GET /api/openapi.json publica OpenAPI 3.x", async () => {
    const response = await request(app).get("/api/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toMatch(/^3\./);
    expect(response.body.paths["/api/health"]).toBeTruthy();
    expect(response.body.paths["/api/admin/jobs/{jobId}/assign"]).toBeTruthy();
  });

  test("GET /api/ready responde contrato de readiness (200 o 503)", async () => {
    const response = await request(app).get("/api/ready");
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body.ok).toBe(true);
    } else {
      expect(response.body.ok).toBe(false);
      expect(response.body.message).toBeTruthy();
    }
  });

  test("ruta autenticada sin bearer responde 401", async () => {
    const response = await request(app).get("/api/metrics");
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  test("ruta desconocida bajo /api responde 404 tipado", async () => {
    const response = await request(app).get("/api/ruta-que-no-existe-supertest");
    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toMatch(/no encontrada/i);
  });

  test("GET /api/subscription/plans es público (200 con planes o 503 sin Postgres)", async () => {
    const response = await request(app).get("/api/subscription/plans");
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body.plans)).toBe(true);
      expect(response.body.plans.length).toBeGreaterThan(0);
      expect(response.body.plans[0]).toEqual(
        expect.objectContaining({
          planKey: expect.any(String),
          planName: expect.any(String),
        }),
      );
    } else {
      expect(response.body.ok).toBe(false);
    }
  });

  test("POST /api/auth/login con cuerpo vacío responde 4xx tipado", async () => {
    const response = await request(app).post("/api/auth/login").send({});
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.ok).toBe(false);
  });

  test("GET /api/bootstrap/customer sin bearer responde 401", async () => {
    const response = await request(app).get("/api/bootstrap/customer");
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  test("POST /api/reset sin bearer responde 401", async () => {
    const response = await request(app).post("/api/reset");
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  test("GET /api/features sin bearer responde 401", async () => {
    const response = await request(app).get("/api/features");
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  test("GET /api/maps/geocode sin bearer responde 401", async () => {
    const response = await request(app).get("/api/maps/geocode").query({ q: "La Rioja" });
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  test("GET /api/pricing responde contrato público (200 o 503)", async () => {
    const response = await request(app).get("/api/pricing");
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body.plans)).toBe(true);
      expect(response.body.plans.length).toBeGreaterThan(0);
    } else {
      expect(response.body.ok).toBe(false);
    }
  });

  test("GET /api/zones responde contrato público (200 o 503)", async () => {
    const response = await request(app).get("/api/zones");
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body.zones)).toBe(true);
      expect(response.body.city).toBeTruthy();
    } else {
      expect(response.body.ok).toBe(false);
    }
  });

  test("POST /api/auth/register con cuerpo vacío responde 4xx tipado", async () => {
    const response = await request(app).post("/api/auth/register").send({});
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body.ok).toBe(false);
  });

  test("método no soportado en health responde 4xx", async () => {
    const response = await request(app).post("/api/health");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  test("GET /api/catalog/restaurants responde contrato público (200 o 5xx tipado)", async () => {
    const response = await request(app).get("/api/catalog/restaurants");
    if (response.status === 200) {
      expect(Array.isArray(response.body.restaurants)).toBe(true);
    } else {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.ok).toBe(false);
    }
  });

  test("GET /api/shipment-options responde 200 con opciones o 503 sin Postgres", async () => {
    const response = await request(app).get("/api/shipment-options");
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toBeTruthy();
    } else {
      expect(response.body.ok).toBe(false);
    }
  });
});
