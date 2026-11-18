import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { scoreCandidates, shortlistDrivers } from "./dispatch-candidates.js";
import { config } from "./config.js";
import { CASH_LABEL, driverWalletBalanceCents } from "./wallet-repository.js";

/**
 * PAG-01: ¿el conductor está dentro del tope de deuda por viajes en efectivo? Deber
 * exactamente el tope todavía se permite; pasarlo, no.
 */
const puedeTomarEfectivo = async (client, driverId) =>
  (await driverWalletBalanceCents(client, driverId)) >= -config.cashDriverDebtLimitCents;

/** PAG-01: de una lista de conductores, los que pueden tomar un viaje en efectivo. */
const elegiblesParaEfectivo = async (client, driverIds) =>
  driverIds.length === 0
    ? []
    : (
        await client.query(
          `SELECT d.id FROM drivers d
           LEFT JOIN ledger_accounts a ON a.owner_type='user' AND a.owner_id=d.user_id AND a.account_type='wallet'
           LEFT JOIN ledger_entries e ON e.account_id=a.id
           WHERE d.id = ANY($1)
           GROUP BY d.id
           HAVING COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0) >= $2`,
          [driverIds, -config.cashDriverDebtLimitCents],
        )
      ).rows
        .map((row) => row.id)
        // Se respeta el orden por cercanía de la lista corta.
        .sort((a, b) => driverIds.indexOf(a) - driverIds.indexOf(b));

