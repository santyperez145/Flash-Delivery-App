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

const pool = createPool();
const client = await pool.connect();

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
  {
    label: "alérgenos declarados (gluten)",
    sql: `INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence)
          SELECT id,'gluten','contains' FROM catalog_items
          WHERE public_id IN ('item_burger_brava','item_pizza_muzzarella','item_pizza_fugazzeta')
          ON CONFLICT DO NOTHING`,
  },
  {
    label: "alérgenos declarados (leche)",
    sql: `INSERT INTO catalog_item_allergens(catalog_item_id,allergen_code,presence)
          SELECT id,'milk','contains' FROM catalog_items
          WHERE public_id IN ('item_burger_brava','item_pizza_muzzarella','item_pizza_fugazzeta')
          ON CONFLICT DO NOTHING`,
  },
  {
    label: "etiquetas dietarias",
    sql: `INSERT INTO catalog_item_dietary_labels(catalog_item_id,dietary_code)
          SELECT id,'vegetarian' FROM catalog_items
          WHERE public_id IN ('item_papas_trufa','item_pizza_muzzarella','item_pizza_fugazzeta')
          ON CONFLICT DO NOTHING`,
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
  const applied = [];
  for (const step of steps) {
    const result = await client.query(step.sql);
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
