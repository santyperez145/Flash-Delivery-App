import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { scoreCandidates, shortlistDrivers } from "./dispatch-candidates.js";
import { config } from "./config.js";
import { pesos } from "./money.js";
import { CASH_LABEL, driverWalletBalanceCents } from "./wallet-repository.js";

/**
 * PAG-01: ¿el conductor o repartidor queda dentro del tope de deuda por efectivo
 * **después** de este servicio? Un viaje suma sólo la comisión, que se descuenta al
 * liquidar; un pedido de comida suma casi todo su valor (la parte del comercio y la
 * comisión), así que se proyecta: mirar sólo la deuda de hoy dejaba tomar un pedido
 * que la lleva muy por encima del tope. Deber exactamente el tope se permite.
 */
// Lo que va a deber por los pedidos en efectivo que ya lleva y todavía no liquidó: se
// cobran recién al completar, así que sin esto dos pedidos simultáneos pasaban el tope.
const DEUDA_EN_CURSO = `COALESCE((SELECT sum(GREATEST(0, COALESCE(j.final_amount_cents,j.quoted_amount_cents)
    - round(COALESCE((j.metadata->>'deliveryFee')::numeric,0)*100)))::bigint
  FROM jobs j WHERE j.driver_id=d.id AND j.status NOT IN ('completed','cancelled')
    AND j.payment_method_label='Efectivo' AND j.metadata->>'subtype'='food_order'),0)`;

const puedeTomarEfectivo = async (client, driverId, deudaNueva = 0) => {
  const enCurso = Number(
    (await client.query(`SELECT ${DEUDA_EN_CURSO} n FROM drivers d WHERE d.id=$1`, [driverId]))
      .rows[0]?.n ?? 0,
  );
  return (
    (await driverWalletBalanceCents(client, driverId)) - enCurso - deudaNueva >=
    -config.cashDriverDebtLimitCents
  );
};

/** PAG-01: de una lista de conductores, los que pueden tomar un servicio en efectivo. */
const elegiblesParaEfectivo = async (client, driverIds, deudaNueva = 0) =>
  driverIds.length === 0
    ? []
    : (
        await client.query(
          `SELECT d.id FROM drivers d
           LEFT JOIN ledger_accounts a ON a.owner_type='user' AND a.owner_id=d.user_id AND a.account_type='wallet'
           LEFT JOIN ledger_entries e ON e.account_id=a.id
           WHERE d.id = ANY($1)
           GROUP BY d.id
           HAVING COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)
             - ${DEUDA_EN_CURSO} - $3 >= $2`,
          [driverIds, -config.cashDriverDebtLimitCents, deudaNueva],
        )
      ).rows
        .map((row) => row.id)
        // Se respeta el orden por cercanía de la lista corta.
        .sort((a, b) => driverIds.indexOf(a) - driverIds.indexOf(b));

