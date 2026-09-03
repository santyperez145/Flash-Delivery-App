import { ProviderCircuit } from "../server/provider-resilience.js";
import { providerCallCounts, resetProviderCallCounts } from "../server/observability.js";

let clock = Date.parse("2026-08-22T12:00:00Z");
const circuit = new ProviderCircuit({
  failureThreshold: 2,
  resetMs: 1000,
  dailyBudget: 3,
  now: () => clock,
});
const failedResponse = { ok: false, status: 503 };
const successfulResponse = { ok: true, status: 200 };
const execute = (response) =>
  circuit.execute({
    provider: "router",
    operation: "route",
    timeoutMs: 1000,
    call: async () => response,
  });
const rejectsWith = async (code) => {
  try {
    await execute(successfulResponse);
  } catch (error) {
    if (error.code === code) return;
    throw error;
  }
  throw new Error(`Se esperaba ${code}`);
};

await execute(failedResponse).catch(() => {});
await execute(failedResponse).catch(() => {});
if (circuit.snapshot("router").status !== "open")
  throw new Error("El circuito no abrió tras el umbral");
await rejectsWith("provider_circuit_open");
clock += 1001;
await execute(successfulResponse);
if (circuit.snapshot("router").status !== "closed")
  throw new Error("La prueba half-open no cerró el circuito");
await rejectsWith("provider_budget_exhausted");
clock += 86_400_000;
await execute(successfulResponse);
const resetSnap = circuit.snapshot("router");
if (resetSnap.calls !== 1) throw new Error("El presupuesto diario no se reinició");
if (resetSnap.dailyBudget !== 3 || resetSnap.remaining !== 2 || resetSnap.day !== "2026-08-23")
  throw new Error("snapshot no expone presupuesto, remanente ni día");

resetProviderCallCounts();
const budgetCircuit = new ProviderCircuit({
  dailyBudget: 10,
  now: () => clock,
});
const budgetExecute = () =>
  budgetCircuit.execute({
    provider: "maps",
    operation: "route",
    timeoutMs: 1000,
    call: async () => successfulResponse,
  });
for (let index = 0; index < 8; index += 1) await budgetExecute();
const budgetSnap = budgetCircuit.snapshot("maps");
if (budgetSnap.remaining !== 2) throw new Error("El remanente no refleja 8/10 llamadas");
if (providerCallCounts()["maps|budget|warning"] !== 1)
  throw new Error("La alerta al 80% no se emitió tras 8 llamadas");
if (budgetCircuit.checkBudgetAlert("maps"))
  throw new Error("La alerta al 80% no debe repetirse el mismo día");
if (providerCallCounts()["maps|budget|warning"] !== 1)
  throw new Error("observeProviderCall no registró la alerta de presupuesto");

console.log("ok - circuit breaker, half-open y presupuesto diario verificados");
