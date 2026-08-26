import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
const publicCode = (userId) =>
  `FLASH${crypto.createHash("sha256").update(userId).digest("hex").slice(0, 8).toUpperCase()}`;
const walletAccount = async (client, userId) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('user',$1,'ARS','wallet') ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
      [userId],
    )
  ).rows[0].id;
const clearingAccount = async (client) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type) VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL DO UPDATE SET owner_type=excluded.owner_type RETURNING id`,
    )
  ).rows[0].id;
async function settleEligible(client, user) {
  const attribution = (
    await client.query(
      `SELECT a.*,c.advocate_reward_cents,c.friend_reward_cents FROM referral_attributions a JOIN referral_campaigns c ON c.id=a.campaign_id WHERE a.referred_user_id=$1 AND a.status='pending' FOR UPDATE OF a`,
      [user.id],
    )
  ).rows[0];
  if (!attribution) return false;
  const job = (
    await client.query(
      `SELECT j.id,j.public_id FROM jobs j JOIN payment_intents p ON p.job_id=j.id WHERE j.customer_id=$1 AND j.status='completed' AND p.status='captured' GROUP BY j.id ORDER BY min(p.created_at) LIMIT 1`,
      [user.id],
    )
  ).rows[0];
  if (!job) return false;
  const clearing = await clearingAccount(client),
    transactionIds = [];
  for (const [ownerId, amountCents, side] of [
    [attribution.advocate_user_id, Number(attribution.advocate_reward_cents), "advocate"],
    [attribution.referred_user_id, Number(attribution.friend_reward_cents), "friend"],
  ]) {
    const transaction = (
      await client.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata) VALUES($1,'referral_reward',$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
        [
          `referral-${attribution.id}-${side}`,
          ownerId,
          side === "advocate" ? "Recompensa por referido" : "Bienvenida por referido",
          { attributionId: attribution.id, qualifyingJobId: job.public_id, side },
        ],
      )
    ).rows[0];
    if (!transaction)
      throw Object.assign(new Error("Recompensa de referido inconsistente"), { status: 409 });
    transactionIds.push(transaction.id);
    const wallet = await walletAccount(client, ownerId);
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES($1,$2,'credit',$3,'referral',$4,$5),($1,$6,'debit',$3,'referral',$4,$5)`,
      [
        transaction.id,
        wallet,
        amountCents,
        attribution.id,
        { side, qualifyingJobId: job.public_id },
        clearing,
      ],
    );
  }
  await client.query(
    `UPDATE referral_attributions SET status='rewarded',qualifying_job_id=$2,advocate_transaction_id=$3,friend_transaction_id=$4,rewarded_at=now() WHERE id=$1`,
    [attribution.id, job.id, ...transactionIds],
  );
  return true;
}
export async function getReferralSummary(publicUserId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (
      await client.query("SELECT id FROM users WHERE public_id=$1 FOR UPDATE", [publicUserId])
    ).rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    await settleEligible(client, user);
    const code = (
      await client.query(
        `INSERT INTO referral_codes(user_id,code) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET user_id=excluded.user_id RETURNING code`,
        [user.id, publicCode(publicUserId)],
      )
    ).rows[0];
    const campaign =
      (
        await client.query(
          `SELECT name,advocate_reward_cents,friend_reward_cents,currency FROM referral_campaigns WHERE active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) LIMIT 1`,
        )
      ).rows[0] || null;
    const stats = (
      await client.query(
        `SELECT count(*)::int invited,count(*) FILTER(WHERE status='rewarded')::int rewarded FROM referral_attributions WHERE advocate_user_id=$1`,
        [user.id],
      )
    ).rows[0];
    const attribution =
      (
        await client.query(
          `SELECT a.status,rc.code,a.attributed_at,a.rewarded_at FROM referral_attributions a JOIN referral_codes rc ON rc.id=a.code_id WHERE a.referred_user_id=$1`,
          [user.id],
        )
      ).rows[0] || null;
    await client.query("COMMIT");
    return {
      code: code.code,
      campaign: campaign
        ? {
            name: campaign.name,
            advocateReward: Number(campaign.advocate_reward_cents) / 100,
            friendReward: Number(campaign.friend_reward_cents) / 100,
            currency: campaign.currency,
          }
        : null,
      invited: Number(stats.invited),
      rewarded: Number(stats.rewarded),
      attribution: attribution
        ? {
            status: attribution.status,
            code: attribution.code,
            attributedAt: new Date(attribution.attributed_at).toISOString(),
            rewardedAt: attribution.rewarded_at
              ? new Date(attribution.rewarded_at).toISOString()
              : null,
          }
        : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function claimReferral({ publicUserId, code }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const referred = (
      await client.query("SELECT id FROM users WHERE public_id=$1 FOR UPDATE", [publicUserId])
    ).rows[0];
    if (!referred) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    if (
      (
        await client.query("SELECT 1 FROM referral_attributions WHERE referred_user_id=$1", [
          referred.id,
        ])
      ).rows[0]
    )
      throw Object.assign(new Error("Tu cuenta ya tiene un referido atribuido"), { status: 409 });
    const ref = (
      await client.query(
        `SELECT rc.id,rc.user_id,c.id campaign_id FROM referral_codes rc CROSS JOIN LATERAL(SELECT id FROM referral_campaigns WHERE active AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) LIMIT 1)c WHERE rc.code=$1 AND rc.disabled_at IS NULL FOR UPDATE OF rc`,
        [code.toUpperCase()],
      )
    ).rows[0];
    if (!ref)
      throw Object.assign(new Error("Código de referido inválido o fuera de vigencia"), {
        status: 404,
      });
    if (ref.user_id === referred.id)
      throw Object.assign(new Error("No podés usar tu propio código"), { status: 409 });
    if (
      Number(
        (
          await client.query(
            "SELECT count(*) FROM jobs WHERE customer_id=$1 AND status='completed'",
            [referred.id],
          )
        ).rows[0].count,
      ) > 0
    )
      throw Object.assign(new Error("El código sólo aplica antes del primer servicio completado"), {
        status: 409,
      });
    await client.query(
      `INSERT INTO referral_attributions(campaign_id,advocate_user_id,referred_user_id,code_id) VALUES($1,$2,$3,$4)`,
      [ref.campaign_id, ref.user_id, referred.id, ref.id],
    );
    await client.query("COMMIT");
    return getReferralSummary(publicUserId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
