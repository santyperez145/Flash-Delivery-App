import { createGracefulShutdown } from "../server/graceful-shutdown.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};
const events = [];
let closeCallback;
const server = {
  close(callback) {
    events.push("server.close");
    closeCallback = callback;
  },
  closeIdleConnections() {
    events.push("server.closeIdleConnections");
  },
  closeAllConnections() {
    events.push("server.closeAllConnections");
    closeCallback?.();
  },
};
const client = {
  destroyed: false,
  writableEnded: false,
  write(frame) {
    events.push(frame.includes("server.shutdown") ? "sse.notice" : "sse.invalid");
  },
  end() {
    this.writableEnded = true;
    events.push("sse.end");
  },
};
const realtimeClients = new Map([[client, {}]]);
const resource = (name) => async () => {
  events.push(name);
};
const logs = [];
const shutdown = createGracefulShutdown({
  server,
  realtimeClients,
  graceMs: 10,
  onDrain: () => events.push("draining"),
  stopRealtimeListener: resource("realtime.closed"),
  closePostgres: resource("postgres.closed"),
  closeRedis: resource("redis.closed"),
  stopTelemetry: resource("telemetry.closed"),
  log: { info: (message) => logs.push(message), error: (message) => logs.push(message) },
});

const first = shutdown("SIGTERM");
const duplicate = shutdown("SIGINT");
assert(first === duplicate, "señales repetidas reutilizan un único drenaje");
await first;
assert(
  events.slice(0, 4).join(",") === "draining,sse.notice,sse.end,server.close",
  "readiness y SSE drenan antes de cerrar HTTP",
);
assert(
  events.includes("server.closeAllConnections"),
  "el límite temporal fuerza conexiones remanentes",
);
assert(
  realtimeClients.size === 0 && client.writableEnded,
  "clientes realtime reciben cierre y se liberan",
);
assert(
  ["realtime.closed", "postgres.closed", "redis.closed", "telemetry.closed"].every((event) =>
    events.includes(event),
  ),
  "PostgreSQL, Redis, realtime y telemetría cierran",
);
assert(
  events.indexOf("postgres.closed") > events.indexOf("server.closeAllConnections"),
  "recursos cierran después del tráfico HTTP",
);
assert(
  events.indexOf("realtime.closed") < events.indexOf("postgres.closed"),
  "listener realtime libera PostgreSQL antes de cerrar el pool",
);
assert(
  logs.some((entry) => entry.includes("drained successfully")),
  "el cierre exitoso queda observable",
);
