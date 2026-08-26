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
  // 120 × 200 ms son 24 segundos, y un arranque en frío medido sobre Windows
  // tarda 22: el margen era de dos segundos. Se cuenta tiempo en vez de
  // intentos, con el mismo presupuesto que `security-smoke`.
  const startupBudgetMs = 90000;
  const deadline = Date.now() + startupBudgetMs;
  let ready = false;
  let lastStatus = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
        headers: { "x-request-id": "REQ-otel-smoke-0001" },
      });
      if (response.ok) {
        ready = true;
        break;
      }
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error.cause?.code || error.message;
    }
    await sleep(250);
  }
  if (!ready)
    throw new Error(
      `API instrumentada no inició en ${startupBudgetMs / 1000}s (último: ${lastStatus})`,
    );
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
