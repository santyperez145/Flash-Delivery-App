// Contrato del inicio del cliente (RES-01).
//
// La app del cliente se reorganizó como las de varios servicios: el inicio es la
// puerta a todos (viajes, rubros del catálogo y envíos), con «¿A dónde vas?», lo
// que está en curso y «Volver a pedir»; la barra es Inicio · Servicios ·
// Actividad · Cuenta. Desde FE-01 (web) y FE-02 (móvil) hay dos ámbitos, Pedidos y
// Viajes, con su inicio, su barra y su actividad. Lo que vigila este contrato son las decisiones que una
// edición distraída rompe sin que ninguna prueba de comportamiento lo note:
//
// - que se entre al inicio y no a la portada de un servicio;
// - que sólo se ofrezca lo que existe: rubros con comercios, y viajes y envíos
//   según sus interruptores, que la web ya respetaba y el móvil no;
// - que «Volver a pedir» salga de pedidos entregados, no de cualquier pedido;
// - que un destino elegido en el inicio llegue al viaje.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

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
// FE-02: la barra sigue al ámbito, como la web y como Uber Eats y Uber.
assert.ok(
  contains(barra, '{ vista: "home", rotulo: "Inicio", icono: "home-outline" },') &&
    contains(barra, 'rotulo: ambito === "pedidos" ? "Explorar" : "Servicios",') &&
    contains(barra, 'rotulo: ambito === "pedidos" ? "Pedidos" : "Actividad",') &&
    contains(barra, '{ vista: "account", rotulo: "Cuenta", icono: "person-outline" },') &&
    contains(coordinador, "<CustomerTabBar vista={sharedView} ambito={ambito}"),
  "la barra móvil no es la de su ámbito",
);
ok("se entra al inicio, y la barra es la de su ámbito");

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
// FE-02: cada inicio muestra lo suyo en curso, y lo del otro ámbito se avisa con un toque.
assert.ok(
  contains(inicio, "const enPedidos = activeOrders.map(") &&
    contains(inicio, "...activeRides.map(") &&
    contains(inicio, "...activeShipments.map(") &&
    contains(inicio, "const enCurso = pedidos ? enPedidos : enViajes;") &&
    contains(inicio, "const delOtroLado = pedidos ? enViajes : enPedidos;") &&
    contains(inicio, 'onPress={() => onChangeAmbito(pedidos ? "viajes" : "pedidos")}'),
  "lo en curso mezcla los ámbitos, o esconde lo del otro sin avisar",
);
ok("«Volver a pedir» sale de pedidos entregados, y lo en curso es del ámbito con aviso del otro");

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
const pestanaInicio = await leerWeb("CustomerHomeTab.tsx");
assert.ok(
  contains(superficie, '{tab === "home" && ( <CustomerHomeTab') &&
    contains(pestanaInicio, 'return ambito === "pedidos" ? ( <CustomerHome') &&
    contains(pestanaInicio, "<RidesHome") &&
    contains(
      superficie,
      "<CustomerServices features={props.features} ambito={ambito} onOpen={portada.abrir} />",
    ) &&
    !contains(superficie, "<ServiceToggle") &&
    !contains(navegacionWeb, "function ServiceToggle"),
  "la web no entra al inicio de su ámbito",
);
// FE-01: cada ámbito tiene su barra, como Uber Eats y Uber.
assert.ok(
  contains(navegacionWeb, '{ id: "home", label: "Inicio", icon: Home },') &&
    contains(navegacionWeb, 'label: pedidos ? "Explorar" : "Servicios"') &&
    contains(navegacionWeb, 'label: pedidos ? "Pedidos" : "Actividad"') &&
    contains(navegacionWeb, '{ id: "profile", label: "Cuenta", icon: UserRound },'),
  "la barra web no es la de su ámbito",
);
assert.ok(
  contains(inicioWeb, "if (features?.public_rides?.active ?? true)") &&
    contains(inicioWeb, "if (features?.shipment_beta?.active ?? true)") &&
    contains(inicioWeb, "if (rubro.merchants > 0)") &&
    contains(inicioWeb, 'if (rubros === "error")') &&
    contains(inicioWeb, 'if (vertical) { setRubro(vertical); setCategory("Todo"); setQuery(""); }'),
  "la web ofrece lo que no existe, o abre un rubro con filtros de otro",
);
const billetera = await leerWeb("WalletScreen.tsx");
assert.ok(
  contains(
    superficie,
    '<WalletLink wallet={user?.wallet ?? 0} onOpen={() => setTab("wallet")} />',
  ) &&
    contains(billetera, "export function WalletLink") &&
    contains(navegacionWeb, '(tab === "wallet" && id === "profile")'),
  "la Wallet no vive dentro de Cuenta",
);
ok("la web entra al inicio de su ámbito, con su barra, sólo lo que existe y Wallet en Cuenta");

