import { createPool } from "./db-client.mjs";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  assert = (condition, label) => {
    if (!condition) throw new Error(`failed: ${label}`);
    console.log(`ok - ${label}`);
  };
async function get(path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const first = await get("/catalog/restaurants?limit=1");
assert(
  first.status === 200 &&
    first.body.restaurants.length === 1 &&
    first.headers.get("cache-control")?.includes("max-age=30"),
  "public catalog enforces page size and bounded cache policy",
);
const restaurant = first.body.restaurants[0],
  serialized = JSON.stringify(restaurant);
assert(
  !Object.hasOwn(restaurant, "ownerId") &&
    !Object.hasOwn(restaurant, "manualOpen") &&
    !serialized.includes("inventory") &&
    !serialized.includes("weeklyHours") &&
    !serialized.includes("scheduleExceptions"),
  "public serializer excludes owner and branch operations data",
);
if (first.body.nextCursor) {
  const second = await get(
    `/catalog/restaurants?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  assert(
    second.status === 200 && second.body.restaurants[0]?.id !== restaurant.id,
    "catalog cursor advances without duplicates",
  );
}
const search = await get(
  `/catalog/restaurants?limit=20&q=${encodeURIComponent(restaurant.name.slice(0, 5))}`,
);
assert(
  search.body.restaurants.some((item) => item.id === restaurant.id),
  "catalog search filters server-side by merchant identity",
);
assert(
  (await get("/catalog/restaurants?cursor=invalid")).status === 400,
  "catalog rejects malformed cursor",
);

// --- Rubros de comercio (P-01) ------------------------------------------------
// La base sembrada sólo tiene restaurantes, y no se siembran comercios
// inventados de otros rubros: nada falso en ninguna base. Para probar el filtro
// de verdad, la prueba crea **su propio** comercio, rotulado como prueba, y lo
// borra al terminar pase lo que pase.
const pool = createPool();
const idPrueba = `test_p01_pharmacy_${Date.now()}`;
try {
  await pool.query(
    `INSERT INTO merchants(public_id, owner_id, name, vertical, status, address, location, open, eta_min, delivery_fee_cents, metadata)
     SELECT $1, owner_id, 'Prueba automática P-01', 'pharmacy', 'active', 'Prueba', location, true, 20, 0, '{}'::jsonb
     FROM merchants WHERE status='active' ORDER BY created_at LIMIT 1`,
    [idPrueba],
  );
  const rubros = await get("/catalog/verticals");
  const resumen = new Map(
    (rubros.body.verticals || []).map((entry) => [entry.vertical, entry.merchants]),
  );
  assert(
    rubros.status === 200 &&
      rubros.headers.get("cache-control")?.includes("max-age=60") &&
      resumen.get("restaurant") > 0 &&
      resumen.get("pharmacy") > 0 &&
      [...resumen.values()].every((cantidad) => cantidad > 0),
    "verticals summary lists only populated verticals with bounded cache",
  );
  assert(restaurant.vertical === "restaurant", "public serializer publishes the merchant vertical");
  const farmacias = await get("/catalog/restaurants?limit=50&vertical=pharmacy");
  const restaurantes = await get("/catalog/restaurants?limit=50&vertical=restaurant");
  assert(
    farmacias.status === 200 &&
      farmacias.body.restaurants.some((item) => item.id === idPrueba) &&
      farmacias.body.restaurants.every((item) => item.vertical === "pharmacy") &&
      !restaurantes.body.restaurants.some((item) => item.id === idPrueba),
    "catalog filters by vertical server-side, in both directions",
  );
  assert(
    (await get("/catalog/restaurants?vertical=casino")).status === 400,
    "catalog rejects an unknown vertical instead of returning an empty list",
  );
} finally {
  await pool.query("DELETE FROM merchants WHERE public_id=$1", [idPrueba]);
  await pool.end();
}
