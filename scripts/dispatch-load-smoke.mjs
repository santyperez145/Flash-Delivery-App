// Carga concurrente de dispatch sobre mil conductores sintéticos (DSP-001).
//
// `test:dispatch-plan` prueba el plan del recorte espacial sobre el padrón;
// acá se ejercita tráfico: muchas oleadas concurrentes de shortlist, scoring,
// emisión de ofertas y aceptaciones en paralelo. Refuerza la atomicidad que ya
// cubre `test:postgres`, pero bajo contención real entre workers.
//
// El padrón se confirma antes de medir: conexiones concurrentes no ven filas
// no confirmadas. Al terminar se borra por marca.
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { SHORTLIST_SQL } from "../server/dispatch-candidates.js";
import {
  acceptDispatchOffer,
  createDispatchOffers,
  processPostgresDispatchBatch,
} from "../server/dispatch-repository.js";
import {
  cleanupSyntheticPadron,
  LISTA_CORTA,
  PADRON,
  PICKUP,
  RADIO_M,
  pickupGeography,
  seedSyntheticPadron,
} from "./dispatch-synthetic-padron.mjs";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const CONCURRENCY = Number(process.env.DISPATCH_LOAD_CONCURRENCY || 32);
const ITERATIONS = Number(process.env.DISPATCH_LOAD_ITERATIONS || 40);
const MAX_P95_MS = Number(process.env.DISPATCH_LOAD_MAX_P95_MS || 5000);
const ACCEPT_FANOUT = Number(process.env.DISPATCH_LOAD_ACCEPT_FANOUT || 24);
const WORKER_FANOUT = Number(process.env.DISPATCH_LOAD_WORKER_FANOUT || 4);

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const comprobar = (condicion, etiqueta, detalle) => {
  if (condicion) return ok(etiqueta);
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
  return undefined;
};

const percentile = (values, p) =>
  values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];

async function createDeliveryJobs(client, { prefix, count, customerId }) {
  const jobs = [];
  for (let i = 0; i < count; i += 1) {
    const jitterLng = PICKUP.lng + (Math.random() - 0.5) * 0.02;
    const jitterLat = PICKUP.lat + (Math.random() - 0.5) * 0.02;
    const row = (
      await client.query(
        `INSERT INTO jobs(
           public_id, kind, customer_id, status, pickup_address, pickup_location,
           dropoff_address, dropoff_location, service_level, quoted_amount_cents,
           distance_m, estimated_duration_s, metadata
         ) VALUES (
           $1, 'delivery', $2, 'requested', 'Origen sintetico', ST_GeogFromText($3),
           'Destino sintetico',
           ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
           'standard', 250000, 3200, 900,
           jsonb_build_object('subtype','courier','dispatchNextAttemptAt','1970-01-01T00:00:00.000Z')
         ) RETURNING id, public_id`,
        [
          `${prefix}-JOB-${i}`,
          customerId,
          `SRID=4326;POINT(${jitterLng} ${jitterLat})`,
          jitterLng + 0.01,
          jitterLat - 0.01,
        ],
      )
    ).rows[0];
    jobs.push(row);
  }
  return jobs;
}

async function measureShortlist(client, pickup) {
  const started = performance.now();
  await client.query(SHORTLIST_SQL, [pickup, "delivery", RADIO_M, LISTA_CORTA]);
  return performance.now() - started;
}

async function measureFirstOffer(client, jobId) {
  const started = performance.now();
  const offers = await createDispatchOffers(client, { jobId, mode: "delivery", limit: 3 });
  return { ms: performance.now() - started, offers };
}