// --- FE-01: Pedidos y Viajes separados ---------------------------------------
// Como Uber Eats y Uber: cada ámbito ofrece lo suyo, ve lo suyo en curso y en la
// actividad, y no se mezclan.
const ambitoWeb = await leerWeb("CustomerScope.tsx");
const feedWeb = await leerWeb("CustomerHomeFeed.tsx");
const actividadWeb = await leerWeb("CustomerActivityScreen.tsx");
assert.ok(
  contains(
    inicioWeb,
    'servicios: servicios.filter( (servicio) => (servicio.tipo === "vertical") === (ambito === "pedidos"), ),',
  ) &&
    contains(feedWeb, 'if (ambito === "pedidos") return propios(state.orders)') &&
    contains(
      actividadWeb,
      "state.orders.filter((order) => pedidos && order.customerId === user?.id)",
    ) &&
    contains(
      actividadWeb,
      "state.rides.filter((ride) => !pedidos && ride.customerId === user?.id)",
    ) &&
    contains(superficie, 'onCart={ambito === "pedidos" ? () => setCartOpen(true) : undefined}') &&
    contains(superficie, '{tab === "activity" && ambito === "pedidos" && ( <GroupOrderPanel'),
  "Pedidos y Viajes se mezclan: servicios, en curso, actividad o carrito",
);
assert.ok(
  contains(ambitoWeb, 'if (window.location.pathname.startsWith("/viajes")) return "viajes";') &&
    contains(ambitoWeb, 'if (["/", "/viajes"].includes(window.location.pathname))') &&
    contains(ambitoWeb, "} catch {"),
  "el ámbito no tiene su dirección, o falla sin almacenamiento",
);
// Calificar lo elige la persona: no se califica con 5 por ella.
assert.ok(
  !/createRating\([^)]*,\s*\d\s*\)/.test(squeeze(actividadWeb)) &&
    contains(actividadWeb, "runAction(() => api.createRating(jobId, subject, estrellas)"),
  "la actividad califica con un número fijo",
);
// Un destino reciente es un viaje terminado, y lo que va al viaje es su dirección.
const viajesWeb = await leerWeb("RidesLanding.tsx");
assert.ok(
  contains(viajesWeb, 'entry.status === "completed" &&') &&
    contains(viajesWeb, "destination: lugar.direccion,") &&
    contains(viajesWeb, "direccion: ride.destination,") &&
    contains(inicioWeb, "Boolean(restaurant?.open)") &&
    contains(actividadWeb, "!activo && restaurant?.open ? () => onOpenRestaurant(restaurant.id)"),
  "un viaje cancelado pasa por visitado, el destino lleva el subtítulo, o se ofrece volver a pedir en un cerrado",
);
ok("Pedidos y Viajes separados: servicios, en curso, actividad, carrito y dirección propios");

