import { processPostgresDispatchBatch } from "../server/dispatch-repository.js";
import { processPostgresTripChecks } from "../server/ride-trip-check-repository.js";
import { closePostgres } from "../server/postgres.js";
import { startWorkerHealth } from "./worker-health.mjs";
const salud = startWorkerHealth({ name: "dispatch" });
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  salud.beat();
  const result = await processPostgresDispatchBatch();
  if (result.claimed || result.expired)
    console.log(JSON.stringify({ level: "info", event: "dispatch_batch", ...result }));
  // SEG-01: el control del viaje corre en la misma vuelta. Un error suyo se
  // registra y no frena el despacho.
  try {
    const checks = await processPostgresTripChecks();
    if (checks.detected || checks.notified)
      console.log(JSON.stringify({ level: "info", event: "trip_checks", ...checks }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "trip_checks", message: error.message }));
  }
  if (process.env.WORKER_ONCE === "true") break;
  await new Promise((resolve) => setTimeout(resolve, result.claimed ? 500 : 3000));
} while (!stopping);
await salud.close();
await closePostgres();