const offerId = () => `OFR-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

/**
 * P-03: pedidos agrupados. Un pedido de comida listo se le puede sumar a un repartidor
 * que va a buscar otro pedido **al mismo local** y todavía no lo retiró: retira los dos
 * juntos y entrega primero el que ya llevaba. El desvío lo absorbe sólo el segundo
 * cliente: lo que su entrega se alarga por pasar antes por la del primero, en línea
 * recta, no puede superar `FOOD_BATCH_MAX_DETOUR_M`. Como mucho dos pedidos por lote.
 *
 * `$1` es el pedido nuevo, `$2` el desvío máximo y `$3`, si viene, el repartidor.
 */
const LOTE_COMPATIBLE_SQL = `
  SELECT d.id driver_id, d.user_id, a.id anchor_id, a.public_id anchor_public_id,
    round(ST_Distance(a.pickup_location, a.dropoff_location) + ST_Distance(a.dropoff_location, n.dropoff_location)
      - ST_Distance(n.pickup_location, n.dropoff_location))::int extra_m
  FROM jobs n
  JOIN jobs a ON a.branch_id = n.branch_id AND a.id <> n.id AND a.kind = 'delivery'
    AND a.metadata->>'subtype' = 'food_order' AND a.status IN ('driver_assigned','arriving')
    AND a.batch_anchor_id IS NULL
  JOIN drivers d ON d.id = a.driver_id AND d.online
  WHERE n.id = $1 AND n.kind = 'delivery' AND n.metadata->>'subtype' = 'food_order'
    AND n.driver_id IS NULL AND n.branch_id IS NOT NULL
    -- El pedido nuevo no es parte de otro lote, ni como segundo ni como primero.
    AND n.batch_anchor_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM jobs g WHERE g.batch_anchor_id = n.id
           AND g.status NOT IN ('completed','cancelled'))
    AND ($3::uuid IS NULL OR d.id = $3)
    -- Al ofrecer, quien ya recibió este pedido no ocupa un lugar: en la ronda siguiente
    -- el lote le llega a otro repartidor del mismo local. Al aceptar, en cambio, la
    -- oferta propia tiene que estar.
    AND ($3::uuid IS NOT NULL OR NOT EXISTS (SELECT 1 FROM dispatch_offers p
           WHERE p.job_id = n.id AND p.driver_id = d.id))
    -- Ningún otro pedido en curso: ni un segundo de este lote ni otro servicio.
    AND (SELECT count(*) FROM jobs x WHERE x.driver_id = d.id AND x.kind = 'delivery'
           AND x.status NOT IN ('completed','cancelled')) = 1
    AND NOT EXISTS (SELECT 1 FROM jobs f WHERE f.batch_anchor_id = a.id
           AND f.status NOT IN ('completed','cancelled'))
    AND ST_Distance(a.pickup_location, a.dropoff_location) + ST_Distance(a.dropoff_location, n.dropoff_location)
      - ST_Distance(n.pickup_location, n.dropoff_location) <= $2
  ORDER BY extra_m, a.created_at`;

/**
 * P-03: de una lista de repartidores, los que no llevan ningún pedido. Quien ya lleva uno
 * sólo recibe un pedido de comida como lote. Se filtra **antes** de puntuar, como el
 * efectivo: filtrar después del corte dejaba el pedido sin ofertas si los mejores
 * puntuados —los que ya están en un local— tenían uno en curso.
 */
const sinPedidoEnCurso = async (client, driverIds) => {
  if (driverIds.length === 0) return [];
  const ocupados = new Set(
    (
      await client.query(
        `SELECT DISTINCT driver_id FROM jobs WHERE driver_id = ANY($1::uuid[]) AND kind='delivery'
           AND status NOT IN ('completed','cancelled')`,
        [driverIds],
      )
    ).rows.map((row) => row.driver_id),
  );
  return driverIds.filter((id) => !ocupados.has(id));
};

/** Minutos que suma el desvío: a la velocidad de la estimación del checkout, más la entrega del primero. */
const minutosDeDesvio = (extraM) => Math.max(2, Math.ceil(Number(extraM) / 350) + 2);

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
      j.public_id, (j.kind='delivery' AND j.metadata->>'subtype'='food_order') food,
      (j.payment_method_label=$2) cash,
      CASE WHEN j.payment_method_label=$2 AND j.metadata->>'subtype'='food_order'
        THEN GREATEST(0, COALESCE(j.final_amount_cents,j.quoted_amount_cents)
          - round(COALESCE((j.metadata->>'deliveryFee')::numeric,0)*100))::bigint ELSE 0 END cash_debt
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
  const habilitadosEfectivo = job.cash
    ? await elegiblesParaEfectivo(client, driverIds, Number(job.cash_debt))
    : driverIds;
  // P-03: un pedido de comida suelto, sólo a quien no lleva ninguno.
  const habilitados = job.food
    ? await sinPedidoEnCurso(client, habilitadosEfectivo)
    : habilitadosEfectivo;
  // Etapa 2: puntuación explicable, sólo sobre la lista corta.
  const candidates = {
    rows: await scoreCandidates(client, { jobId, driverIds: habilitados, mode, limit }),
  };

  const offers = [];
  // P-03: un pedido de comida se ofrece primero como lote a quien ya va a ese local. Un
  // repartidor con un pedido en curso que no es del mismo local no lo recibe suelto
  // (se sacó antes de puntuar): al aceptarlo se rechazaría, y llevar dos pedidos de
  // locales distintos sin orden ni tope de desvío es justo lo que demoraba al primero.
  if (job.food) {
    const lotes = config.dispatch.batchingEnabled
      ? (
          await client.query(`${LOTE_COMPATIBLE_SQL} LIMIT 2`, [
            jobId,
            config.dispatch.batchMaxDetourM,
            null,
          ])
        ).rows
      : [];
    const lotesHabilitados = job.cash
      ? await elegiblesParaEfectivo(
          client,
          lotes.map((lote) => lote.driver_id),
          Number(job.cash_debt),
        )
      : lotes.map((lote) => lote.driver_id);
    for (const lote of lotes) {
      if (!lotesHabilitados.includes(lote.driver_id)) continue;
      const scoreBreakdown = {
        batch: {
          anchorOrderId: lote.anchor_public_id,
          sequence: 2,
          extraM: Number(lote.extra_m),
          extraMinutes: minutosDeDesvio(lote.extra_m),
        },
      };
      const row = (
        await client.query(
          `INSERT INTO dispatch_offers(public_id,job_id,driver_id,score,expires_at,score_breakdown)
           VALUES($1,$2,$3,$4,now()+($5*interval '1 second'),$6)
           ON CONFLICT(job_id,driver_id) DO NOTHING RETURNING public_id,expires_at`,
          // Un lote va primero en la lista del repartidor: ya está yendo a ese local.
          [offerId(), jobId, lote.driver_id, 100, ttlSeconds, scoreBreakdown],
        )
      ).rows[0];
      if (!row) continue;
      offers.push(row.public_id);
      await enqueueNotificationForInternalUser(client, {
        userId: lote.user_id,
        template: "dispatch_offer",
        payload: {
          offerId: row.public_id,
          jobId: job.public_id,
          kind: "delivery",
          subtype: "food_order",
          expiresAt: row.expires_at,
          score: 100,
          scoreBreakdown,
          title: "Sumá un pedido del mismo local",
          body: `Retirás los dos juntos y lo entregás después del que ya llevás (+${scoreBreakdown.batch.extraMinutes} min).`,
        },
        deduplicationKey: `dispatch_offer:${row.public_id}`,
      });
    }
  }
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
      j.quoted_amount_cents,j.final_amount_cents,j.distance_m,j.estimated_duration_s,j.metadata,o.score,o.score_breakdown,o.expires_at,o.status,
      (j.payment_method_label=$2) cash,
      CASE WHEN j.payment_method_label=$2 AND j.metadata->>'subtype'='food_order'
        THEN GREATEST(0, COALESCE(j.final_amount_cents,j.quoted_amount_cents)
          - round(COALESCE((j.metadata->>'deliveryFee')::numeric,0)*100))::bigint ELSE 0 END cash_debt,
      -- La propina del checkout también es de quien reparte: la liquidación se la paga aparte.
      COALESCE((SELECT sum(t.amount_cents) FROM service_tips t WHERE t.job_id=j.id AND t.status='held'),0)
        held_tip_cents
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
    // P-03: un lote se muestra como lo que es: sumar un pedido del mismo local, la
    // entrega 2, con los minutos de desvío. Lo que gana es el envío del pedido más la
    // propina del checkout: «fare» en comida es el total que paga el cliente, no lo que
    // cobra quien reparte (ver `calculateFoodSettlement`).
    batch: row.score_breakdown?.batch ?? null,
    courierEarning:
      row.metadata?.subtype === "food_order"
        ? Number(row.metadata?.deliveryFee || 0) + pesos(row.held_tip_cents)
        : null,
    expiresAt: new Date(row.expires_at).toISOString(),
    status: row.status,
    subtype: row.metadata?.subtype || null,
    // PAG-01: antes de aceptar, quien maneja sabe si cobra en mano, y cuánto.
    cash: Boolean(row.cash),
    cashToCollect: row.cash ? pesos(row.final_amount_cents ?? row.quoted_amount_cents) : null,
    // Con cuánto paga y el vuelto, para saber antes de aceptar si lleva cambio.
    cashTendered:
      row.cash && row.metadata?.cashPayment?.tenderedCents != null
        ? pesos(row.metadata.cashPayment.tenderedCents)
        : null,
    cashChange:
      row.cash && row.metadata?.cashPayment?.tenderedCents != null
        ? pesos(row.metadata.cashPayment.changeCents || 0)
        : null,
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
      `SELECT o.id,o.job_id,o.driver_id,j.kind,j.metadata->>'subtype' subtype,(j.payment_method_label=$3) cash,
      CASE WHEN j.payment_method_label=$3 AND j.metadata->>'subtype'='food_order'
        THEN GREATEST(0, COALESCE(j.final_amount_cents,j.quoted_amount_cents)
          - round(COALESCE((j.metadata->>'deliveryFee')::numeric,0)*100))::bigint ELSE 0 END cash_debt
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
  if (offer.cash && !(await puedeTomarEfectivo(client, offer.driver_id, Number(offer.cash_debt))))
    throw Object.assign(
      new Error(
        "Tenés efectivo por rendir: no podés tomar otro servicio en efectivo hasta bajar tu deuda",
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
  // P-03: con un pedido en curso, un pedido de comida sólo se suma si forma lote con él:
  // mismo local, todavía sin retirar y con el desvío dentro del tope. Se vuelve a
  // controlar acá, con el repartidor bloqueado: entre la oferta y la aceptación el
  // primero pudo retirarse o cancelarse. El primero también se bloquea.
  let lote = null;
  if (offer.kind === "delivery" && offer.subtype === "food_order" && active >= 1) {
    lote = config.dispatch.batchingEnabled
      ? (
          await client.query(`${LOTE_COMPATIBLE_SQL} LIMIT 1 FOR UPDATE OF a`, [
            offer.job_id,
            config.dispatch.batchMaxDetourM,
            offer.driver_id,
          ])
        ).rows[0]
      : null;
    if (!lote)
      throw Object.assign(
        new Error(
          "Ya tenés un pedido en curso: sólo podés sumar otro del mismo local y en el camino",
        ),
        { status: 409 },
      );
  }
  const changed = (
    await client.query(
      `UPDATE jobs SET driver_id=$1,status=$2,version=version+1,updated_at=now()
    WHERE id=$3 AND driver_id IS NULL AND status NOT IN('completed','cancelled')
      AND (COALESCE(metadata->>'subtype','')<>'food_order' OR status='ready_for_pickup') RETURNING id,customer_id`,
      [offer.driver_id, status, offer.job_id],
    )
  ).rows[0];
  if (!changed) throw Object.assign(new Error("El servicio ya fue tomado"), { status: 409 });
  // P-03: el segundo pedido apunta al primero, y su horario estimado suma el desvío: el
  // cliente ve la hora real, no la del pedido suelto.
  if (lote) {
    const extraMinutes = minutosDeDesvio(lote.extra_m);
    await client.query(
      `UPDATE jobs SET batch_anchor_id=$2,
         metadata = jsonb_set(jsonb_set(metadata,'{etaMin}',
           to_jsonb(COALESCE((metadata->>'etaMin')::int,0) + $3::int)),
           '{batch}', $4::jsonb)
       WHERE id=$1`,
      [
        offer.job_id,
        lote.anchor_id,
        extraMinutes,
        JSON.stringify({
          anchorOrderId: lote.anchor_public_id,
          extraM: Number(lote.extra_m),
          extraMinutes,
        }),
      ],
    );
  }
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
