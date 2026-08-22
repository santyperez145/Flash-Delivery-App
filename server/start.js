import { startTelemetry } from "./telemetry.js";

await startTelemetry();
await import("./index.js");
