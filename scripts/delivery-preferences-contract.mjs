// Contrato de preferencias de entrega (P-02, paridad con Uber Eats y PedidosYa).
//
// Las reglas viven en `server/delivery-preferences.js` y las prueba
// `test:authorization` sin base. Este contrato verifica lo otro: que estén
// **conectadas** en cada capa —servidor, web, móvil— y, sobre todo, que cada
// camino por el que un comercio o un repartidor sin asignar lee un pedido pase
// por el recorte de privacidad. Un camino nuevo que se olvide del recorte le
// muestra a un tercero el timbre de la casa de alguien.
//
// El comportamiento con datos —que se guarden, que el reintento las devuelva,
// que el comercio no vea las indicaciones, el 409 de idempotencia— lo prueba
// `test:postgres` contra PostgreSQL.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, readAudienceSource, readWebSource } from "./source-contract.mjs";
import { MAX_INDICACIONES } from "../server/delivery-preferences.js";

const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const leer = (ruta) => fs.readFile(ruta, "utf8");

// --- Servidor: se aceptan, se validan, se guardan y se publican ---------------
const ruta = await leer("server/http/order-router.js");
const repositorio = await leer("server/order-repository.js");
assert.ok(
  contains(ruta, "deliveryPreferences: z.object({") &&
    contains(ruta, "instructions: z.string().max(MAX_INDICACIONES)") &&
    contains(ruta, "deliveryPreferences, idempotencyKey,"),
  "la ruta no acepta o no pasa las preferencias de entrega",
);
assert.ok(
  contains(
    repositorio,
    "normalizarPreferencias(preferenciasPedidas, { fulfillment, vertical: merchant.rows[0].vertical, })",
  ) &&
    contains(repositorio, "fulfillment, deliveryPreferences, // `null`") &&
    contains(repositorio, "deliveryPreferences: preferenciasDesdeMetadata(metadata),"),
  "el repositorio no valida, no guarda o no publica las preferencias",
);
ok("el servidor acepta, valida contra modo y rubro, guarda y publica las preferencias");

// **Idempotencia completa.** Todo lo que cambia el pedido guardado entra al
// hash: antes faltaban propina, horario, modo y sucursal, y la misma clave con
// otra propina devolvía el pedido anterior sin 409.
// El fin se busca a partir del inicio: el archivo tiene otros `.digest` antes.
const inicioHash = repositorio.indexOf("const requestHash");
const hash = repositorio.slice(inicioHash, repositorio.indexOf('.digest("hex")', inicioHash));
assert.ok(inicioHash > 0 && hash.length > 200, "no se encontró el hash de idempotencia");
for (const campo of [
  "tipCents,",
  "scheduledFor:",
  "fulfillment,",
  "branchId:",
  "deliveryPreferences,",
])
  assert.ok(contains(hash, campo), `el hash de idempotencia no incluye ${campo}`);
// Y la respuesta que se repite en un reintento tiene los mismos campos que la
// lectura del pedido.
const respuesta = repositorio.slice(
  repositorio.indexOf("const responseOrder = {"),
  repositorio.indexOf("UPDATE idempotency_keys SET response_status"),
);
for (const campo of [
  "fulfillment,",
  "deliveryPreferences,",
  "tip: metadata.tip,",
  "scheduledFor: metadata.scheduledFor,",
])
  assert.ok(contains(respuesta, campo), `la respuesta idempotente no incluye ${campo}`);
ok("el hash de idempotencia y la respuesta repetida cubren todo lo que cambia el pedido");

// --- Privacidad: cada camino de lectura recorta --------------------------------
assert.ok(
  contains(repositorio, ".filter(Boolean) .map(paraElComercio),"),
  "la cola del comercio no recorta las preferencias",
);
const actividad = await leer("server/activity-repository.js");
assert.ok(
  contains(
    actividad,
    "(j.customer_id=actor.id OR d.user_id=actor.id OR 'admin'=ANY($2::text[])) ve_entrega",
  ) && contains(actividad, "veEntrega.get(item.id) ? item : paraElComercio(item)"),
  "la actividad le muestra al comercio las indicaciones de entrega",
);
const estado = await leer("server/fallback-runtime.js");
assert.ok(
  contains(
    estado,
    ".filter((entry) => merchantIds.has(entry.restaurantId)) .map(paraElComercio);",
  ) && contains(estado, "paraRepartidorSinAsignar({"),
  "el estado inicial no recorta para el comercio o para el repartidor sin asignar",
);
const despacho = await leer("server/dispatch-repository.js");
assert.ok(
  contains(
    despacho,
    "hasInstructions: Boolean(row.metadata?.deliveryPreferences?.instructions),",
  ) && !/instructions:\s*row\.metadata/.test(despacho),
  "la oferta de despacho expone el texto de las indicaciones",
);
// Las respuestas de las acciones también devuelven el pedido: avanzar y cambiar
// el estado recortan según quién pidió. Lo encontró la revisión del PR: el
// comercio que avanzaba un pedido recibía las indicaciones del cliente.
const rutaPedidos = await leer("server/http/order-router.js");
const respuestasRecortadas =
  rutaPedidos.match(/order: vistaDelPedido\(req, db\.orders\[index\]\)/g) || [];
