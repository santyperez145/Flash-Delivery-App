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
const servicios = await leer("customer-services.tsx");
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
// Un resumen leído y vacío no ofrece pedir; sólo un resumen que falló cae en el
// catálogo ya cargado.
assert.ok(
  contains(servicios, 'if (rubros === "error")') &&
    contains(servicios, '.catch(() => vigente && setRubros("error"));'),
  "un catálogo sin comercios igual ofrece pedir comida",
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
// Entrar a un rubro empieza de cero, desde el inicio y desde Servicios.
assert.ok(
  contains(
    coordinador,
    'const abrirRubro = (vertical: MerchantVertical) => { setFoodVertical(vertical); setFoodCategory("Todos"); setFoodQuery("");',
  ) && coordinador.split("onOpenVertical={abrirRubro}").length - 1 === 2,
  "abrir un rubro arrastra la cocina o la búsqueda de otro",
);
ok("el destino y el rubro elegidos en el inicio llegan a su servicio");

// --- La web (RES-02): la misma estructura que el móvil ----------------------
const leerWeb = (ruta) => fs.readFile(`src/customer/${ruta}`, "utf8");
const superficie = await leerWeb("CustomerSurface.tsx");
const navegacionWeb = await leerWeb("CustomerNavigation.tsx");
const inicioWeb = await leerWeb("CustomerHome.tsx");
assert.ok(
  contains(superficie, '{tab === "home" && !portada.enServicio && ( <CustomerHome') &&
    contains(superficie, "<CustomerServices features={props.features} onOpen={portada.abrir} />") &&
    !contains(superficie, "<ServiceToggle") &&
    !contains(navegacionWeb, "function ServiceToggle"),
  "la web no entra al inicio con todos los servicios",
);
const rotulosWeb = [...navegacionWeb.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(
  rotulosWeb,
  ["Inicio", "Servicios", "Actividad", "Cuenta"],
  "la barra web no es Inicio · Servicios · Actividad · Cuenta",
);
assert.ok(
  contains(inicioWeb, "if (features?.public_rides?.active ?? true)") &&
    contains(inicioWeb, "if (features?.shipment_beta?.active ?? true)") &&
    contains(inicioWeb, "if (rubro.merchants > 0)") &&
    contains(inicioWeb, 'if (rubros === "error")') &&
    contains(inicioWeb, 'if (vertical) { setRubro(vertical); setCategory("Todo"); setQuery(""); }'),
  "la web ofrece lo que no existe, o abre un rubro con filtros de otro",
);
assert.ok(
  contains(
    superficie,
    '<WalletLink wallet={user?.wallet ?? 0} onOpen={() => setTab("wallet")} />',
  ) && contains(navegacionWeb, '(tab === "wallet" && id === "profile")'),
  "la Wallet no vive dentro de Cuenta",
);
ok("la web tiene la misma estructura: inicio, barra, sólo lo que existe y Wallet en Cuenta");

// Buscar desde el inicio empieza de cero, sin comercios no hay buscador, y un
// resumen de rubros que falló se dice y se puede reintentar. En las dos plataformas.
const homeMovil = await leer("screens/CustomerHomeScreen.tsx");
const serviciosMovil = await leer("customer-services.tsx");
assert.ok(
  contains(
    coordinador,
    'onSearch={() => { // Buscar empieza de cero: una cocina de antes ocultaría lo que coincide. setFoodCategory("Todos"); setFoodQuery("");',
  ) &&
    contains(inicioWeb, 'const buscar = () => { setCategory("Todo"); setQuery("");') &&
    contains(superficie, "onSearch={portada.buscar}"),
  "buscar desde el inicio arrastra la categoría o la búsqueda anterior",
);
const aviso = "{fallo && <AvisoRubros onRetry={reintentar} />}";
const cuantas = (fuente) => fuente.split(aviso).length - 1;
for (const [nombre, servicio, home, avisos] of [
  ["móvil", serviciosMovil, homeMovil, cuantas(homeMovil) + cuantas(barra)],
  ["web", inicioWeb, inicioWeb, cuantas(inicioWeb)],
])
  assert.ok(
    contains(servicio, 'fallo: rubros === "error",') &&
      contains(servicio, "reintentar: () => setIntento((n) => n + 1),") &&
      contains(home, "{hayComercios && (") &&
      // En el inicio y en Servicios: los dos lugares que ofrecen rubros.
      avisos === 2,
    `${nombre}: el buscador aparece sin comercios, o un fallo se ve como disponibilidad`,
  );
ok("buscar empieza de cero, sin comercios no hay buscador y un fallo se dice con reintento");

// RES-03: la hoja del inicio queda bien cerrada (un conflicto resuelto a mano dejó
// las promociones anidadas en otra regla) y los platos «de comercios abiertos» lo son.
const hoja = await fs.readFile("src/styles/customer-home.css", "utf8");
let profundidad = 0;
for (const caracter of hoja) {
  if (caracter === "{") profundidad += 1;
  if (caracter === "}") profundidad -= 1;
  assert.ok(
    profundidad >= 0 && profundidad <= 1,
    "customer-home.css anida reglas: falta cerrar una",
  );
}
assert.equal(profundidad, 0, "customer-home.css termina con una regla abierta");
assert.ok(
  contains(await leerWeb("FoodDiscoveryHome.tsx"), ".filter(({ restaurant }) => restaurant.open)"),
  "la lista de platos de comercios abiertos incluye comercios cerrados",
);
ok("la hoja del inicio está bien cerrada y los platos son de comercios abiertos");
