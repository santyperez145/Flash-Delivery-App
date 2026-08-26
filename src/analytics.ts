export type AnalyticsEventName =
  | "home_viewed"
  | "search_started"
  | "merchant_viewed"
  | "cart_updated"
  | "checkout_started"
  | "quote_received"
  | "job_created"
  | "activity_viewed";

export type AnalyticsSurface = "web" | "customer_app" | "driver_app" | "merchant_app";

export type AnalyticsProperty = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsProperty>;

export type AnalyticsEvent = {
  id: string;
  name: AnalyticsEventName;
  surface: AnalyticsSurface;
  sessionId: string;
  occurredAt: string;
  properties: AnalyticsProperties;
};

type AnalyticsSender = (events: AnalyticsEvent[]) => Promise<unknown>;

const MAX_BATCH_SIZE = 20;
const MAX_QUEUE_SIZE = 100;
const FLUSH_DELAY_MS = 1500;
const RETRY_DELAY_MS = 30000;
const sensitiveKey = /email|phone|address|coord|lat|lng|token|name|note|query|text/i;
const propertyKey = /^[a-z][a-z0-9_]{0,31}$/;

let sender: AnalyticsSender | null = null;
let sessionId = "";
let queue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;

function createUuid() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function getSessionId() {
  if (!sessionId) sessionId = createUuid();
  return sessionId;
}

function sanitizeProperties(input: AnalyticsProperties | undefined) {
  const output: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!propertyKey.test(key) || sensitiveKey.test(key)) continue;
    if (typeof value === "string" && value.length <= 80) output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean" || value === null) output[key] = value;
  }
  return output;
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  if (flushTimer || !sender) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

export function configureAnalytics(nextSender: AnalyticsSender) {
  sender = nextSender;
  if (queue.length) void flush();
  return () => {
    if (sender === nextSender) sender = null;
  };
}

export function track(
  name: AnalyticsEventName,
  surface: AnalyticsSurface,
  properties?: AnalyticsProperties,
) {
  queue.push({
    id: createUuid(),
    name,
    surface,
    sessionId: getSessionId(),
    occurredAt: new Date().toISOString(),
    properties: sanitizeProperties(properties),
  });
  if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(-MAX_QUEUE_SIZE);
  if (queue.length >= MAX_BATCH_SIZE) void flush();
  else scheduleFlush();
}

export async function flush() {
  if (flushPromise || !sender || !queue.length) return flushPromise;
  flushPromise = (async () => {
    while (queue.length) {
      const activeSender = sender;
      if (!activeSender) break;
      const batch = queue.splice(0, MAX_BATCH_SIZE);
      try {
        await activeSender(batch);
      } catch {
        queue = [...batch, ...queue].slice(-MAX_QUEUE_SIZE);
        scheduleFlush(RETRY_DELAY_MS);
        break;
      }
    }
  })().finally(() => {
    flushPromise = null;
    if (sender && queue.length && !flushTimer) scheduleFlush();
  });
  return flushPromise;
}