const offerId = () => `OFR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

// **Un pedido para retirar nunca entra al despacho** (GTM-002). El predicado de
// comida selecciona por `status='ready_for_pickup'`, que es exactamente el estado
// al que llega un pedido retirado cuando la cocina termina: sin el filtro de
// `fulfillment`, cada pedido que el cliente va a buscar al local se le ofreceria
// a tres conductores, y el primero que aceptara se llevaria comida que nadie
// pidio que se mueva.
//
// El filtro esta en las cuatro consultas y no en una funcion compartida porque
// son cuatro consultas distintas —barrido, candidatos, oferta y aceptacion— y una
// sola de ellas sin el filtro vuelve a abrir el agujero. `test:dispatch-candidates`
// cuenta que esten las cuatro.
export async function createDispatchOffers(client, { jobId, mode, limit = 3, ttlSeconds = 45 }) {
  // Las compuertas del trabajo se evalúan una sola vez, no por candidato.
  const job = (
    await client.query(
      `SELECT j.id,j.pickup_location::text pickup,
      (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup')
      AND COALESCE(j.metadata->>'fulfillment','delivery')<>'pickup' ready,
      (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes') in_window,
      (j.kind='ride' AND j.payment_method_label=$2) cash
    FROM jobs j WHERE j.id=$1`,
      [jobId, CASH_LABEL],
    )
  ).rows[0];
  if (!job || !job.pickup || !job.ready || !job.in_window) return [];

  // Etapa 1: recorte espacial con ST_DWithin y orden KNN sobre el índice GiST.
  const { driverIds, radiusM, expanded } = await shortlistDrivers(client, {
    pickup: job.pickup,
    mode,
    needed: limit,
  });
  // PAG-01: un viaje en efectivo no se le ofrece a quien ya debe más del tope en
  // comisiones de viajes en efectivo. Se filtra la lista corta **antes** de puntuar:
  // filtrar después del corte dejaba el viaje sin ofertas si los mejores puntuados
  // debían de más, aunque hubiera otros conductores habilitados.
  const habilitados = job.cash ? await elegiblesParaEfectivo(client, driverIds) : driverIds;
  // Etapa 2: puntuación explicable, sólo sobre la lista corta.
  const candidates = {
    rows: await scoreCandidates(client, { jobId, driverIds: habilitados, mode, limit }),
  };

  const offers = [];
  for (const candidate of candidates.rows) {
    const scoreBreakdown = {
      searchRadiusM: radiusM,
      radiusExpanded: expanded,
      rating: Number(candidate.rating_points),
      distancePenalty: Number(candidate.distance_penalty),
      loadPenalty: Number(candidate.load_penalty),
      freshnessPenalty: Number(candidate.freshness_penalty),
      acceptancePoints: Number(candidate.acceptance_points),
      responsePoints: Number(candidate.response_points),
      acceptanceRate: Number(candidate.acceptance_rate),
      averageResponseSeconds: Number(candidate.average_response_seconds),
    };
    const row = (
      await client.query(
        `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at,score_breakdown)
      VALUES($1,$2,$3,$4,now()+($5*interval '1 second'),$6)
      ON CONFLICT(job_id,driver_id) DO NOTHING RETURNING public_id,expires_at`,
        [offerId(), jobId, candidate.id, candidate.score, ttlSeconds, scoreBreakdown],
      )
    ).rows[0];
    if (row) {
      offers.push(row.public_id);
      await enqueueNotificationForInternalUser(client, {
        userId: candidate.user_id,
        template: "dispatch_offer",
        payload: {
          offerId: row.public_id,
          jobId: candidate.job_public_id,
          kind: candidate.kind,
          subtype: candidate.metadata?.subtype || null,
          expiresAt: row.expires_at,
          score: Number(candidate.score),
          scoreBreakdown,
        },
        deduplicationKey: `dispatch_offer:${row.public_id}`,
      });
    }
  }
  return offers;
}

export async function processPostgresDispatchBatch({
  limit = 20,
  offerLimit = 3,
  ttlSeconds = 45,
} = {}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const expired = (
      await client.query(
        "UPDATE dispatch_offers SET status='expired',responded_at=now() WHERE status='pending' AND expires_at<=now() RETURNING id",
      )
    ).rowCount;
    const jobs = (
      await client.query(
        `SELECT j.id,j.public_id,j.kind,COALESCE((j.metadata->>'dispatchRound')::int,0) dispatch_round
      FROM jobs j WHERE j.driver_id IS NULL AND j.status NOT IN('completed','cancelled')
        AND (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup')
      AND COALESCE(j.metadata->>'fulfillment','delivery')<>'pickup'
        AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes')
        AND NOT EXISTS(SELECT 1 FROM dispatch_offers o WHERE o.job_id=j.id AND o.status='pending' AND o.expires_at>now())
        AND COALESCE((j.metadata->>'dispatchNextAttemptAt')::timestamptz,'epoch')<=now()
      ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      )
    ).rows;
    let offered = 0,
      exhausted = 0;
    for (const job of jobs) {
      const offers = await createDispatchOffers(client, {
        jobId: job.id,
        mode: job.kind,
        limit: offerLimit,
        ttlSeconds,
      });
      offered += offers.length;
      if (!offers.length) exhausted += 1;
      const nextAttempt = new Date(
        Date.now() + (offers.length ? ttlSeconds * 1000 + 1000 : 300000),
      ).toISOString();
      await client.query(
        `UPDATE jobs SET metadata=jsonb_set(jsonb_set(metadata,'{dispatchRound}',to_jsonb($2::int),true),'{dispatchNextAttemptAt}',to_jsonb($3::text),true),updated_at=now() WHERE id=$1`,
        [job.id, job.dispatch_round + 1, nextAttempt],
      );
    }
    await client.query("COMMIT");
    return { claimed: jobs.length, expired, offered, exhausted };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresDispatchOffers(driverPublicId) {
  await postgresPool.query(
    "UPDATE dispatch_offers SET status='expired',responded_at=now() WHERE status='pending' AND expires_at<=now()",
  );
  const result = await postgresPool.query(
    `SELECT o.public_id,j.public_id job_id,j.kind,j.service_level,j.pickup_address,j.dropoff_address,
      j.quoted_amount_cents,j.distance_m,j.estimated_duration_s,j.metadata,o.score,o.score_breakdown,o.expires_at,o.status,
      (j.kind='ride' AND j.payment_method_label=$2) cash
    FROM dispatch_offers o JOIN drivers d ON d.id=o.driver_id JOIN jobs j ON j.id=o.job_id
    WHERE d.public_id=$1 AND o.status='pending' AND o.expires_at>now() AND j.driver_id IS NULL AND j.status NOT IN('completed','cancelled')
      AND (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup')
      AND COALESCE(j.metadata->>'fulfillment','delivery')<>'pickup'
      AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes')
    ORDER BY o.score DESC,o.expires_at LIMIT 50`,
    [driverPublicId, CASH_LABEL],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    jobId: row.job_id,
    kind: row.kind,
    serviceLevel: row.service_level,
    pickup: row.pickup_address,
    destination: row.dropoff_address,
    fare: Number(row.quoted_amount_cents) / 100,
    distanceKm: Number((row.distance_m / 1000).toFixed(1)),
    durationMin: Math.ceil(row.estimated_duration_s / 60),
    score: Number(row.score),
    scoreBreakdown: row.score_breakdown || {},
    expiresAt: new Date(row.expires_at).toISOString(),
    status: row.status,
    subtype: row.metadata?.subtype || null,
    // PAG-01: antes de aceptar, quien maneja sabe si cobra en mano.
    cash: Boolean(row.cash),
    // Antes de aceptar, el repartidor sabe si es sin contacto y si hay
    // indicaciones —como en DoorDash y Uber—, pero no el texto, que es de la
    // casa de alguien y recién lo ve quien acepta (P-02).
    leaveAtDoor: row.metadata?.deliveryPreferences?.dropoff === "leave_at_door",
    hasInstructions: Boolean(row.metadata?.deliveryPreferences?.instructions),
  }));
}

