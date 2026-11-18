// Contrato de rubros de comercio (P-01, paridad con PedidosYa y Uber Eats).
//
// `merchants.vertical` existe desde la migración 001 con cinco valores y ninguna
// pantalla lo mostraba: una capacidad construida en la base e invisible en el
// producto, que es la deuda más cara porque no se ve. Este contrato verifica,
// sin base de datos, que el rubro llegue de la base a la portada por todos los
// eslabones, y que la lista de rubros sea **una sola** en todas las capas.
//
// El comportamiento con datos —el filtro, el resumen, el 400 ante un rubro
// desconocido— lo prueba `test:catalog-pagination` contra PostgreSQL.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, readWebSource } from "./source-contract.mjs";
import { MERCHANT_VERTICALS } from "../server/catalog-repository.js";

const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const leer = (ruta) => fs.readFile(ruta, "utf8");

// --- Una sola lista de rubros, la de la base ---------------------------------
const migracion = await leer("database/migrations/001_core.sql");
const check = migracion.match(/vertical text NOT NULL CHECK \(vertical IN \(([^)]*)\)\)/);
assert.ok(check, "no se encontró el CHECK de merchants.vertical en la migración 001");
const deLaBase = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
assert.deepEqual(
  [...MERCHANT_VERTICALS].sort(),
  deLaBase,
  "MERCHANT_VERTICALS del servidor no coincide con el CHECK de la base",
);
const contrato = await leer("packages/domain-contracts/src/index.ts");
const union = contrato.match(/export type MerchantVertical =([^;]*);/);
assert.ok(union, "el dominio compartido no declara MerchantVertical");
assert.deepEqual(
  [...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(),
  deLaBase,
  "MerchantVertical del dominio compartido no coincide con la base",
);
const rail = await leer("src/customer/VerticalRail.tsx");
for (const rubro of deLaBase)
  assert.ok(contains(rail, `${rubro}: { label:`), `la portada web no rotula el rubro ${rubro}`);
ok("servidor, dominio compartido y portada web usan los cinco rubros de la base");

// --- La base filtra, el router valida ----------------------------------------
const repositorio = await leer("server/catalog-repository.js");
assert.ok(
  contains(repositorio, "AND ($5::text IS NULL OR vertical=$5)"),
  "la página del catálogo no filtra por rubro en la base",
);
assert.ok(
  contains(repositorio, "vertical: restaurant.vertical,"),
  "el catálogo no publica el rubro",
);
const router = await leer("server/http/catalog-router.js");
assert.ok(
  contains(router, "if (vertical && !MERCHANT_VERTICALS.includes(vertical))") &&
    contains(router, 'router.get("/api/catalog/verticals"'),
  "el router no valida el rubro o no expone el resumen de rubros",
);
ok("el rubro filtra en la base, se valida en el router y tiene su resumen");

// --- La portada pide una página por rubro y muestra los accesos --------------
const { source: web } = await readWebSource();
assert.ok(
  contains(web, "? catalogApi.getHome(50)") &&
    contains(web, "getCatalogVerticals: catalogApi.getVerticals,"),
  "la carga inicial no pide el catálogo por rubro",
);
const portada = await leer("src/customer/FoodDiscoveryHome.tsx");
assert.ok(
  contains(portada, "<VerticalRail {...scope.rail} />") && contains(portada, "useVerticalScope("),
  "la portada web no muestra los rubros",
);
// Con una búsqueda escrita el rubro no filtra: quien busca «hielo» desde
// Restaurantes quiere el kiosco que lo vende, no una lista vacía.
assert.ok(
  contains(
    rail,
    "const enRubro = (restaurant: Restaurant) => buscando || activo === null || rubroDe(restaurant) === activo;",
  ),
  "con una búsqueda escrita, el rubro sigue filtrando",
);
ok("la portada carga cada rubro, muestra sus accesos y la búsqueda los atraviesa");

// --- Nada inventado: el seed respeta el rubro y la prueba trae lo suyo --------
// No se siembran comercios ficticios de otros rubros. La prueba contra PostgreSQL
// crea su propio comercio, rotulado como prueba, y lo borra en un `finally`.
const seed = await leer("scripts/db-seed-commerce.mjs");
assert.ok(
  contains(seed, 'restaurant.vertical || "restaurant",') &&
    !contains(seed, "$3, 'restaurant', 'active'"),
  "el seed vuelve a forzar todos los comercios a restaurante",
);
const prueba = await leer("scripts/catalog-pagination-smoke.mjs");
assert.ok(
  contains(prueba, "'Prueba automática P-01', 'pharmacy'") &&
    contains(
      prueba,
      '} finally { await pool.query("DELETE FROM merchants WHERE public_id=$1", [idPrueba]);',
    ),
  "la prueba de rubros no crea su propio comercio o no lo borra siempre",
);
ok("el seed respeta el rubro y la prueba usa un comercio propio que siempre borra");

// --- La app móvil, que es la superficie principal del cliente ----------------
// El portal web desktop deriva al cliente a la app: si el rubro llegara sólo a la
// web, la capacidad existiría donde casi nadie la ve.
const movilRail = await leer("apps/mobile/src/VerticalRail.tsx");
for (const rubro of deLaBase)
  assert.ok(contains(movilRail, `${rubro}: { label:`), `la app móvil no rotula el rubro ${rubro}`);
const movilApi = await leer("apps/mobile/src/api.ts");
assert.ok(
  contains(movilApi, ": catalogApi.getHome(50),") &&
    contains(movilApi, "getCatalogVerticals: catalogApi.getVerticals,"),
  "la carga inicial móvil no pide el catálogo por rubro",
);
const portadaMovil = await leer("apps/mobile/src/screens/CustomerFoodBrowseScreen.tsx");
assert.ok(
  contains(portadaMovil, "<VerticalRail {...scope.rail} />") &&
    contains(
      portadaMovil,
      "useVerticalScope({ restaurants, allRestaurants, categories, onSelectCategory })",
    ),
  "la portada móvil no muestra los rubros",
);
// Web y móvil todavía no comparten un paquete de cliente: los dos clientes de
// catálogo tienen que pedir exactamente lo mismo.
// `[ \t]*` y no `\s*`: con la bandera `m`, `\s` también consume saltos de línea y
// el recorte dependería de cuántas líneas en blanco rodean a cada comentario.
const sinComentarios = (fuente) =>
  fuente
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*\/\/.*\n/gm, "")
    .trim();
