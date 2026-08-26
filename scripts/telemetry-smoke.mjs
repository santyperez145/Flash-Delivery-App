import http from "node:http";
import { spawn } from "node:child_process";

const apiPort = 4207;
const collectorPort = 4321;
const payloads = [];
const collector = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (req.url === "/v1/traces") payloads.push(Buffer.concat(chunks));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});

await new Promise((resolve) => collector.listen(collectorPort, "127.0.0.1", resolve));
const api = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    PORT: String(apiPort),
    OTEL_ENABLED: "true",
    OTEL_SERVICE_NAME: "flash-api-smoke",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${collectorPort}/v1/traces`,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
api.stderr.on("data", (data) => process.stderr.write(data));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
        headers: { "x-request-id": "REQ-otel-smoke-0001" },
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(200);
  }
  if (!ready) throw new Error("API instrumentada no inició");
  await fetch(`http://127.0.0.1:${apiPort}/api/ready`, {
    headers: { "x-request-id": "REQ-otel-smoke-0002" },
  });
  for (let attempt = 0; attempt < 40 && payloads.length === 0; attempt += 1) await sleep(250);
  if (!payloads.some((payload) => payload.length > 0))
    throw new Error("No se recibió ningún lote OTLP");
  console.log(`ok - OpenTelemetry exportó ${payloads.length} lote(s) OTLP protobuf`);
} finally {
  api.kill("SIGTERM");
  await new Promise((resolve) => collector.close(resolve));
}
