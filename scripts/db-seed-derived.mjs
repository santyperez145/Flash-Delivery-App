// Datos derivados del catálogo y del padrón sembrado.
//
// Ocho migraciones hacen backfill de datos que se derivan de comercios, ítems,
// usuarios, conductores y trabajos ya existentes. Ese backfill sólo alcanzó a
// las filas presentes cuando la migración se aplicó.
//
// En una base creada desde cero el orden se invierte: las migraciones corren
// antes que los seeds, así que todas esas tablas quedan vacías. El resultado es
// que un ambiente nuevo NO es equivalente a uno migrado en su momento: sin
// sucursales, sin cumplimiento de conductores, sin métodos de pago wallet, sin
// modificadores de catálogo, sin alérgenos, sin perfiles de soporte, sin
// vehículos y sin sesiones operativas.
//
// Este script repite las mismas derivaciones de forma idempotente. Correrlo
// después de los seeds deja la base equivalente a una migrada históricamente.
//
// Se descubrió al levantar PostgreSQL en CI por primera vez (ticket CI-001):
// `test:rls` fallaba porque afirmaba sobre modificadores y alérgenos que en una
// base nueva no existían.
import { createPool } from "./db-client.mjs";

// Declaraciones sobre el catálogo sembrado. No son datos inventados: se
// corresponden con la composición real de cada plato.
const GLUTEN_ITEMS = ["item_burger_brava", "item_pizza_burrata", "item_tiramisu", "item_salmon_furai"];
const MILK_ITEMS = ["item_burger_brava", "item_pizza_burrata", "item_tiramisu", "item_caesar_veggie"];
const VEGETARIAN_ITEMS = ["item_papas_trufa", "item_pizza_burrata", "item_caesar_veggie", "item_tiramisu"];

const pool = createPool();
const client = await pool.connect();

/**
 * Falla si una declaración apunta a un ítem que ya no está en el catálogo.
 *
 * Sin esto la deriva es silenciosa: la migración 059 quedó apuntando a dos
 * pizzas que dejaron de existir y el catálogo se quedó sin alérgenos sin que
 * nada lo dijera.
 */
async function assertCatalogItemsExist(referenced) {
  const present = (
    await client.query("SELECT public_id FROM catalog_items WHERE public_id = ANY($1::text[])", [
      referenced,
    ])
  ).rows.map((row) => row.public_id);
  const missing = referenced.filter((id) => !present.includes(id));
  if (missing.length) {
    throw new Error(
      `Estas declaraciones apuntan a ítems que no existen en el catálogo: ${missing.join(", ")}. ` +
        "Actualizá las listas de scripts/db-seed-derived.mjs o el seed del catálogo.",
    );
  }
}