assert.equal(
  respuestasRecortadas.length,
  2,
  "avanzar o cambiar el estado devuelve el pedido sin recortar",
);
const comercio = await leer("server/http/merchant-router.js");
assert.ok(
  contains(
    comercio,
    ".filter((order) => order.restaurantId === restaurant.id) .map(paraElComercio);",
  ) && contains(comercio, "orders: all.slice(0, limit).map(paraElComercio),"),
  "el respaldo SQLite del comercio devuelve las preferencias sin recortar",
);
ok(
  "comercio, actividad, estado inicial, ofertas y respuestas de acciones recortan las preferencias",
);

// --- Las mismas reglas en las tres capas ----------------------------------------
const { source: web } = await readWebSource();
const { source: movil } = await readAudienceSource(["apps/mobile/src"]);
for (const [nombre, fuente] of [
  ["web", web],
  ["móvil", movil],
]) {
  assert.ok(
    contains(fuente, `const MAX_INDICACIONES = ${MAX_INDICACIONES};`) &&
      contains(fuente, 'const RUBROS_SIN_PUERTA: MerchantVertical[] = ["pharmacy", "retail"];'),
    `el cliente ${nombre} no usa el mismo largo o los mismos rubros que el servidor`,
  );
}
const reglas = await leer("server/delivery-preferences.js");
assert.ok(
  contains(reglas, 'const RUBROS_SIN_PUERTA = new Set(["pharmacy", "retail"]);'),
  "el servidor cambió los rubros sin puerta y los clientes no",
);
ok("servidor, web y móvil usan el mismo largo y los mismos rubros sin puerta");

// --- Web: el checkout las ofrece y las manda; comercio y reparto las ven ------
const carrito = await leer("src/customer/FoodCartScreen.tsx");
assert.ok(
  contains(carrito, "<FoodDeliveryPreferences") &&
    contains(carrito, "deliveryPreferences: preferencias,") &&
    contains(
      carrito,
      "deliveryPreferences: { ...PREFERENCIAS_INICIALES, cutlery: preferencias.cutlery },",
    ),
  "el checkout web no ofrece o no manda las preferencias, o manda reparto en un retiro",
);
assert.ok(
  contains(web, 'preferencias="cocina"') &&
    contains(web, 'preferencias="reparto"') &&
    contains(
      web,
      '<DeliveryPreferenceTags preferences={order.deliveryPreferences} audience="cocina" />',
    ) &&
    contains(web, 'oferta.leaveAtDoor ? " · sin contacto" : ""'),
  "la web no le muestra al comercio los cubiertos o al repartidor el modo y las indicaciones",
);
ok("la web ofrece las preferencias y las muestra a cocina y reparto");

// --- Móvil: lo mismo, en la superficie principal del cliente -----------------
const checkoutMovil = await leer("apps/mobile/src/screens/CustomerFoodCheckoutScreen.tsx");
const coordinadorMovil = await leer("apps/mobile/src/screens/CustomerScreen.tsx");
assert.ok(
  contains(checkoutMovil, "<DeliveryPreferences") &&
    contains(coordinadorMovil, "deliveryPreferences: foodPreferences,") &&
    contains(coordinadorMovil, "setFoodPreferences(PREFERENCIAS_INICIALES);"),
  "el checkout móvil no ofrece, no manda o no reinicia las preferencias",
);
assert.ok(
  contains(movil, 'preferencias="cocina"') &&
    contains(movil, 'preferencias="reparto"') &&
    contains(movil, 'offer.leaveAtDoor && "Dejar en la puerta"'),
  "la app móvil no le muestra al comercio los cubiertos o al repartidor el modo y las indicaciones",
);
ok("la app móvil ofrece las preferencias, las reinicia tras el pedido y las muestra");
