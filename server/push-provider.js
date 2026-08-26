// Proveedor de push (ticket NOT-001, hallazgo H-02).
//
// Hasta el 26 de agosto de 2026 `NOTIFICATION_PROVIDER` sólo admitía `disabled`
// y `sandbox`, y producción prohibía `sandbox`: el único valor válido en
// producción era `disabled`. No existía forma de entregar un push, y el esquema
// de configuración lo impedía por construcción.
//
// El servicio de Expo **no ofrece SLA**. Un ticket aceptado no es una entrega:
// sólo dice que Expo tomó el mensaje. La entrega se confirma consultando el
// recibo más tarde, y por eso el flujo es asíncrono y monitoreado en lugar de
// dar por entregado lo que se encoló.
import { config } from "./config.js";
import { observeProviderCall } from "./observability.js";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

// Límites del servicio: 100 mensajes por envío, 1000 recibos por consulta.
export const EXPO_BATCH_LIMIT = 100;
export const EXPO_RECEIPT_LIMIT = 1000;

const observeExpo = (operation, outcome) =>
  observeProviderCall({ provider: "expo", operation, outcome });

/**
 * Traduce un código de error de Expo a una acción operativa.
 *
 * `device_unregistered` es el único que obliga a revocar el token: el dispositivo
 * desinstaló la app o revocó el permiso, y seguir intentando es basura pura.
 */
export function classifyExpoError(code) {
  switch (code) {
    case "DeviceNotRegistered":
      return "device_unregistered";
    case "MessageTooBig":
      return "message_too_big";
    case "MessageRateExceeded":
      return "rate_limited";
    case "InvalidCredentials":
      return "invalid_credentials";
    case "MismatchSenderId":
      return "credential_mismatch";
    default:
      return "unknown";
  }
}

/** Un error de credenciales o de sender no se reintenta: reintentar no lo arregla. */
export function isRetryableExpoError(reason) {
  return (
    reason !== "device_unregistered" &&
    reason !== "invalid_credentials" &&
    reason !== "credential_mismatch"
  );
}

export function buildExpoMessage({ token, title, body, data = {}, channelId, priority = "high" }) {
  if (!token || typeof token !== "string") throw new Error("Token de push inválido");
  const message = { to: token, title, body, priority };
  if (channelId) message.channelId = channelId;
  if (data && Object.keys(data).length > 0) message.data = data;
  return message;
}

function requestHeaders() {
  const headers = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
  };
  // El access token es opcional en Expo, pero sin él cualquiera que conozca un
  // token de dispositivo puede enviarle notificaciones.
  if (config.push?.accessToken) headers.authorization = `Bearer ${config.push.accessToken}`;
  return headers;
}

async function expoRequest(operation, url, payload, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.push?.timeoutMs ?? 8000),
    });
  } catch (error) {
    const timeout = error?.name === "AbortError" || error?.name === "TimeoutError";
    observeExpo(operation, timeout ? "timeout" : "network_error");
    throw Object.assign(
      new Error(timeout ? "Expo no respondió a tiempo" : "Expo no está accesible"),
      {
        status: 503,
        retryable: true,
      },
    );
  }

  const body = await response.json().catch(() => ({}));

  if (response.status === 429) {
    observeExpo(operation, "rate_limited");
    throw Object.assign(new Error("Expo aplicó rate limit"), { status: 429, retryable: true });
  }
  if (!response.ok) {
    observeExpo(operation, `http_${response.status}`);
    throw Object.assign(new Error("Expo rechazó la solicitud"), {
      status: 502,
      // 4xx distinto de 429 es un problema del pedido: reintentarlo no lo arregla.
      retryable: response.status >= 500,
    });
  }
  // `data` es un array en el envío y un objeto en los recibos. Acá sólo se
  // exige que exista; la forma concreta la valida cada operación.
  if (!body || typeof body !== "object" || body.data === undefined || body.data === null) {
    observeExpo(operation, "invalid_response");
    throw Object.assign(new Error("Expo devolvió una respuesta inesperada"), {
      status: 502,
      retryable: true,
    });
  }

  observeExpo(operation, "success");
  return body;
}

/**
 * Envía un lote y devuelve un ticket por mensaje, en el mismo orden.
 *
 * Un ticket `ok` NO significa entregado. Significa que Expo aceptó el mensaje y
 * que hay que consultar su recibo después.
 */
export async function sendExpoPushBatch({ messages }, fetchImpl = fetch) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("El lote está vacío");
  if (messages.length > EXPO_BATCH_LIMIT)
    throw new Error(`Expo acepta hasta ${EXPO_BATCH_LIMIT} mensajes por lote`);

  const body = await expoRequest("push_send", SEND_URL, messages, fetchImpl);
  const tickets = body.data;
  if (!Array.isArray(tickets) || tickets.length !== messages.length) {
    observeExpo("push_send", "invalid_response");
    throw Object.assign(new Error("Expo devolvió menos tickets que mensajes"), {
      status: 502,
      retryable: true,
    });
  }

  return tickets.map((ticket) => {
    if (ticket?.status === "ok" && ticket.id)
      return { status: "accepted", ticketId: String(ticket.id) };
    const code = ticket?.details?.error ?? null;
    const reason = classifyExpoError(code);
    observeExpo("push_send", `ticket_${reason}`);
    return { status: "rejected", reason, retryable: isRetryableExpoError(reason) };
  });
}

/**
 * Consulta recibos. Expo los conserva un tiempo acotado: un recibo que no
 * aparece no es un éxito, es un desconocido, y debe alertar.
 */
export async function fetchExpoPushReceipts({ ticketIds }, fetchImpl = fetch) {
  if (!Array.isArray(ticketIds) || ticketIds.length === 0)
    throw new Error("No hay tickets que consultar");
  if (ticketIds.length > EXPO_RECEIPT_LIMIT)
    throw new Error(`Expo acepta hasta ${EXPO_RECEIPT_LIMIT} recibos por consulta`);

  const body = await expoRequest("push_receipts", RECEIPTS_URL, { ids: ticketIds }, fetchImpl);
  const receipts = body.data ?? {};
  const result = new Map();

  for (const ticketId of ticketIds) {
    const receipt = receipts[ticketId];
    if (!receipt) {
      // Expo todavía no lo resolvió o ya lo descartó. No se confirma entrega.
      result.set(ticketId, { status: "unknown" });
      continue;
    }
    if (receipt.status === "ok") {
      result.set(ticketId, { status: "delivered" });
      continue;
    }
    const code = receipt?.details?.error ?? null;
    const reason = classifyExpoError(code);
    observeExpo("push_receipts", `receipt_${reason}`);
    result.set(ticketId, { status: "failed", reason, retryable: isRetryableExpoError(reason) });
  }

  return result;
}

/** Parte una lista en lotes del tamaño que acepta el proveedor. */
export function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size)
    batches.push(items.slice(index, index + size));
  return batches;
}
