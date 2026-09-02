// Transporte HTTP web (ARC-001).
//
// Uber y DoorDash aíslan timeout, refresh y SSE del mapa de recursos. Flash
// deja esa frontera aquí; `src/api.ts` sólo declara qué llama cada audiencia.

import type { RealtimeEvent, User } from "../types";
import { createAuthRefreshCoordinator } from "../auth-refresh-coordinator";

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:4000/api";
const TOKEN_KEY = "flash_platform_token";
const REFRESH_KEY = "flash_platform_refresh";
const EVENT_CURSOR_KEY = "flash_platform_event_cursor";

let authToken = "";
export type WebAudience = "customer" | "merchant" | "driver" | "operations" | "support";

let activeAudience: WebAudience = "customer";

export function audienceForUser(user: User): WebAudience {
  if (user.roles.includes("admin")) return "operations";
  if (user.roles.includes("support")) return "support";
  if (user.roles.includes("merchant")) return "merchant";
  if (user.roles.includes("driver")) return "driver";
  return "customer";
}

export function getActiveAudience() {
  return activeAudience;
}

export function setActiveAudience(next: WebAudience) {
  activeAudience = next;
}

export function hasAuthToken() {
  return Boolean(authToken);
}

let refreshToken =
  typeof window === "undefined" ? "" : window.localStorage.getItem(REFRESH_KEY) || "";

type ApiEnvelope<T> = T & {
  ok: boolean;
  message?: string;
};

export function setAuthToken(token: string) {
  authToken = token;
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

export function clearAuthToken() {
  authToken = "";
  refreshToken = "";
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
    window.sessionStorage.removeItem(EVENT_CURSOR_KEY);
    window.dispatchEvent(new Event("flash:auth-required"));
  }
}

export function persistRefreshToken(token: string) {
  refreshToken = token;
  if (typeof window !== "undefined") window.localStorage.removeItem(REFRESH_KEY);
}

const SAFE_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REQUEST_TIMEOUT_MS = 12000;

function emitNetworkStatus(online: boolean) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("flash:network", { detail: { online } }));
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function performAccessTokenRefresh() {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Flash-Client": "web" },
      body: JSON.stringify({ ...(refreshToken ? { refreshToken } : {}), deviceName: "Flash Web" }),
    });
  } catch (_error) {
    emitNetworkStatus(false);
    return false;
  }
  emitNetworkStatus(true);
  if (!response.ok) {
    clearAuthToken();
    return false;
  }
  const session = (await response.json()) as {
    token: string;
    refreshToken?: string;
  };
  if (!session.token) {
    clearAuthToken();
    return false;
  }
  setAuthToken(session.token);
  persistRefreshToken(session.refreshToken || "");
  return true;
}

const refreshCoordinator = createAuthRefreshCoordinator(performAccessTokenRefresh, () => authToken);

export async function refreshAccessToken() {
  return refreshCoordinator.refresh();
}

export async function revokeSession() {
  const legacyToken = refreshToken;
  clearAuthToken();
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Flash-Client": "web" },
    body: JSON.stringify(legacyToken ? { refreshToken: legacyToken } : {}),
  });
}

export function subscribeToEvents(
  onEvent: (event: RealtimeEvent) => void,
  onStatus: (status: "connecting" | "live" | "reconnecting" | "offline") => void,
) {
  const controller = new AbortController();
  let stopped = false;
  let retryTimer: number | undefined;
  let retryAttempt = 0;
  let lastEventId =
    typeof window === "undefined"
      ? 0
      : Number(window.sessionStorage.getItem(EVENT_CURSOR_KEY) || 0);
  if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) lastEventId = 0;

  const connect = async () => {
    if (stopped || !authToken) return;
    onStatus("connecting");
    const tokenUsed = authToken;
    try {
      const response = await fetch(`${API_BASE}/events`, {
        headers: {
          Authorization: `Bearer ${tokenUsed}`,
          ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
        },
        signal: controller.signal,
      });
      if (response.status === 401 && (await refreshCoordinator.recoverUnauthorized(tokenUsed))) {
        retryAttempt = 0;
        return connect();
      }
      if (!response.ok || !response.body) throw new Error("Realtime no disponible");
      retryAttempt = 0;
      onStatus("live");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Realtime desconectado");
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        chunks.forEach((chunk) => {
          const eventLine = chunk.split("\n").find((line) => line.startsWith("event: "));
          const eventType = eventLine?.slice(7) || "message";
          const idLine = chunk.split("\n").find((line) => line.startsWith("id: "));
          const cursor = idLine ? Number(idLine.slice(4)) : 0;
          if (
            eventType === "state.updated" &&
            Number.isSafeInteger(cursor) &&
            cursor > 0 &&
            cursor <= lastEventId
          )
            return;
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
          if (!dataLine) return;
          try {
            onEvent(JSON.parse(dataLine.slice(6)) as RealtimeEvent);
            if (
              eventType === "state.updated" &&
              Number.isSafeInteger(cursor) &&
              cursor > lastEventId
            ) {
              lastEventId = cursor;
              window.sessionStorage.setItem(EVENT_CURSOR_KEY, String(cursor));
            }
          } catch (_error) {
            // Ignore malformed event frames and keep the stream alive.
          }
        });
      }
    } catch (_error) {
      if (stopped || controller.signal.aborted) return;
      onStatus("reconnecting");
      const delay =
        Math.min(30000, 1000 * 2 ** Math.min(retryAttempt, 5)) + Math.floor(Math.random() * 500);
      retryAttempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    }
  };

  void connect();
  return () => {
    stopped = true;
    if (retryTimer) window.clearTimeout(retryTimer);
    controller.abort();
    onStatus("offline");
  };
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  retry = true,
  transportRetry = true,
): Promise<T> {
  const { headers, ...requestInit } = init || {};
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  requestHeaders.set("X-Flash-Client", "web");
  if (authToken && !requestHeaders.has("Authorization")) {
    requestHeaders.set("Authorization", `Bearer ${authToken}`);
  }
  const tokenUsed = requestHeaders.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const method = (requestInit.method || "GET").toUpperCase();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}${path}`, {
      ...requestInit,
      credentials: "include",
      headers: requestHeaders,
    });
    emitNetworkStatus(true);
  } catch (_error) {
    emitNetworkStatus(false);
    if (transportRetry && SAFE_READ_METHODS.has(method)) {
      await wait(350);
      return request<T>(path, init, retry, false);
    }
    throw new Error("No hay conexión con Flash. Revisá tu red e intentá nuevamente.");
  }
  if (
    response.status === 401 &&
    retry &&
    path !== "/auth/login" &&
    (await refreshCoordinator.recoverUnauthorized(tokenUsed))
  ) {
    return request<T>(path, init, false, transportRetry);
  }
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion");
  }
  return payload as T;
}
