import { processSupportQueue } from "../server/support-agent-repository.js";
import { closePostgres } from "../server/postgres.js";

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

do {
  const result = await processSupportQueue({
    limit: Number(process.env.SUPPORT_WORKER_BATCH || 50),
  });
  if (result.assigned.length || result.escalated.length)
    console.log(
      JSON.stringify({
        level: "info",
        event: "support_queue_processed",
        assigned: result.assigned.length,
        escalated: result.escalated.length,
      }),
    );
  if (process.env.WORKER_ONCE === "true") break;
  await new Promise((resolve) =>
    setTimeout(resolve, result.assigned.length || result.escalated.length ? 1000 : 15000),
  );
} while (!stopping);

await closePostgres();
