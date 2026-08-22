import { ProviderCircuit } from "../server/provider-resilience.js";

let clock = Date.parse("2026-08-22T12:00:00Z");
const circuit = new ProviderCircuit({ failureThreshold: 2, resetMs: 1000, dailyBudget: 3, now: () => clock });
const failedResponse = { ok: false, status: 503 };
const successfulResponse = { ok: true, status: 200 };
const execute = (response) => circuit.execute({ provider: "router", operation: "route", timeoutMs: 1000, call: async () => response });
const rejectsWith = async (code) => { try { await execute(successfulResponse); } catch (error) { if (error.code === code) return; throw error; } throw new Error(`Se esperaba ${code}`); };

await execute(failedResponse).catch(() => {});
await execute(failedResponse).catch(() => {});
if (circuit.snapshot("router").status !== "open") throw new Error("El circuito no abrió tras el umbral");
await rejectsWith("provider_circuit_open");
clock += 1001;
await execute(successfulResponse);
if (circuit.snapshot("router").status !== "closed") throw new Error("La prueba half-open no cerró el circuito");
await rejectsWith("provider_budget_exhausted");
clock += 86_400_000;
await execute(successfulResponse);
if (circuit.snapshot("router").calls !== 1) throw new Error("El presupuesto diario no se reinició");
console.log("ok - circuit breaker, half-open y presupuesto diario verificados");
