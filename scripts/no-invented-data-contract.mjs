// Nada inventado (FE-04): el cableado, sin base.
//
// Probado en el navegador contra PostgreSQL: la consola de operaciones sin cifras de
// relleno (tasa de asignación «—» sin pedidos, zonas con su demanda configurada y no
// «en vivo», finanzas con su período, infraestructura sin hoja de ruta presentada como
// estado). Esto vigila que no vuelva lo inventado:
//
// - un producto nuevo no nace con 4,5 estrellas, 500 kcal, «Nuevo» ni la foto del local;
//   la migración 151 limpia lo que ya se guardó así;
// - la calificación de un comercio sale de calificaciones reales, con su cantidad, y se
//   muestra desde 10; la de quien maneja, sólo si alguien lo calificó;
// - la app no muestra conductores en línea al cliente, ni un formulario de tarjeta de
//   prueba, ni un vencimiento 2099, ni ceros de relleno;
// - el tablero no inventa un puntaje de madurez, hitos ni volumen con lo cancelado.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  catalogo,
  repositorio,
  migracion,
  componentes,
  webFormato,
  movilFormato,
  movilBuscar,
  movilLocal,
  viajeMovil,
  cuentaMovil,
  legajo,
  ganancias,
  asignados,
  tableroServidor,
  finanzasServidor,
  tipos,
  salud,
  inicioAdmin,
  editorHorario,
  seguimiento,
] = await Promise.all(
  [
    "server/http/catalog-router.js",
    "server/catalog-repository.js",
    "database/migrations/151_catalog_no_invented_metadata.sql",
    "src/customer/FoodCatalogComponents.tsx",
    "src/format.ts",
    "apps/mobile/src/format.ts",
    "apps/mobile/src/screens/CustomerFoodBrowseScreen.tsx",
    "apps/mobile/src/screens/CustomerFoodRestaurantScreen.tsx",
    "apps/mobile/src/screens/CustomerRideScreen.tsx",
    "apps/mobile/src/screens/CustomerAccountScreen.tsx",
    "apps/mobile/src/screens/DriverAccountPanel.tsx",
    "apps/mobile/src/screens/DriverEarningsPanel.tsx",
    "server/activity-repository.js",
    "server/http/admin-router.js",
    "server/operations-repository.js",
    "src/types.ts",
    "src/backoffice/AdminOverviewBoards.tsx",
    "src/backoffice/AdminOverviewHome.tsx",
    "src/merchant/MerchantCatalogEditors.tsx",
    "src/customer/OrderTrackingSheet.tsx",
  ].map(leer),
);

// --- El producto nuevo no nace con datos inventados --------------------------------------
const alta = catalogo.slice(catalogo.indexOf('"/api/restaurants/:restaurantId/menu"'));
for (const inventado of ["rating: 4.5", "kcal: 500", 'tags: ["Nuevo"]', "image: restaurant.image"])
  assert.ok(!contains(alta, inventado), `el alta de producto no escribe «${inventado}»`);
assert.ok(
  contains(
    alta,
    "...(Number.isInteger(declaredKcal) && declaredKcal > 0 && { kcal: declaredKcal }),",
  ) &&
    contains(
      alta,
      String.raw`...(/^https:\/\/\S+$/.test(declaredImage) && { image: declaredImage }),`,
    ),
  "kcal y foto sólo si el comercio los declaró",
);
assert.ok(
  contains(migracion, "SET metadata = metadata - 'kcal'") &&
    contains(migracion, "WHERE metadata -> 'kcal' = '500'::jsonb;") &&
    contains(migracion, "WHERE metadata -> 'tags' = '[\"Nuevo\"]'::jsonb;") &&
    contains(migracion, "AND ci.metadata ->> 'image' = m.metadata ->> 'image';"),
  "la migración 151 limpia los valores inventados ya guardados",
);

// --- Calificaciones reales --------------------------------------------------------------
assert.ok(
  contains(repositorio, "AS merchant_rating_count,") &&
    contains(
      repositorio,
      "rating: row.merchant_rating == null ? null : Number(row.merchant_rating),",
    ) &&
    contains(repositorio, "ratingCount: Number(row.merchant_rating_count || 0),"),
  "la calificación del comercio sale de calificaciones reales, con su cantidad",
);
assert.ok(
  !contains(repositorio, "metadata.rating ?? 0") &&
    !contains(repositorio, "rating: Number(metadata.rating || 0),"),
  "ni el comercio ni el producto caen a una calificación guardada en metadata",
);
for (const [fuente, plataforma] of [
  [componentes, "web"],
  [movilBuscar, "móvil"],
])
  assert.ok(
    contains(fuente, "MIN_MERCHANT_RATINGS = 10;") &&
      contains(
        fuente,
        "if (restaurant.rating == null || count < MIN_MERCHANT_RATINGS) return null;",
      ),
    `${plataforma}: la calificación del comercio se muestra desde 10 opiniones`,
  );
