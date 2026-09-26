// Transporte HTTP mobile (ARC-001).
//
// Uber y DoorDash aíslan timeout, refresh y sesión del mapa de recursos. Flash
// deja esa frontera aquí; `api.ts` sólo declara qué llama cada audiencia.

import type { User } from "../types";
import { loadMobileSession, saveMobileSession } from "../session-storage";
import Constants from "expo-constants";

declare const process: {
  env?: { EXPO_PUBLIC_API_URL?: string; EXPO_PUBLIC_APP_VARIANT?: string };
};

export const API_BASE = process.env?.EXPO_PUBLIC_API_URL || "http://127.0.0.1:4000/api";

let token = "";
let refreshToken = "";
// Id del dispositivo registrado en esta sesión, para poder darlo de baja al
// salir. El servidor deduplica por hash del token, así que volver a registrar
// en cada login es seguro; lo que no se puede es revocar sin el id.
let registeredDeviceId: string | null = null;
let sessionDriverId: string | null = null;
// La variante instalada sale de `EXPO_PUBLIC_APP_VARIANT`, que es la misma
// variable que `metro.config.js` usa para elegir la pantalla y `app.config.js`
// para el identificador y los permisos.
//
// Antes se leía de `Constants.expoConfig.extra.appVariant`, y en Expo web ese
// manifiesto no llega al runtime: la lectura caía en el fallback `"customer"`.
// El efecto no era cosmético. `allowsVariant` gatea el login contra este valor,
// así que el build web de Flash Driver exigía rol `customer` —rechazando al
// conductor y admitiendo al cliente—, mientras Metro sí había puesto la pantalla
// de conductor. Dos fuentes para una sola decisión, que es el mismo defecto que
// separaba `allowsVariant` de `setMode`.
//
// Se conserva el manifiesto como respaldo: en nativo los dos caminos coinciden,
// y si alguno faltara el otro responde.
const declaredVariant =
  process.env?.EXPO_PUBLIC_APP_VARIANT || Constants.expoConfig?.extra?.appVariant;
export const mobileAppVariant = (
  ["customer", "merchant", "driver"].includes(String(declaredVariant))
    ? String(declaredVariant)
    : "customer"
) as "customer" | "merchant" | "driver";
export const allowsVariant = (user: User) => user.roles.includes(mobileAppVariant);

// La audiencia es la variante instalada, no la prioridad de roles del usuario.
//
// Se derivaba con `roles.includes("merchant") ? ... : roles.includes("driver")
// ? ...`, que es el mismo defecto que el PR #23 corrigió en `App.tsx` y que acá
// quedó sin tocar. Como `user_roles` admite varios roles por persona, un comercio
// que además es cliente abriendo Flash pedía el bootstrap de comercio.
//
// `allowsVariant` ya garantiza que quien entró tiene el rol que la variante
// exige, así que la variante instalada es siempre una audiencia válida.
let activeAudience: "customer" | "merchant" | "driver" = mobileAppVariant;

export function getActiveAudience() {
  return activeAudience;
}

export function setActiveAudience(next: "customer" | "merchant" | "driver") {
  activeAudience = next;
}

export function applySession(next: {
  accessToken: string;
  refreshToken: string;
  driverId: string | null;
}) {
  token = next.accessToken;
  refreshToken = next.refreshToken;
  sessionDriverId = next.driverId;
}

export function clearSessionTokens() {
  token = "";
  refreshToken = "";
  sessionDriverId = null;
}

export function setSessionDriverId(driverId: string | null) {
  sessionDriverId = driverId;
}

export function getRefreshToken() {
  return refreshToken;
}

export function getRegisteredDeviceId() {
  return registeredDeviceId;
}

export function setRegisteredDeviceId(id: string | null) {
  registeredDeviceId = id;
}

type Envelope<T> = T & { ok: boolean; message?: string };
const SAFE_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const REQUEST_TIMEOUT_MS = 12000;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithTimeout(input: RequestInfo, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function persistSession() {
  return saveMobileSession(
    refreshToken ? { accessToken: token, refreshToken, driverId: sessionDriverId } : null,
  );
}

export async function refreshAccessToken() {
  const stored = await loadMobileSession();
  if (stored?.refreshToken && stored.refreshToken !== refreshToken) {
    token = stored.accessToken;
    refreshToken = stored.refreshToken;
    sessionDriverId = stored.driverId;
  }
  if (!refreshToken) return false;
  const attemptedRefreshToken = refreshToken;
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, deviceName: "Flash Mobile" }),
    });
  } catch (_error) {
    return false;
  }
  if (!response.ok) {
    const concurrent = await loadMobileSession();
    if (concurrent?.refreshToken && concurrent.refreshToken !== attemptedRefreshToken) {
      token = concurrent.accessToken;
      refreshToken = concurrent.refreshToken;
      sessionDriverId = concurrent.driverId;
      return Boolean(token);
    }
    token = "";
    refreshToken = "";
    await persistSession();
    return false;
  }
  const session = (await response.json()) as { token: string; refreshToken: string };
  token = session.token;
  refreshToken = session.refreshToken;
  await persistSession();
  return true;
}

export async function request<T>(
  path: string,
  init?: RequestInit,
  retry = true,
  transportRetry = true,
): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch (_error) {
    if (transportRetry && SAFE_READ_METHODS.has(method)) {
      await wait(350);
      return request<T>(path, init, retry, false);
    }
    throw new Error("No hay conexión con Flash. Revisá tu red e intentá nuevamente.");
  }
  if (response.status === 401 && retry && path !== "/auth/login" && (await refreshAccessToken())) {
    return request<T>(path, init, false, transportRetry);
  }
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "No se pudo completar la accion");
  }
  return payload as T;
}
