import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

const publicId = () => `TIP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const mapTip = (row) => ({
  id: row.public_id,
  jobId: row.job_public_id,
  customerId: row.customer_public_id,
  driverId: row.driver_public_id || null,
  amount: Number(row.amount_cents) / 100,
  // `held` mientras el pedido no se completa. La pantalla necesita poder decir
  // «retenida hasta la entrega» en lugar de mostrarla como pagada a nadie.
  status: row.status,
  createdAt: new Date(row.created_at).toISOString(),
  settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
});
// `LEFT JOIN` sobre conductores desde la migracion 126: una propina retenida
// todavia no tiene destinatario. Con el JOIN interno que habia antes, quien
// dejaba propina en el checkout no la veia en su cuenta hasta que se liberara —
// plata cobrada que no aparece en ningun lado es la peor version de este bug.
const tipSelect = `
  SELECT t.*, j.public_id job_public_id, c.public_id customer_public_id, d.public_id driver_public_id
  FROM service_tips t
  JOIN jobs j ON j.id = t.job_id
  JOIN users c ON c.id = t.customer_id
  LEFT JOIN drivers d ON d.id = t.driver_id
`;
const adjustmentId = () => `TADJ-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const adjustmentSelect = `
  SELECT a.*, t.public_id tip_public_id, t.amount_cents tip_amount_cents, j.public_id job_public_id,
    c.public_id customer_public_id, d.public_id driver_public_id,
    requester.public_id requested_by_public_id, reviewer.public_id reviewed_by_public_id
  FROM service_tip_adjustments a
  JOIN service_tips t ON t.id = a.tip_id
  JOIN jobs j ON j.id = t.job_id
  JOIN users c ON c.id = t.customer_id
  JOIN drivers d ON d.id = t.driver_id
  JOIN users requester ON requester.id = a.requested_by
  LEFT JOIN users reviewer ON reviewer.id = a.reviewed_by
`;
const mapAdjustment = (row) => ({
  id: row.public_id,
  tipId: row.tip_public_id,
  jobId: row.job_public_id,
  customerId: row.customer_public_id,
  driverId: row.driver_public_id,
  tipAmount: Number(row.tip_amount_cents) / 100,
  amount: Number(row.amount_cents) / 100,
  reason: row.reason,
  status: row.status,
  requestedBy: row.requested_by_public_id,
  requestedAt: new Date(row.requested_at).toISOString(),
  reviewedBy: row.reviewed_by_public_id || null,
  reviewNote: row.review_note || null,
  reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
});

export async function getPostgresTips({ userPublicId, roles = [] }) {
  const result = await postgresPool.query(
    `${tipSelect} LEFT JOIN users du ON du.id=d.user_id WHERE $2::boolean OR c.public_id=$1 OR du.public_id=$1 ORDER BY t.created_at DESC LIMIT 200`,
    [userPublicId, roles.includes("admin")],
  );
  return result.rows.map(mapTip);
}

