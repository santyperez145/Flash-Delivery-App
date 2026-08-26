// Contrato del proveedor de push Expo (ticket NOT-001).
//
// Intercepta `fetch`, así que verifica el contrato sin credenciales ni red. Lo
// que NO puede verificar es que un push llegue a un teléfono: eso exige un
// dispositivo físico y credenciales FCM/APNs, y es la condición de cierre del
// ticket que sigue abierta.
import assert from "node:assert/strict";

process.env.NOTIFICATION_PROVIDER = "expo";
process.env.EXPO_ACCESS_TOKEN = "expo-access-token-para-pruebas";

const {
  buildExpoMessage,
  chunk,
  classifyExpoError,
  EXPO_BATCH_LIMIT,
  EXPO_RECEIPT_LIMIT,
  fetchExpoPushReceipts,
  isRetryableExpoError,
  sendExpoPushBatch,
} = await import("../server/push-provider.js");

const ok = (label) => console.log(`ok - ${label}`);

// --- Clasificación de errores ------------------------------------------------

assert.equal(classifyExpoError("DeviceNotRegistered"), "device_unregistered");
assert.equal(classifyExpoError("MessageRateExceeded"), "rate_limited");
assert.equal(classifyExpoError("MessageTooBig"), "message_too_big");
assert.equal(classifyExpoError("InvalidCredentials"), "invalid_credentials");
assert.equal(classifyExpoError("AlgoNuevoQueExpoInvente"), "unknown");
ok("los códigos de error de Expo se traducen a una acción operativa");

assert.equal(isRetryableExpoError("device_unregistered"), false);
assert.equal(isRetryableExpoError("invalid_credentials"), false);
assert.equal(isRetryableExpoError("credential_mismatch"), false);
assert.equal(isRetryableExpoError("rate_limited"), true);
assert.equal(isRetryableExpoError("unknown"), true);
ok("un token revocado o una credencial inválida no se reintentan");

// --- Construcción de mensajes ------------------------------------------------

const message = buildExpoMessage({
  token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  title: "Tu pedido salió",
  body: "El repartidor está en camino",
  data: { type: "order.updated", entityId: "ORD-1234" },
});
assert.equal(message.to, "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]");
assert.equal(message.priority, "high");
assert.deepEqual(message.data, { type: "order.updated", entityId: "ORD-1234" });
assert.throws(() => buildExpoMessage({ token: "" }), /Token de push inválido/);
ok("el mensaje lleva sólo tipo y entidad, nunca contenido sensible");

// --- Límites del proveedor ---------------------------------------------------

assert.equal(EXPO_BATCH_LIMIT, 100);
assert.equal(EXPO_RECEIPT_LIMIT, 1000);
await assert.rejects(
  () =>
    sendExpoPushBatch({ messages: new Array(101).fill(message) }, async () => {
      throw new Error("no debería llamarse");
    }),
  /hasta 100 mensajes/,
);
assert.equal(chunk(new Array(250).fill(1), 100).length, 3);
ok("el lote se corta en el límite del proveedor antes de salir a la red");

// --- Envío -------------------------------------------------------------------

let captured = null;
const respondWith =
  (payload, status = 200) =>
  async (url, options) => {
    captured = { url, options };
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };

const tickets = await sendExpoPushBatch(
  { messages: [message, message, message] },
  respondWith({
    data: [
      { status: "ok", id: "ticket-1" },
      { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
      { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } },
    ],
  }),
);

assert.equal(captured.url, "https://exp.host/--/api/v2/push/send");
assert.equal(captured.options.headers.authorization, "Bearer expo-access-token-para-pruebas");
assert.deepEqual(tickets[0], { status: "accepted", ticketId: "ticket-1" });
assert.equal(tickets[1].status, "rejected");
assert.equal(tickets[1].reason, "device_unregistered");
assert.equal(tickets[1].retryable, false);
assert.equal(tickets[2].reason, "rate_limited");
assert.equal(tickets[2].retryable, true);
ok("un ticket aceptado devuelve id y uno rechazado devuelve motivo y reintentabilidad");

// El access token evita que cualquiera que conozca un token de dispositivo
// pueda enviarle notificaciones en nombre de Flash.
assert.ok(captured.options.headers.authorization.includes("Bearer "));
ok("el envío va autenticado con el access token del proyecto");

// --- Un ticket aceptado NO es una entrega ------------------------------------

assert.notEqual(tickets[0].status, "delivered");
ok("un ticket aceptado nunca se reporta como entregado");

// --- Respuestas inconsistentes ----------------------------------------------

await assert.rejects(
  () =>
    sendExpoPushBatch(
      { messages: [message, message] },
      respondWith({ data: [{ status: "ok", id: "t" }] }),
    ),
  /menos tickets que mensajes/,
);
ok("una respuesta con menos tickets que mensajes se rechaza en lugar de asumirse");

// --- Rate limit y errores de transporte --------------------------------------

await assert.rejects(async () => {
  try {
    await sendExpoPushBatch({ messages: [message] }, respondWith({}, 429));
  } catch (error) {
    assert.equal(error.retryable, true);
    assert.equal(error.status, 429);
    throw error;
  }
}, /rate limit/);
ok("un 429 se marca reintentable");

await assert.rejects(async () => {
  try {
    await sendExpoPushBatch({ messages: [message] }, respondWith({}, 400));
  } catch (error) {
    assert.equal(error.retryable, false);
    throw error;
  }
}, /rechazó la solicitud/);
ok("un 4xx del pedido no se reintenta: reintentarlo no lo arregla");

await assert.rejects(async () => {
  try {
    await sendExpoPushBatch({ messages: [message] }, async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
  } catch (error) {
    assert.equal(error.retryable, true);
    throw error;
  }
}, /no respondió a tiempo/);
ok("un timeout se marca reintentable y no da nada por entregado");

// --- Recibos -----------------------------------------------------------------

const receipts = await fetchExpoPushReceipts(
  { ticketIds: ["ticket-1", "ticket-2", "ticket-3"] },
  respondWith({
    data: {
      "ticket-1": { status: "ok" },
      "ticket-2": { status: "error", details: { error: "DeviceNotRegistered" } },
      // ticket-3 ausente a propósito
    },
  }),
);

assert.equal(captured.url, "https://exp.host/--/api/v2/push/getReceipts");
assert.deepEqual(JSON.parse(captured.options.body), { ids: ["ticket-1", "ticket-2", "ticket-3"] });
assert.equal(receipts.get("ticket-1").status, "delivered");
assert.equal(receipts.get("ticket-2").status, "failed");
assert.equal(receipts.get("ticket-2").reason, "device_unregistered");
ok("el recibo confirma la entrega o identifica el motivo del fallo");

assert.equal(receipts.get("ticket-3").status, "unknown");
assert.notEqual(receipts.get("ticket-3").status, "delivered");
ok("un recibo ausente queda como desconocido, nunca como entregado");

// --- Nada filtra el token de dispositivo -------------------------------------

try {
  await sendExpoPushBatch({ messages: [message] }, respondWith({}, 500));
} catch (error) {
  assert.ok(!String(error.message).includes("ExponentPushToken"));
  assert.ok(!String(error.stack).includes("ExponentPushToken"));
}
ok("un error del proveedor no expone el token del dispositivo");

console.log("\nok - contrato del proveedor de push Expo verificado");
console.log(
  "     pendiente: entrega en un dispositivo físico Android y iOS con credenciales reales",
);
