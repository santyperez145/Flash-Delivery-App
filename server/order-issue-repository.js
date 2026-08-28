import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { markHeldTipRefunded } from "./tip-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { upsertCase } from "./payment-repository.js";

const publicId = () => `ISS-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const money = (cents) => Number(cents || 0) / 100;
const map = (row) => ({
  id: row.public_id,
  orderId: row.job_public_id,
  category: row.category,
  description: row.description,
  status: row.status,
  requestedRefund: money(row.requested_refund_cents),
  approvedRefund: money(row.approved_refund_cents),
  resolutionNote: row.resolution_note || null,
  createdAt: new Date(row.created_at).toISOString(),
  resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
});

export async function createOrderIssue({
  orderPublicId,
  customerPublicId,
  category,
  description,
  requestedRefund,
}) {
  const amountCents = Math.round(requestedRefund * 100);
  const result = await postgresPool.query(
    `INSERT INTO order_issues(public_id,job_id,reporter_id,category,description,requested_refund_cents)
    SELECT $1,j.id,u.id,$4,$5,$6 FROM jobs j JOIN users u ON u.public_id=$3
    WHERE j.public_id=$2 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order' AND j.customer_id=u.id AND j.status NOT IN('cancelled')
      AND $6<=j.final_amount_cents
    RETURNING *, $2::text job_public_id`,
    [publicId(), orderPublicId, customerPublicId, category, description, amountCents],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Pedido no encontrado, cancelado o importe inválido"), {
      status: 404,
    });
  return map(result.rows[0]);
}

export async function getOrderIssues({ orderPublicId, actorPublicId, roles }) {
  const admin = roles.includes("admin"),
    merchant = roles.includes("merchant");
  const result = await postgresPool.query(
    `SELECT i.*,j.public_id job_public_id FROM order_issues i JOIN jobs j ON j.id=i.job_id
    LEFT JOIN merchants m ON m.id=j.merchant_id LEFT JOIN users owner ON owner.id=m.owner_id
    WHERE j.public_id=$1 AND ($3::boolean OR i.reporter_id=(SELECT id FROM users WHERE public_id=$2) OR ($4::boolean AND owner.public_id=$2)) ORDER BY i.created_at DESC`,
    [orderPublicId, actorPublicId, admin, merchant],
  );
  if (!result.rowCount) {
    const exists = await postgresPool.query("SELECT 1 FROM jobs WHERE public_id=$1", [
      orderPublicId,
    ]);
    if (!exists.rowCount) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
  }
  return result.rows.map(map);
}

export async function resolveOrderIssue({
  issuePublicId,
  actorPublicId,
  status,
  approvedRefund,
  resolutionNote,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    const issue = (
      await client.query(
        `SELECT i.*,j.public_id job_public_id,j.customer_id,j.final_amount_cents FROM order_issues i JOIN jobs j ON j.id=i.job_id WHERE i.public_id=$1 AND i.status='open' FOR UPDATE OF i,j`,
        [issuePublicId],
      )
    ).rows[0];
    if (!issue)
      throw Object.assign(new Error("Incidencia no encontrada o ya resuelta"), { status: 409 });
    const refundCents = status === "approved" ? Math.round(approvedRefund * 100) : 0;
    if (
      refundCents < 0 ||
      refundCents > Number(issue.requested_refund_cents) ||
      refundCents > Number(issue.final_amount_cents)
    )
      throw Object.assign(new Error("El reintegro excede el importe solicitado o cobrado"), {
        status: 409,
      });
    if (refundCents > 0) {
      const payment = (
        await client.query(
          "SELECT * FROM payment_intents WHERE job_id=$1 AND provider='flash_wallet' AND status IN('captured','partially_refunded') FOR UPDATE",
          [issue.job_id],
        )
      ).rows[0];
      if (!payment || refundCents > Number(payment.captured_amount_cents))
        throw Object.assign(new Error("No existe saldo capturado suficiente para reintegrar"), {
          status: 409,
        });
      const wallet = (
        await client.query(
          "SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND account_type='wallet' FOR UPDATE",
          [issue.customer_id],
        )
      ).rows[0];
      const clearing = (
        await client.query(
          "SELECT id FROM ledger_accounts WHERE owner_type='platform' AND owner_id IS NULL AND account_type='cash_clearing' FOR UPDATE",
        )
      ).rows[0];
      // El orden importa: el bucle de abajo reparte el reintegro con `floor` y le
      // da el resto al ultimo renglon. Sin `ORDER BY` ese ultimo lo elegia el
      // planificador, asi que el centavo sobrante caia en una parte u otra sin regla
      // —y el mismo reintegro podia repartirse distinto al repetirse—. La regla es
      // que el resto lo absorbe la parte con mayor participacion, que es la que menos
      // se distorsiona en terminos relativos; `account_id` desempata.
      const settlement = await client.query(
        `SELECT e.account_id,e.direction,e.amount_cents,e.metadata
         FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
         WHERE t.idempotency_key=$1 AND e.direction='credit'
         ORDER BY e.amount_cents,e.account_id`,
        [`settlement-${issue.job_public_id}`],
      );
      if (settlement.rowCount) {
        const total = settlement.rows.reduce((sum, row) => sum + Number(row.amount_cents), 0),
          reversal = (
            await client.query(
              `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'adjustment',$2,$3,$4) RETURNING id`,
              [
                `issue-reversal-${issuePublicId}`,
                actor.id,
                `Reversión proporcional ${issue.job_public_id}`,
                { issueId: issuePublicId, refundCents },
              ],
            )
          ).rows[0];
        let allocated = 0;
        for (let index = 0; index < settlement.rows.length; index++) {
          const row = settlement.rows[index],
            amount =
              index === settlement.rows.length - 1
                ? refundCents - allocated
                : Math.floor((refundCents * Number(row.amount_cents)) / total);
          allocated += amount;
          if (amount)
            await client.query(
              `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'debit',$3,'order_issue',$4,$5)`,
              [reversal.id, row.account_id, amount, issue.job_id, { issueId: issuePublicId }],
            );
        }
        await client.query(
          `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'credit',$3,'order_issue',$4,$5)`,
          [reversal.id, clearing.id, refundCents, issue.job_id, { issueId: issuePublicId }],
        );

        // Decision tomada: el reintegro al cliente nunca se bloquea por el saldo
        // de un tercero, asi que una parte puede quedar en negativo si ya cobro
        // lo que ahora devuelve. La deuda se netea contra liquidaciones futuras.
        // Lo que no puede pasar es que nadie se entere: un comercio que deja de
        // vender con saldo negativo se lleva la deuda puesta.
        for (const row of settlement.rows) {
          const saldo = Number(
            (
              await client.query(
                `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint saldo
                 FROM ledger_entries WHERE account_id=$1`,
                [row.account_id],
              )
            ).rows[0].saldo,
          );
          if (saldo >= 0) continue;
          await upsertCase(client, {
            fingerprint: `negative_balance:${row.account_id}:${issuePublicId}`,
            provider: payment.provider,
            caseType: "negative_balance",
            severity: "medium",
            entityType: "ledger_account",
            entityId: row.account_id,
            externalReference: issuePublicId,
            summary: `Saldo en negativo tras reintegro de ${issue.job_public_id}`,
            details: {
              balanceCents: saldo,
              refundCents,
              issueId: issuePublicId,
              jobPublicId: issue.job_public_id,
            },
          });
        }
      }
      const transaction = (
        await client.query(
          `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'refund',$2,$3,$4) RETURNING id`,
          [
            `issue-refund-${issuePublicId}`,
            actor.id,
            `Reintegro incidencia ${issue.job_public_id}`,
            { issueId: issuePublicId, refundCents },
          ],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'credit',$3,'order_issue',$4,$5),($1,$6,'debit',$3,'order_issue',$4,$5)`,
        [
          transaction.id,
          wallet.id,
          refundCents,
          issue.job_id,
          { issueId: issuePublicId },
          clearing.id,
        ],
      );
      await client.query(
        `INSERT INTO refunds(payment_intent_id,requested_by,amount_cents,reason,status,resolved_at,provider_refund_id) VALUES($1,$2,$3,'order_issue','succeeded',now(),$4)`,
        [payment.id, actor.id, refundCents, issuePublicId],
      );
      const remaining = Number(payment.captured_amount_cents) - refundCents;
      await client.query(
        "UPDATE payment_intents SET captured_amount_cents=$2,status=$3,updated_at=now() WHERE id=$1",
        [payment.id, remaining, remaining === 0 ? "refunded" : "partially_refunded"],
      );
      // Sólo con reintegro total. Un reintegro parcial no anula la propina: el
      // pedido puede completarse igual y el repartidor cobrarla. Marcarla acá le
      // sacaría la propina por un problema que no fue suyo.
      if (remaining === 0) await markHeldTipRefunded(client, issue.job_id);
    }
    const updated = (
      await client.query(
        `UPDATE order_issues SET status=$2,approved_refund_cents=$3,resolution_note=$4,resolved_by=$5,resolved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`,
        [issue.id, status, refundCents, resolutionNote, actor.id],
      )
    ).rows[0];
    updated.job_public_id = issue.job_public_id;
    await enqueueNotificationForInternalUser(client, {
      userId: issue.customer_id,
      template: "order_issue_resolved",
      payload: {
        jobId: issue.job_public_id,
        issueId: issuePublicId,
        status,
        refundAmount: money(refundCents),
      },
      deduplicationKey: `order_issue:${issuePublicId}:resolved`,
    });
    await client.query("COMMIT");
    return map(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