export async function createPostgresTip({ jobPublicId, customerPublicId, amount, idempotencyKey }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const existing = (
      await client.query(`${tipSelect} WHERE t.idempotency_key=$1`, [idempotencyKey])
    ).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      return mapTip(existing);
    }
    const job = (
      await client.query(
        `SELECT j.id, j.customer_id, j.driver_id, j.status, j.quoted_amount_cents,
          d.user_id driver_user_id, d.public_id driver_public_id
         FROM jobs j
         LEFT JOIN drivers d ON d.id = j.driver_id
         JOIN users c ON c.id = j.customer_id
         WHERE j.public_id = $1 AND c.public_id = $2
         FOR UPDATE OF j`,
        [jobPublicId, customerPublicId],
      )
    ).rows[0];
    if (!job)
      throw Object.assign(new Error("Servicio no encontrado o ajeno"), {
        status: 404,
      });
    if (job.status !== "completed" || !job.driver_id)
      throw Object.assign(new Error("Sólo puedes dar propina después de completar el servicio"), {
        status: 409,
      });
    if (String(job.customer_id) === String(job.driver_user_id))
      throw Object.assign(new Error("No puedes enviarte una propina a ti mismo"), { status: 409 });
    const amountCents = Math.round(amount * 100),
      maxCents = Math.min(
        10000000,
        Math.max(10000, Math.floor(Number(job.quoted_amount_cents) * 0.5)),
      );
    if (amountCents > maxCents)
      throw Object.assign(
        new Error(`La propina máxima para este servicio es $${(maxCents / 100).toFixed(0)}`),
        { status: 409 },
      );
    const duplicate = (
      await client.query("SELECT public_id FROM service_tips WHERE job_id=$1", [job.id])
    ).rows[0];
    if (duplicate)
      throw Object.assign(new Error("Este servicio ya tiene propina"), {
        status: 409,
      });
    const accounts = await client.query(
      `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
       VALUES ('user', $1, 'ARS', 'wallet'), ('user', $2, 'ARS', 'wallet')
       ON CONFLICT (owner_type, owner_id, currency, account_type)
       DO UPDATE SET owner_type = excluded.owner_type
       RETURNING id, owner_id`,
      [job.customer_id, job.driver_user_id],
    );
    const customerAccount = accounts.rows.find(
        (row) => String(row.owner_id) === String(job.customer_id),
      ),
      driverAccount = accounts.rows.find(
        (row) => String(row.owner_id) === String(job.driver_user_id),
      );
    await client.query("SELECT id FROM ledger_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE", [
      [customerAccount.id, driverAccount.id],
    ]);
    const balance = Number(
      (
        await client.query(
          "SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance FROM ledger_entries WHERE account_id=$1",
          [customerAccount.id],
        )
      ).rows[0].balance,
    );
    if (balance < amountCents)
      throw Object.assign(new Error("Saldo insuficiente para la propina"), {
        status: 402,
      });
    const transaction = (
      await client.query(
        "INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'tip',$2,$3,$4) RETURNING id",
        [
          `tip-${idempotencyKey}`,
          job.customer_id,
          `Propina servicio ${jobPublicId}`,
          { jobId: jobPublicId },
        ],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$4,'tip',$3,$5),($1,$6,'credit',$4,'tip',$3,$5)`,
      [
        transaction.id,
        customerAccount.id,
        job.id,
        amountCents,
        { jobId: jobPublicId },
        driverAccount.id,
      ],
    );
    const tip = (
      await client.query(
        "INSERT INTO service_tips(public_id,job_id,customer_id,driver_id,amount_cents,idempotency_key,ledger_transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          publicId(),
          job.id,
          job.customer_id,
          job.driver_id,
          amountCents,
          idempotencyKey,
          transaction.id,
        ],
      )
    ).rows[0];
    await enqueueNotificationForInternalUser(client, {
      userId: job.driver_user_id,
      template: "tip_received",
      payload: { kind: "tip", jobId: jobPublicId, amount },
      deduplicationKey: `tip:${jobPublicId}`,
    });
    await client.query("COMMIT");
    return mapTip({
      ...tip,
      job_public_id: jobPublicId,
      customer_public_id: customerPublicId,
      driver_public_id: job.driver_public_id,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Propina tomada en el checkout (GTM-001).
//
// La competencia la pide antes de asignar conductor porque sube la tasa de
// propina, y la propina es la ganancia por viaje del repartidor. **Pero en el
// checkout todavia no hay a quien pagarle**, asi que no se transfiere: se cobra
// junto con el pedido —un solo cargo— y queda retenida hasta que hay conductor y
// el servicio se completa.
//
// Las tres funciones de abajo reciben el `client` de una transaccion en curso a
// proposito. Retener, liberar y devolver son partes de operaciones mas grandes
// —crear el pedido, liquidarlo, reintegrarlo—: hacerlas en su propia
// transaccion dejaria una ventana en la que el pedido existe y la propina no, o
// peor, al reves.
// ---------------------------------------------------------------------------

/** Piso y techo de una propina de checkout. El piso lo impone la tabla desde la
 *  migracion 025; el techo evita que un error de tipeo cobre una fortuna. */
export const CHECKOUT_TIP_MIN_CENTS = 10000;
export const checkoutTipMaxCents = (orderTotalCents) =>
  Math.min(10000000, Math.max(CHECKOUT_TIP_MIN_CENTS, Math.floor(orderTotalCents * 0.5)));

/**
 * Deja la propina retenida contra el pedido recien creado.
 *
 * No mueve plata por su cuenta: el monto ya viaja dentro del cobro del pedido.
 * Esta fila es lo que despues permite saber cuanto de lo cobrado no era del
 * comercio ni de la plataforma.
 */
export async function holdCheckoutTip(client, { jobId, customerId, amountCents, idempotencyKey }) {
  if (!amountCents) return null;
  const tip = (
    await client.query(
      `INSERT INTO service_tips(public_id, job_id, customer_id, amount_cents, idempotency_key, status)
       VALUES($1, $2, $3, $4, $5, 'held')
       ON CONFLICT(job_id) DO NOTHING
       RETURNING public_id, amount_cents`,
      [publicId(), jobId, customerId, amountCents, `checkout-tip-${idempotencyKey}`],
    )
  ).rows[0];
  return tip ? { id: tip.public_id, amountCents: Number(tip.amount_cents) } : null;
}

/** Lo retenido de un pedido, para que la liquidacion sepa cuanto de lo cobrado
 *  no le toca repartir. Devuelve 0 cuando no hay propina, que es el caso comun. */
export async function heldTipForJob(client, jobId) {
  const fila = (
    await client.query(
      "SELECT id, amount_cents FROM service_tips WHERE job_id=$1 AND status='held' FOR UPDATE",
      [jobId],
    )
  ).rows[0];
  return fila
    ? { id: fila.id, amountCents: Number(fila.amount_cents) }
    : { id: null, amountCents: 0 };
}

/**
 * Marca la propina como pagada al conductor.
 *
 * El asiento contable lo emite la liquidacion, que es la que tiene las cuentas y
 * el resto del reparto en la misma transaccion. Aca solo se registra a quien fue
 * y con que asiento, que es lo que la restriccion de la migracion 126 exige para
 * que una fila pueda decir «pagada».
 */
export async function markTipReleased(client, { tipId, driverId, ledgerTransactionId }) {
  await client.query(
    `UPDATE service_tips SET status='released', driver_id=$2, ledger_transaction_id=$3,
       settled_at=now() WHERE id=$1 AND status='held'`,
    [tipId, driverId, ledgerTransactionId],
  );
}

/**
 * Marca la propina como devuelta.
 *
 * El dinero vuelve con el reintegro del pedido, porque viajo dentro del mismo
 * cobro. Lo que hace falta es que la fila deje de decir «retenida»: una propina
 * retenida sobre un pedido reintegrado es dinero que el sistema cree deber y ya
 * devolvio, y esa es la clase de fila que aparece meses despues en una
 * conciliacion.
 */
export async function markHeldTipRefunded(client, jobId) {
  await client.query(
    "UPDATE service_tips SET status='refunded', settled_at=now() WHERE job_id=$1 AND status='held'",
    [jobId],
  );
}

export async function getTipAdjustments() {
  return (
    await postgresPool.query(
      `${adjustmentSelect} ORDER BY CASE a.status WHEN 'pending' THEN 1 ELSE 2 END,a.requested_at DESC LIMIT 200`,
    )
  ).rows.map(mapAdjustment);
}

export async function requestTipAdjustment({
  tipPublicId,
  actorPublicId,
  amount,
  reason,
  idempotencyKey,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const existing = (
      await client.query(`${adjustmentSelect} WHERE a.idempotency_key=$1`, [idempotencyKey])
    ).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      return mapAdjustment(existing);
    }
    const tip = (
      await client.query("SELECT id,amount_cents FROM service_tips WHERE public_id=$1 FOR UPDATE", [
        tipPublicId,
      ])
    ).rows[0];
    if (!tip) throw Object.assign(new Error("Propina no encontrada"), { status: 404 });
    const amountCents = Math.round(amount * 100),
      alreadyRequested = Number(
        (
          await client.query(
            "SELECT COALESCE(sum(amount_cents),0)::bigint cents FROM service_tip_adjustments WHERE tip_id=$1 AND status IN('pending','approved')",
            [tip.id],
          )
        ).rows[0].cents,
      );
    if (alreadyRequested + amountCents > Number(tip.amount_cents))
      throw Object.assign(new Error("El ajuste supera el saldo corregible de la propina"), {
        status: 409,
      });
    const row = (
      await client.query(
        `INSERT INTO service_tip_adjustments(public_id,tip_id,amount_cents,reason,requested_by,idempotency_key) SELECT $1,$2,$3,$4,u.id,$5 FROM users u WHERE u.public_id=$6 RETURNING *`,
        [adjustmentId(), tip.id, amountCents, reason, idempotencyKey, actorPublicId],
      )
    ).rows[0];
    if (!row)
      throw Object.assign(new Error("Solicitante no encontrado"), {
        status: 404,
      });
    await client.query("COMMIT");
    return mapAdjustment(
      (await postgresPool.query(`${adjustmentSelect} WHERE a.id=$1`, [row.id])).rows[0],
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewTipAdjustment({ adjustmentPublicId, actorPublicId, decision, note }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const adjustment = (
      await client.query(`${adjustmentSelect} WHERE a.public_id=$1 FOR UPDATE OF a`, [
        adjustmentPublicId,
      ])
    ).rows[0];
    if (!adjustment) throw Object.assign(new Error("Ajuste no encontrado"), { status: 404 });
    if (adjustment.requested_by_public_id === actorPublicId)
      throw Object.assign(new Error("Quien solicita no puede revisar su propio ajuste"), {
        status: 409,
      });
    if (adjustment.status !== "pending") {
      if ((adjustment.status === "approved") === (decision === "approved")) {
        await client.query("ROLLBACK");
        return mapAdjustment(adjustment);
      }
      throw Object.assign(new Error("El ajuste ya fue revisado"), {
        status: 409,
      });
    }
    const reviewer = (
      await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId])
    ).rows[0];
    if (!reviewer) throw Object.assign(new Error("Revisor no encontrado"), { status: 404 });
    if (decision === "rejected")
      await client.query(
        "UPDATE service_tip_adjustments SET status='rejected',reviewed_by=$2,review_note=$3,reviewed_at=now() WHERE id=$1",
        [adjustment.id, reviewer.id, note],
      );
    else {
      const participants = (
        await client.query(
          "SELECT t.customer_id,d.user_id driver_user_id FROM service_tips t JOIN drivers d ON d.id=t.driver_id WHERE t.id=$1",
          [adjustment.tip_id],
        )
      ).rows[0];
      const accounts = await client.query(
        `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
         VALUES ('user', $1, 'ARS', 'wallet'), ('user', $2, 'ARS', 'wallet')
         ON CONFLICT (owner_type, owner_id, currency, account_type)
         DO UPDATE SET owner_type = excluded.owner_type
         RETURNING id, owner_id`,
        [participants.customer_id, participants.driver_user_id],
      );
      const customerAccount = accounts.rows.find(
          (row) => String(row.owner_id) === String(participants.customer_id),
        ),
        driverAccount = accounts.rows.find(
          (row) => String(row.owner_id) === String(participants.driver_user_id),
        );
      await client.query("SELECT id FROM ledger_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE", [
        [customerAccount.id, driverAccount.id],
      ]);
      const transaction = (
        await client.query(
          "INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'tip_adjustment',$2,$3,$4) RETURNING id",
          [
            `tip-adjustment-${adjustment.public_id}`,
            reviewer.id,
            `Ajuste de propina ${adjustment.tip_public_id}`,
            {
              tipId: adjustment.tip_public_id,
              adjustmentId: adjustment.public_id,
            },
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO ledger_entries(
           transaction_id, account_id, direction, amount_cents, reference_type, reference_id, metadata
         ) VALUES
           ($1, $2, 'debit', $4, 'tip_adjustment', $3, $5),
           ($1, $6, 'credit', $4, 'tip_adjustment', $3, $5)`,
        [
          transaction.id,
          driverAccount.id,
          adjustment.id,
          adjustment.amount_cents,
          {
            tipId: adjustment.tip_public_id,
            adjustmentId: adjustment.public_id,
          },
          customerAccount.id,
        ],
      );
      await client.query(
        "UPDATE service_tip_adjustments SET status='approved',reviewed_by=$2,review_note=$3,reviewed_at=now(),ledger_transaction_id=$4 WHERE id=$1",
        [adjustment.id, reviewer.id, note, transaction.id],
      );
      await enqueueNotificationForInternalUser(client, {
        userId: participants.customer_id,
        template: "tip_adjusted",
        payload: {
          kind: "tip_adjustment",
          jobId: adjustment.job_public_id,
          amount: Number(adjustment.amount_cents) / 100,
        },
        deduplicationKey: `tip-adjustment:${adjustment.public_id}:customer`,
      });
      await enqueueNotificationForInternalUser(client, {
        userId: participants.driver_user_id,
        template: "tip_adjusted",
        payload: {
          kind: "tip_adjustment",
          jobId: adjustment.job_public_id,
          amount: Number(adjustment.amount_cents) / 100,
        },
        deduplicationKey: `tip-adjustment:${adjustment.public_id}:driver`,
      });
    }
    await client.query("COMMIT");
    return mapAdjustment(
      (await postgresPool.query(`${adjustmentSelect} WHERE a.public_id=$1`, [adjustmentPublicId]))
        .rows[0],
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