const steps = [
  {
    // 052_email_verification hizo `UPDATE users SET email_verified_at=...` sobre
    // los usuarios que ya existían. En una base desde cero los seeds corren
    // después, así que las cuentas quedan sin verificar y **no pueden iniciar
    // sesión**: la API responde "Debes verificar tu email".
    //
    // Es el backfill más caro de omitir: sin él la plataforma entera queda
    // inaccesible en un ambiente nuevo, incluido el primer despliegue.
    label: "verificación de email de cuentas sembradas",
    sql: `UPDATE users SET email_verified_at=COALESCE(email_verified_at,created_at)
          WHERE email_verified_at IS NULL`,
  },
  {
    // El motor de riesgo suma 20 puntos por `new_account` cuando la cuenta tiene
    // menos de 24 horas. En una base creada desde cero **todas** las cuentas
    // sembradas son nuevas, así que cualquier pedido arranca con esos puntos y
    // se combina con velocidad y gasto hasta bloquear la operación.
    //
    // En la base local de un desarrollador esto nunca se nota: las cuentas se
    // crearon hace semanas. Es dependencia del ambiente, no del código.
    //
    // Envejecer las cuentas de fixture las vuelve representativas de una cuenta
    // establecida, que es lo que los flujos asumen. Sólo alcanza a las cuentas
    // sembradas (`usr_*`), nunca a las que crea una prueba.
    label: "antigüedad de las cuentas de fixture",
    sql: `UPDATE users SET created_at=now()-interval '90 days'
          WHERE public_id LIKE 'usr\_%' AND created_at > now()-interval '1 day'`,
  },
  {
    // 089_driver_location_telemetry clasificó como 'legacy' las posiciones que
    // ya existían. Una posición sembrada sin origen queda sin clasificar.
    label: "origen de ubicación de conductores",
    sql: `UPDATE drivers SET location_source='legacy'
          WHERE current_location IS NOT NULL AND location_source IS NULL`,
  },
  {
    label: "sucursales principales",
    sql: `INSERT INTO merchant_branches(public_id,merchant_id,name,address,location,status,open,eta_min,service_radius_m,is_primary)
          SELECT 'branch_'||m.public_id,m.id,m.name||' · Principal',m.address,m.location,
                 CASE WHEN m.status='active' THEN 'active' ELSE 'paused' END,m.open,m.eta_min,m.service_radius_m,true
          FROM merchants m
          ON CONFLICT (public_id) DO NOTHING`,
  },
  {
    // La migración 055 sembró horarios sólo para las sucursales que existían al
    // aplicarse. Una sucursal sin horario hace que `branch_is_scheduled_open`
    // devuelva false, y la búsqueda de catálogo filtra por esa función: **sin
    // horarios, el catálogo entero es invisible**.
    //
    // 00:00–00:00 significa abierto todo el día, igual que en la migración.
    label: "horarios de sucursal",
    sql: `INSERT INTO branch_operating_hours(branch_id,weekday,opens_at,closes_at)
          SELECT b.id,d,'00:00','00:00' FROM merchant_branches b CROSS JOIN generate_series(0,6) d
          ON CONFLICT DO NOTHING`,
  },
  {
    label: "inventario por sucursal",
    sql: `INSERT INTO catalog_branch_inventory(branch_id,catalog_item_id,available,stock_quantity)
          SELECT b.id,c.id,c.available,c.inventory_quantity
          FROM merchant_branches b JOIN catalog_items c ON c.merchant_id=b.merchant_id
          ON CONFLICT DO NOTHING`,
  },
  {
    label: "sucursal de los trabajos existentes",
    sql: `UPDATE jobs j SET branch_id=b.id FROM merchant_branches b
          WHERE b.merchant_id=j.merchant_id AND b.is_primary AND j.branch_id IS NULL`,
  },
  {
    label: "cumplimiento de conductores",
    sql: `INSERT INTO driver_compliance(driver_id,status,submitted_at,reviewed_at,rejection_reason)
          SELECT id,'approved',created_at,now(),'Migración legacy: requiere recertificación en próximo vencimiento'
          FROM drivers
          ON CONFLICT (driver_id) DO NOTHING`,
  },
  {
    label: "métodos de pago wallet",
    sql: `INSERT INTO payment_methods(user_id,provider,provider_payment_method_id,kind,is_default)
          SELECT u.id,'flash_wallet','wallet:'||u.public_id,'wallet',
                 NOT EXISTS(SELECT 1 FROM payment_methods pm WHERE pm.user_id=u.id AND pm.revoked_at IS NULL AND pm.is_default)
          FROM users u
          WHERE NOT EXISTS(SELECT 1 FROM payment_methods pm WHERE pm.user_id=u.id AND pm.kind='wallet' AND pm.revoked_at IS NULL)`,
  },
  {
    label: "grupos de modificadores",
    sql: `INSERT INTO catalog_modifier_groups(public_id,catalog_item_id,name,minimum_selections,maximum_selections)
          SELECT 'extras',c.id,'Agregados',0,LEAST(6,jsonb_array_length(m.metadata->'extras'))
          FROM catalog_items c JOIN merchants m ON m.id=c.merchant_id
          WHERE jsonb_typeof(m.metadata->'extras')='array' AND jsonb_array_length(m.metadata->'extras')>0
          ON CONFLICT (catalog_item_id,public_id) DO NOTHING`,
  },
  {
    label: "modificadores de catálogo",
    sql: `INSERT INTO catalog_modifiers(public_id,group_id,name,price_cents,sort_order)
          SELECT extra->>'id',g.id,extra->>'name',round((extra->>'price')::numeric*100)::bigint,ordinality-1
          FROM catalog_modifier_groups g
          JOIN catalog_items c ON c.id=g.catalog_item_id
          JOIN merchants m ON m.id=c.merchant_id
          CROSS JOIN LATERAL jsonb_array_elements(m.metadata->'extras') WITH ORDINALITY AS value(extra,ordinality)
          WHERE g.public_id='extras'
          ON CONFLICT (group_id,public_id) DO NOTHING`,
  },
  // La migración 059 fijó estos alérgenos sobre `item_pizza_muzzarella` e
  // `item_pizza_fugazzeta`, que **ya no existen**: el catálogo sembrado cambió
  // después y nada conectaba ambas cosas. La pizza actual es
  // `item_pizza_burrata`, que quedaba sin declarar ningún alérgeno.
  //
  // Es una tercera cara de H-11: no basta con reaplicar el backfill, hay que
  // hacerlo sobre el catálogo que existe. `assertCatalogItemsExist` levanta la
  // deriva en lugar de dejar que vuelva a pasar en silencio.
  {
    label: "alérgenos declarados (gluten)",
    sql: `INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence)
          SELECT id,'gluten','contains' FROM catalog_items
          WHERE public_id = ANY($1::text[])
          ON CONFLICT DO NOTHING`,
    params: [GLUTEN_ITEMS],
  },
  {
    label: "alérgenos declarados (leche)",
    sql: `INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence)
          SELECT id,'milk','contains' FROM catalog_items
          WHERE public_id = ANY($1::text[])
          ON CONFLICT DO NOTHING`,
    params: [MILK_ITEMS],
  },
  {
    label: "etiquetas dietarias",
    sql: `INSERT INTO catalog_item_dietary_labels(catalog_item_id,dietary_code)
          SELECT id,'vegetarian' FROM catalog_items
          WHERE public_id = ANY($1::text[])
          ON CONFLICT DO NOTHING`,
    params: [VEGETARIAN_ITEMS],
  },
  {
    label: "perfiles de agentes de soporte",
    sql: `INSERT INTO support_agent_profiles(user_id,availability,max_active_tickets,skills)
          SELECT DISTINCT u.id,'available',20,ARRAY['all']::text[]
          FROM users u JOIN user_roles ur ON ur.user_id=u.id
          WHERE ur.role IN('admin','support')
          ON CONFLICT(user_id) DO NOTHING`,
  },
  {
    label: "vehículos de conductores",
    sql: `INSERT INTO vehicles(driver_id,kind,model,plate,color,seats,active,public_id,service_modes,status,reviewed_at)
          SELECT d.id,
                 CASE WHEN 'ride'::job_kind = ANY(d.service_modes) THEN 'car' ELSE 'motorcycle' END,
                 COALESCE(NULLIF(d.metadata->>'vehicle',''),'Vehículo por verificar'),
                 upper(COALESCE(NULLIF(d.metadata->>'plate',''),'LEGACY-'||substr(replace(d.id::text,'-',''),1,8))),
                 NULL,
                 CASE WHEN 'ride'::job_kind = ANY(d.service_modes) THEN 4 ELSE 1 END,
                 true,
                 'VEH-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
                 d.service_modes,'approved',now()
          FROM drivers d
          WHERE NOT EXISTS(SELECT 1 FROM vehicles v WHERE v.driver_id=d.id)`,
  },
  {
    label: "sesiones de disponibilidad abiertas",
    sql: `INSERT INTO driver_availability_sessions(driver_id,service_mode,started_at,start_reason)
          SELECT id,active_mode,now(),'migration_baseline' FROM drivers d
          WHERE d.online
            AND NOT EXISTS(SELECT 1 FROM driver_availability_sessions s WHERE s.driver_id=d.id AND s.ended_at IS NULL)`,
  },
  {
    label: "sesiones de trabajo abiertas",
    sql: `INSERT INTO driver_job_sessions(driver_id,job_id,service_mode,started_at,start_reason)
          SELECT j.driver_id,j.id,j.kind,now(),'migration_baseline' FROM jobs j
          WHERE j.driver_id IS NOT NULL AND j.status NOT IN('completed','cancelled')
            AND NOT EXISTS(SELECT 1 FROM driver_job_sessions s WHERE s.job_id=j.id AND s.ended_at IS NULL)`,
  },
];

try {
  await client.query("BEGIN");
  await assertCatalogItemsExist([
    ...new Set([...GLUTEN_ITEMS, ...MILK_ITEMS, ...VEGETARIAN_ITEMS]),
  ]);
  const applied = [];
  for (const step of steps) {
    const result = await client.query(step.sql, step.params);
    applied.push(`${step.label}: ${result.rowCount}`);
  }
  await client.query("COMMIT");
  for (const line of applied) console.log(`  ${line}`);
  console.log(`seeded derived fixtures across ${steps.length} backfills`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