const marca = `dispatch-load-${crypto.randomBytes(4).toString("hex")}`;
const cliente = await pool.connect();
try {
  await cliente.query("BEGIN");
  const { count: padronCount } = await seedSyntheticPadron(cliente, marca, { withVehicles: true });
  await cliente.query("COMMIT");
  comprobar(
    padronCount >= PADRON,
    `el padrón sintético tiene ${padronCount} conductores con vehículo aprobado`,
  );
  await cliente.query("ANALYZE drivers");

  const customer = (
    await cliente.query("SELECT id FROM users WHERE public_id='usr_customer' LIMIT 1")
  ).rows[0];
  comprobar(Boolean(customer?.id), "existe un cliente sembrado para crear trabajos");
  if (!customer?.id) throw new Error("missing seeded customer");

  const pickup = pickupGeography();
  const shortlistSamples = [];
  for (let offset = 0; offset < ITERATIONS; offset += CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, ITERATIONS - offset) }, async () => {
        const worker = await pool.connect();
        try {
          return await measureShortlist(worker, pickup);
        } finally {
          worker.release();
        }
      }),
    );
    shortlistSamples.push(...batch);
  }
  shortlistSamples.sort((a, b) => a - b);
  const shortlistP95 = Number(percentile(shortlistSamples, 0.95).toFixed(2));
  console.log(
    `     shortlist concurrente: p50=${Number(percentile(shortlistSamples, 0.5).toFixed(2))}ms p95=${shortlistP95}ms n=${shortlistSamples.length}`,
  );
  comprobar(
    shortlistP95 <= MAX_P95_MS,
    `p95 del recorte espacial ≤ ${MAX_P95_MS} ms`,
    `medido ${shortlistP95} ms sobre ${shortlistSamples.length} consultas concurrentes`,
  );

  await cliente.query("BEGIN");
  const offerJobs = await createDeliveryJobs(cliente, {
    prefix: marca,
    count: ITERATIONS,
    customerId: customer.id,
  });
  await cliente.query("COMMIT");
  await cliente.query("ANALYZE jobs");

  const offerSamples = [];
  for (let offset = 0; offset < offerJobs.length; offset += CONCURRENCY) {
    const slice = offerJobs.slice(offset, offset + CONCURRENCY);
    const batch = await Promise.all(
      slice.map(async (job) => {
        const worker = await pool.connect();
        try {
          await worker.query("BEGIN");
          const sample = await measureFirstOffer(worker, job.id);
          await worker.query("COMMIT");
          return sample;
        } catch (error) {
          await worker.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          worker.release();
        }
      }),
    );
    offerSamples.push(...batch);
  }
  const offerTimes = offerSamples.map((sample) => sample.ms).sort((a, b) => a - b);
  const offerP95 = Number(percentile(offerTimes, 0.95).toFixed(2));
  const withOffers = offerSamples.filter((sample) => sample.offers.length > 0).length;
  console.log(
    `     primera oferta concurrente: p50=${Number(percentile(offerTimes, 0.5).toFixed(2))}ms p95=${offerP95}ms con oferta=${withOffers}/${offerSamples.length}`,
  );
  comprobar(
    withOffers > 0,
    "al menos una oleada concurrente emitió ofertas",
    `${withOffers} de ${offerSamples.length} devolvieron filas`,
  );
  comprobar(
    offerP95 <= MAX_P95_MS,
    `p95 de la primera oferta ≤ ${MAX_P95_MS} ms`,
    `medido ${offerP95} ms sobre ${offerTimes.length} oleadas concurrentes`,
  );

  await cliente.query("BEGIN");
  await createDeliveryJobs(cliente, {
    prefix: `${marca}-worker`,
    count: WORKER_FANOUT * 8,
    customerId: customer.id,
  });
  await cliente.query("COMMIT");

  const workerResults = await Promise.all(
    Array.from({ length: WORKER_FANOUT }, () => processPostgresDispatchBatch({ limit: 8 })),
  );
  const workerOffered = workerResults.reduce((sum, entry) => sum + entry.offered, 0);
  const workerClaimed = workerResults.reduce((sum, entry) => sum + entry.claimed, 0);
  console.log(
    `     workers concurrentes: claimed=${workerClaimed} offered=${workerOffered} fanout=${WORKER_FANOUT}`,
  );
  comprobar(workerOffered > 0, "workers concurrentes emitieron ofertas bajo contención");

  const duplicateOffers = await cliente.query(
    `SELECT o.job_id, o.driver_id, count(*)::int n
     FROM dispatch_offers o
     JOIN jobs j ON j.id = o.job_id
     WHERE j.public_id LIKE $1 || '%'
     GROUP BY o.job_id, o.driver_id
     HAVING count(*) > 1`,
    [marca],
  );
  comprobar(
    duplicateOffers.rowCount === 0,
    "cero pares job/conductor duplicados bajo carga concurrente",
    duplicateOffers.rows.map((row) => `${row.job_id}/${row.driver_id}×${row.n}`).join(", ") ||
      undefined,
  );

  const assignmentJob = (
    await cliente.query(
      `SELECT j.public_id, j.id, d.public_id driver_public_id, u.id actor_user_id
       FROM dispatch_offers o
       JOIN jobs j ON j.id = o.job_id
       JOIN drivers d ON d.id = o.driver_id
       JOIN users u ON u.id = d.user_id
       WHERE j.public_id LIKE $1 || '%' AND o.status = 'pending' AND o.expires_at > now()
         AND j.driver_id IS NULL
       ORDER BY o.created_at
       LIMIT 1`,
      [`${marca}-JOB`],
    )
  ).rows[0];
  comprobar(Boolean(assignmentJob), "hay una oferta pendiente para probar aceptación concurrente");
  if (assignmentJob) {
    const accepts = await Promise.all(
      Array.from({ length: ACCEPT_FANOUT }, async () => {
        const worker = await pool.connect();
        try {
          await worker.query("BEGIN");
          try {
            await acceptDispatchOffer(worker, {
              jobPublicId: assignmentJob.public_id,
              driverPublicId: assignmentJob.driver_public_id,
              actorUserId: assignmentJob.actor_user_id,
            });
            await worker.query("COMMIT");
            return 200;
          } catch (error) {
            await worker.query("ROLLBACK");
            return error.status || 500;
          }
        } finally {
          worker.release();
        }
      }),
    );
    const winners = accepts.filter((status) => status === 200).length;
    const conflicts = accepts.filter((status) => status === 409).length;
    comprobar(
      winners === 1 && conflicts === ACCEPT_FANOUT - 1,
      "aceptación concurrente deja exactamente un ganador",
      `200×${winners} 409×${conflicts}`,
    );
    const assigned = await cliente.query(
      "SELECT count(*)::int n FROM jobs WHERE id=$1 AND driver_id IS NOT NULL",
      [assignmentJob.id],
    );
    const acceptedOffers = await cliente.query(
      "SELECT count(*)::int n FROM dispatch_offers WHERE job_id=$1 AND status='accepted'",
      [assignmentJob.id],
    );
    comprobar(
      assigned.rows[0].n === 1 && acceptedOffers.rows[0].n === 1,
      "cero dobles asignaciones bajo aceptación concurrente forzada",
    );
  }
} finally {
  await cleanupSyntheticPadron(cliente, marca).catch(() => {});
  cliente.release();
  await pool.end();
}

if (fallos) {
  console.error(`\n${fallos} comprobación(es) de carga de dispatch fallaron`);
  process.exit(1);
}
console.log(
  `\nok - carga concurrente de dispatch sobre ${PADRON} conductores (p95≤${MAX_P95_MS}ms, sin dobles asignaciones)`,
);
