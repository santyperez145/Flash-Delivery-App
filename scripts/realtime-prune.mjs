import { prunePostgresRealtimeEvents } from "../server/realtime-repository.js";
import { closePostgres } from "../server/postgres.js";
const result = await prunePostgresRealtimeEvents({
  retentionDays: Number(process.env.REALTIME_RETENTION_DAYS || 7),
  maxRows: Number(process.env.REALTIME_MAX_ROWS || 100000),
});
console.log(JSON.stringify({ level: "info", event: "realtime_pruned", ...result }));
await closePostgres();