assert.ok(
  contains(asignados, "rating_count,") &&
    contains(asignados, "ratingCount: Number(row.rating_count || 0),") &&
    !contains(asignados, "r.subject_id=d.id),d.rating) rating"),
  "a quien pidió no le llega el 5 inicial de quien maneja como si fuera una nota",
);
for (const fuente of [webFormato, movilFormato])
  assert.ok(
    contains(fuente, "return driver.ratingCount && driver.ratingCount > 0") &&
      contains(fuente, ': "Nuevo";'),
    "la calificación de quien maneja, sólo si alguien lo calificó",
  );
assert.ok(
  contains(seguimiento, "{calificacionConductor(driver)}") &&
    !contains(seguimiento, "★ {driver.rating.toFixed(1)}"),
  "el seguimiento usa la calificación real",
);
assert.ok(
  contains(ganancias, 'if (driver.ratingCount <= 0) return "Todavía no te calificaron";'),
  "quien reparte sin calificaciones no ve un 5",
);

// --- La app sin relleno -------------------------------------------------------------------
assert.ok(
  !squeeze(viajeMovil).includes(squeeze("conductores`")) && !contains(viajeMovil, "online</Text>"),
  "el cliente no ve cuántos conductores hay en línea",
);
assert.ok(
  contains(cuentaMovil, "Todavía no se pueden agregar tarjetas desde la app.") &&
    !contains(cuentaMovil, "sandbox"),
  "la app no ofrece un formulario de tarjeta de prueba",
);
assert.ok(!contains(legajo, '"2099-12-31"'), "el vencimiento de un documento no viene precargado");
assert.ok(
  !contains(movilLocal, "uri: restaurant.image") && contains(movilLocal, "restaurant.open"),
  "el plato no usa la foto del local y «Abierto ahora» sale del estado real",
);

// --- Consolas -----------------------------------------------------------------------------
assert.ok(
  !contains(tableroServidor, "readinessScore") &&
    !contains(tableroServidor, "milestones:") &&
    !contains(tipos, "readinessScore: number;"),
  "el tablero no inventa un puntaje de madurez ni hitos",
);
assert.ok(
  contains(tableroServidor, '...db.orders.filter((order) => order.status !== "cancelled")') &&
    contains(
      tableroServidor,
      'const promedio = (values) => (values.length ? `$${average(values)}` : "—");',
    ) &&
    contains(
      finanzasServidor,
      "COALESCE(sum(amount_cents) FILTER(WHERE status IN ('captured','partially_refunded','refunded')),0)::bigint gross_processed_cents,",
    ),
  "el volumen no cuenta lo cancelado ni lo no cobrado, y un promedio sin datos es «—»",
);
assert.ok(
  contains(finanzasServidor, "FROM jobs WHERE status='completed' AND payment_method_label=$1") &&
    contains(
      finanzasServidor,
      "Number(payments.rows[0].gross_processed_cents) + Number(cash.rows[0].cents),",
    ),
  "lo cobrado en efectivo entra en el volumen",
);
assert.ok(
  contains(
    salud,
    '(dashboard ? !dashboard.marketplace.deliveryJobs : !state.orders.length) ? "—"',
  ) &&
    contains(salud, '(dashboard ? !dashboard.marketplace.rideJobs : !state.rides.length) ? "—"') &&
    contains(tableroServidor, "deliveryJobs: db.orders.length,"),
  "sin pedidos ni viajes en total, la tasa de asignación es «—», no 0%",
);
assert.ok(
  contains(salud, "Demanda configurada:") &&
    contains(inicioAdmin, 'title="Zonas de servicio"') &&
    !contains(inicioAdmin, 'action="Live"'),
  "la demanda de una zona se presenta como configuración, no como medición en vivo",
);
assert.ok(
  contains(editorHorario, "Esta sucursal todavía no tiene horario"),
  "una sucursal sin horario lo dice, sin un 9 a 23 precargado",
);

console.log("no invented data contract ok");
