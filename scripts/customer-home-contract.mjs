// Contrato del inicio del cliente (RES-01).
//
// La app del cliente se reorganizó como las de varios servicios: el inicio es la
// puerta a todos (viajes, rubros del catálogo y envíos), con «¿A dónde vas?», lo
// que está en curso y «Volver a pedir»; la barra es Inicio · Servicios ·
// Actividad · Cuenta. Lo que vigila este contrato son las decisiones que una
// edición distraída rompe sin que ninguna prueba de comportamiento lo note:
//
// - que se entre al inicio y no a la portada de un servicio;
// - que sólo se ofrezca lo que existe: rubros con comercios, y viajes y envíos
//   según sus interruptores, que la web ya respetaba y el móvil no;
// - que «Volver a pedir» salga de pedidos entregados, no de cualquier pedido;
// - que un destino elegido en el inicio llegue al viaje.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains } from "./source-contract.mjs";

const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const leer = (ruta) => fs.readFile(`apps/mobile/src/${ruta}`, "utf8");

const coordinador = await leer("screens/CustomerScreen.tsx");
const barra = await leer("screens/CustomerTabBar.tsx");
const inicio = await leer("screens/CustomerHomeScreen.tsx");
const servicios = await leer("customer-services.ts");
const viaje = await leer("screens/CustomerRideScreen.tsx");

assert.ok(
  contains(coordinador, 'const [sharedView, setSharedView] = useState<VistaCliente>("home");') &&
    contains(coordinador, "<CustomerHomeScreen") &&
    contains(coordinador, "<CustomerServicesScreen") &&
    contains(coordinador, "<CustomerTabBar") &&
    !contains(coordinador, "styles.serviceNav"),
  "la app del cliente no entra al inicio con todos los servicios",
);
const rotulos = [...barra.matchAll(/rotulo: "([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(
  rotulos,
  ["Inicio", "Servicios", "Actividad", "Cuenta"],
  "la barra no es Inicio · Servicios · Actividad · Cuenta",
);
ok("se entra al inicio, y la barra es Inicio · Servicios · Actividad · Cuenta");

assert.ok(
  contains(servicios, "if (flags?.public_rides?.active ?? true)") &&
    contains(servicios, "if (flags?.shipment_beta?.active ?? true)") &&
    contains(servicios, "if (rubro.merchants > 0)") &&
    contains(servicios, 'request<{ features: Flags }>("/features")'),
  "el inicio ofrece servicios apagados o rubros sin comercios",
);
ok("sólo se ofrece lo que existe: rubros con comercios y servicios encendidos");

assert.ok(
  contains(inicio, 'order.customerId === user.id && order.status === "delivered"') &&
    contains(
      inicio,
      "if (restaurant?.open && !yaPedidos.some((entry) => entry.id === restaurant.id))",
    ),
  "«Volver a pedir» no sale de pedidos entregados en comercios abiertos",
);
assert.ok(
  contains(inicio, "...activeOrders.map(") &&
    contains(inicio, "...activeRides.map(") &&
    contains(inicio, "...activeShipments.map("),
  "lo que está en curso no reúne pedidos, viajes y envíos",
);
ok("«Volver a pedir» sale de pedidos entregados, y lo en curso reúne los tres servicios");

assert.ok(
  contains(coordinador, "selectedDestination={rideDestination}") &&
    contains(viaje, "setDestination(selectedDestination.address);") &&
    contains(viaje, "setDestinationCoords(selectedDestination.point);"),
  "un destino elegido en el inicio no llega al viaje",
);
assert.ok(
  contains(coordinador, "initialVertical={foodVertical}") &&
    contains(await leer("VerticalRail.tsx"), "useState<MerchantVertical>(initialVertical)"),
  "el rubro tocado en el inicio no es el que abre la tienda",
);
ok("el destino y el rubro elegidos en el inicio llegan a su servicio");
