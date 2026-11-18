import { activateDuePostgresPricingChanges } from "../server/configuration-repository.js";
import { closePostgres } from "../server/postgres.js";
import { startWorkerHealth } from "./worker-health.mjs";

const salud = startWorkerHealth({ name: "pricing" });
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

do {
  salud.beat();
  const result = await activateDuePostgresPricingChanges();
  if (result.activated)
    console.log(JSON.stringify({ level: "info", event: "pricing_changes_activated", ...result }));
  if (process.env.WORKER_ONCE === "true") break;
  await new Promise((resolve) => setTimeout(resolve, result.activated ? 500 : 5000));
} while (!stopping);

await salud.close();
await closePostgres();