// --- FE-02: Pedidos y Viajes separados también en el móvil --------------------
const ambitoMovil = await leer("customer-scope.tsx");
const actividadMovil = await leer("screens/CustomerActivityScreen.tsx");
const formatoMovil = await leer("format.ts");
assert.ok(
  contains(ambitoMovil, 'servicio.tipo === "vertical" ? "pedidos" : "viajes"') &&
    contains(ambitoMovil, 'guardado === "viajes" && setAmbito("viajes")') &&
    contains(ambitoMovil, "void AsyncStorage.setItem(CLAVE, siguiente).catch(() => undefined);") &&
    contains(
      coordinador,
      '{["home", "services", "activity"].includes(sharedView) && ( <AmbitoSwitch ambito={ambito} onChange={cambiarAmbito} />',
    ),
  "móvil: no hay selector de Pedidos y Viajes, o no se recuerda la elección",
);
assert.ok(
  contains(
    inicio,
    "const servicios = disponibles.servicios.filter((servicio) => ambitoDe(servicio) === ambito);",
  ) &&
    contains(
      barra,
      "const servicios = disponibles.servicios.filter((servicio) => ambitoDe(servicio) === ambito);",
    ) &&
    contains(coordinador, 'activeOrders={ambito === "pedidos" ? activeOrders : []}') &&
    contains(coordinador, 'activeRides={ambito === "viajes" ? activeRides : []}') &&
    contains(coordinador, 'activeShipments={ambito === "viajes" ? activeShipments : []}') &&
    contains(coordinador, '(service) => (service.kind === "order") === (ambito === "pedidos"),') &&
    contains(
      coordinador,
      '(cancellation) => (cancellation.kind === "order") === (ambito === "pedidos"),',
    ) &&
    contains(actividadMovil, '{ambito === "pedidos" && ( <GroupOrderPanel'),
  "móvil: Pedidos y Viajes se mezclan en el inicio, los servicios o la actividad",
);
// El control del viaje es de seguridad: se ve en los dos ámbitos, no sólo en Viajes.
assert.ok(
  contains(inicio, "{ridesWithCheck.map((ride) => ( <TripCheckBanner") &&
    !contains(inicio, "{!pedidos && ridesWithCheck.map(") &&
    !contains(inicio, "{!pedidos && (ridesWithCheck"),
  "móvil: el aviso del control del viaje sólo se ve en Viajes",
);
// La actividad dice el estado en palabras, no el identificador del backend.
assert.ok(
  contains(actividadMovil, "{customerOrderStatusLabel[order.status]}") &&
    contains(actividadMovil, "{rideStatusLabel[ride.status]}") &&
    contains(actividadMovil, "{shipmentStatusLabel[shipment.status]}") &&
    !contains(actividadMovil, "{order.status}</Text>") &&
    contains(
      formatoMovil,
      'export const customerOrderStatusLabel: Record<Order["status"], string>',
    ),
  "móvil: la actividad muestra el estado crudo",
);
ok("móvil: Pedidos y Viajes separados, recordados, con seguridad en los dos y estados legibles");

// El cliente tiene el sitio también en escritorio, como ubereats.com: la puerta
// «seguí en la app» queda para el staff que no tiene portal y para quien maneja.
const app = await fs.readFile("src/App.tsx", "utf8");
assert.ok(
  contains(app, "if (isDesktop && !soloCliente) {") &&
    squeeze(app).indexOf(squeeze("const soloCliente")) <
      squeeze(app).indexOf(squeeze("if (isDesktop && !soloCliente)")),
  "el cliente en escritorio choca con la puerta de staff",
);
ok("el cliente pide también desde escritorio");

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
    contains(inicioWeb, "onClick={portada.buscar}"),
  "buscar desde el inicio arrastra la categoría o la búsqueda anterior",
);
const aviso = "{fallo && <AvisoRubros onRetry={reintentar} />}";
const cuantas = (fuente) => fuente.split(aviso).length - 1;
// En el móvil, el buscador es de Pedidos (FE-02): en Viajes está «¿A dónde vas?».
for (const [nombre, servicio, home, avisos, buscador] of [
  [
    "móvil",
    serviciosMovil,
    homeMovil,
    cuantas(homeMovil) + cuantas(barra),
    "{pedidos && hayComercios && (",
  ],
  ["web", inicioWeb, inicioWeb, cuantas(inicioWeb), "{hayComercios && ("],
])
  assert.ok(
    contains(servicio, 'fallo: rubros === "error",') &&
      contains(servicio, "reintentar: () => setIntento((n) => n + 1),") &&
      contains(home, buscador) &&
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

// --- RES-06: la web del cliente es un sitio, no la maqueta de staff ---------
assert.ok(
  contains(
    app,
    'const soloCliente = activeUser?.roles.every((role) => role === "customer") ?? false;',
  ) &&
    contains(app, "{!soloCliente && <PhoneStatus online={isOnline} />}") &&
    contains(app, "{!soloCliente && <AppModeBar mode={mode} onModeChange={switchMode} />}") &&
    contains(app, "{!soloCliente && ( <BrandPanel") &&
    contains(app, '{!soloCliente && ( <Suspense fallback={<aside className="ops-panel"') &&
    !contains(app, "function BrandPanel(") &&
    contains(await fs.readFile("src/shell/StaffShell.tsx", "utf8"), "export function BrandPanel("),
  "un cliente ve el marco de staff: métricas de la operación, teléfono o selector de perfiles",
);
assert.ok(
  contains(
    await fs.readFile("src/ui/SystemStateScreen.tsx", "utf8"),
    "user?.roles.map((role) => roleLabel[role])",
  ),
  "la pantalla de acceso muestra el rol crudo en inglés",
);
ok("un cliente ve Flash como un sitio, sin métricas de la operación ni selector de perfiles");
