import { config } from "./config.js";

let sdk;

export async function startTelemetry() {
  if (!config.telemetry.enabled) return false;

  const [
    { NodeSDK },
    { getNodeAutoInstrumentations },
    { OTLPTraceExporter },
    { resourceFromAttributes },
    {
      ATTR_SERVICE_NAME,
      ATTR_SERVICE_VERSION,
      ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
    },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/auto-instrumentations-node"),
    import("@opentelemetry/exporter-trace-otlp-proto"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/semantic-conventions"),
  ]);

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.telemetry.serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || "0.1.0",
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.env,
    }),
    traceExporter: new OTLPTraceExporter({ url: config.telemetry.tracesUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  sdk.start();
  const shutdown = async () => {
    try {
      await sdk?.shutdown();
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "telemetry.shutdown_failed", message: error.message }));
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return true;
}