assert.equal(
  sinComentarios(await leer("apps/mobile/src/catalog-api.ts")),
  sinComentarios(await leer("src/catalog-api.ts")),
  "el cliente de catálogo móvil se desincronizó del web",
);
ok("la app móvil carga cada rubro, muestra sus accesos y pide lo mismo que la web");

// --- Defectos que encontró la revisión del PR ---------------------------------
// 1. Un catálogo de un solo rubro que no es restaurante quedaba vacío: el rubro
//    arrancaba en «restaurant» y la barra se oculta con uno solo.
for (const [nombre, fuente] of [
  ["web", rail],
  ["móvil", movilRail],
]) {
  assert.ok(
    contains(
      fuente,
      "verticals.some((entry) => entry.vertical === vertical) ? vertical : verticals[0].vertical;",
    ) && contains(fuente, "activo === null ||"),
    `la portada ${nombre} no ajusta el rubro activo al resumen`,
  );
}
// 2. En el móvil las categorías son cocinas, no categorías de menú, y se calculan
//    sobre el catálogo sin filtrar por cocina.
assert.ok(
  contains(
    movilRail,
    'allRestaurants.filter(delRubro).map((restaurant) => restaurant.cuisine.trim() || "Otros")',
  ),
  "la portada móvil filtra las cocinas como si fueran categorías de menú",
);
// 3. Cambiar de rubro en el móvil vuelve a «Todos», como en la web.
assert.ok(
  contains(movilRail, 'onSelectCategory("Todos");'),
  "cambiar de rubro en el móvil conserva la cocina anterior",
);
ok("el rubro activo existe, las cocinas móviles se respetan y cambiar de rubro limpia la cocina");