export async function rejectPostgresDispatchOffer({ driverPublicId, offerPublicId }) {
  const result = await postgresPool.query(
    `UPDATE dispatch_offers o SET status='rejected',responded_at=now() FROM drivers d
    WHERE o.driver_id=d.id AND d.public_id=$1 AND o.public_id=$2 AND o.status='pending' AND o.expires_at>now() RETURNING o.public_id`,
    [driverPublicId, offerPublicId],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("La oferta no existe o ya venció"), { status: 409 });
  return result.rows[0].public_id;
}

export async function acceptDispatchOffer(
  client,
  { jobPublicId, driverPublicId, actorUserId, status = "driver_assigned" },
) {
  const offer = (
    await client.query(
      `SELECT o.id,o.job_id,o.driver_id,j.kind,(j.kind='ride' AND j.payment_method_label=$3) cash
    FROM dispatch_offers o JOIN jobs j ON j.id=o.job_id JOIN drivers d ON d.id=o.driver_id
    WHERE j.public_id=$1 AND d.public_id=$2 AND o.status='pending' AND o.expires_at>now()
      AND (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup')
      AND COALESCE(j.metadata->>'fulfillment','delivery')<>'pickup'
      AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes') FOR UPDATE OF o`,
      [jobPublicId, driverPublicId, CASH_LABEL],
    )
  ).rows[0];
  if (!offer) throw Object.assign(new Error("La oferta no existe o venció"), { status: 409 });
  await client.query("SELECT id FROM drivers WHERE id=$1 FOR UPDATE", [offer.driver_id]);
  if (offer.cash && !(await puedeTomarEfectivo(client, offer.driver_id)))
    throw Object.assign(
      new Error(
        "Tenés comisiones de viajes en efectivo por saldar: no podés tomar otro en efectivo",
      ),
      { status: 409 },
    );
  const active = Number(
    (
      await client.query(
        "SELECT count(*)::int count FROM jobs WHERE driver_id=$1 AND kind=$2 AND status NOT IN('completed','cancelled')",
        [offer.driver_id, offer.kind],
      )
    ).rows[0].count,
  );
  if ((offer.kind === "ride" && active > 0) || (offer.kind === "delivery" && active >= 2))
    throw Object.assign(new Error("El conductor alcanzó su capacidad activa"), { status: 409 });
  const changed = (
    await client.query(
      `UPDATE jobs SET driver_id=$1,status=$2,version=version+1,updated_at=now()
    WHERE id=$3 AND driver_id IS NULL AND status NOT IN('completed','cancelled')
      AND (COALESCE(metadata->>'subtype','')<>'food_order' OR status='ready_for_pickup') RETURNING id,customer_id`,
      [offer.driver_id, status, offer.job_id],
    )
  ).rows[0];
  if (!changed) throw Object.assign(new Error("El servicio ya fue tomado"), { status: 409 });
  await client.query(
    "UPDATE dispatch_offers SET status='accepted',responded_at=now() WHERE id=$1",
    [offer.id],
  );
  await client.query(
    "UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE job_id=$1 AND id<>$2 AND status='pending'",
    [offer.job_id, offer.id],
  );
  await client.query("INSERT INTO job_events(job_id,actor_id,status,payload) VALUES($1,$2,$3,$4)", [
    offer.job_id,
    actorUserId,
    status,
    { offerId: offer.id },
  ]);
  return changed;
}
