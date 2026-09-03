// Padrón sintético de dispatch (DSP-001).
//
// Mil conductores en línea repartidos alrededor del Obelisco hasta unos 40 km.
// Con los tres del sembrado el planificador elige Seq Scan y hace bien; este
// padrón es el mínimo donde el recorte espacial y la carga concurrente miden
// algo útil.
export const PADRON = 1000;
export const RADIO_M = 8000;
export const LISTA_CORTA = 30;
export const PICKUP = { lng: -58.3816, lat: -34.6037 };

/**
 * Inserta usuarios, conductores y —opcionalmente— vehículos aprobados.
 * Devuelve la marca usada para filtrar y el conteo insertado.
 */
export async function seedSyntheticPadron(client, marca, { withVehicles = false } = {}) {
  await client.query(
    `INSERT INTO users(public_id, email, password_hash, name, email_verified_at)
     SELECT $1 || '-' || i, $1 || '-' || i || '@flash.test', 'x', 'Conductor sintetico ' || i, now()
     FROM generate_series(1, $2) i`,
    [marca, PADRON],
  );
  await client.query(
    `INSERT INTO drivers(public_id, user_id, online, active_mode, service_modes, rating,
                         current_location, location_updated_at, location_accuracy_m)
     SELECT 'DRV-' || u.public_id, u.id, true, 'delivery', ARRAY['delivery']::job_kind[], 4.5,
            ST_SetSRID(ST_MakePoint($2 + (random() - 0.5) * 0.8, $3 + (random() - 0.5) * 0.8), 4326)::geography,
            now(), 20
     FROM users u WHERE u.public_id LIKE $1 || '-%'`,
    [marca, PICKUP.lng, PICKUP.lat],
  );
  if (withVehicles) {
    await client.query(
      `INSERT INTO vehicles(
         driver_id, kind, model, plate, color, seats, active, public_id,
         service_modes, status, reviewed_at
       )
       SELECT d.id, 'motorcycle', 'Synth moto', 'SYN' || replace(u.public_id, '-', ''), 'Gris', 1, true,
              'VEH-' || replace(u.public_id, '-', ''), ARRAY['delivery']::job_kind[], 'approved', now()
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       WHERE u.public_id LIKE $1 || '-%'`,
      [marca],
    );
  }
  const padron = await client.query(
    "SELECT count(*)::int n FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.public_id LIKE $1 || '-%'",
    [marca],
  );
  return { marca, count: padron.rows[0].n };
}

export function pickupGeography(lng = PICKUP.lng, lat = PICKUP.lat) {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/** Elimina ofertas, trabajos, vehículos, conductores y usuarios del padrón. */
export async function cleanupSyntheticPadron(client, marcaPrefix) {
  await client.query(
    `DELETE FROM dispatch_offers
     WHERE job_id IN (SELECT id FROM jobs WHERE public_id LIKE $1 || '%')`,
    [marcaPrefix],
  );
  await client.query("DELETE FROM jobs WHERE public_id LIKE $1 || '%'", [marcaPrefix]);
  await client.query(
    `DELETE FROM notifications
     WHERE user_id IN (SELECT u.id FROM users u WHERE u.public_id LIKE $1 || '-%')`,
    [marcaPrefix],
  );
  await client.query(
    `DELETE FROM vehicles
     WHERE driver_id IN (
       SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.public_id LIKE $1 || '-%'
     )`,
    [marcaPrefix],
  );
  await client.query(
    `DELETE FROM drivers d USING users u
     WHERE d.user_id = u.id AND u.public_id LIKE $1 || '-%'`,
    [marcaPrefix],
  );
  await client.query("DELETE FROM users WHERE public_id LIKE $1 || '-%'", [marcaPrefix]);
}
