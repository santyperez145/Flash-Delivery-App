import crypto from "node:crypto";
import { createPool } from "./db-client.mjs";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  created = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
async function account(label) {
  const email = `referral-${label}-${crypto.randomUUID()}@flash.test`,
    password = "Referral123!";
  const registration = await call("/auth/register", {
    method: "POST",
    body: { name: `Referral ${label}`, email, password },
  });
  await call("/auth/email-verification/confirm", {
    method: "POST",
    body: { email, code: registration.body.developmentCode },
  });
  const login = await call("/auth/login", { method: "POST", body: { email, password } });
  created.push(registration.body.user.id);
  return { publicId: registration.body.user.id, token: login.body.token };
}
try {
  const advocate = await account("Advocate"),
    friend = await account("Friend");
  const summary = await call("/referrals/me", { token: advocate.token });
  assert(
    summary.status === 200 &&
      /^FLASH[A-Z0-9]{8}$/.test(summary.body.referral.code) &&
      summary.body.referral.campaign?.advocateReward === 2500,
    "advocate receives stable active campaign code and real reward terms",
  );
  const own = await call("/referrals/claim", {
    method: "POST",
    token: advocate.token,
    body: { code: summary.body.referral.code },
  });
  assert(own.status === 409, "self-referral is rejected");
  const claimed = await call("/referrals/claim", {
    method: "POST",
    token: friend.token,
    body: { code: summary.body.referral.code },
  });
  assert(
    claimed.status === 200 && claimed.body.referral.attribution?.status === "pending",
    "new customer attribution persists pending first paid completion",
  );
  const replay = await call("/referrals/claim", {
    method: "POST",
    token: friend.token,
    body: { code: summary.body.referral.code },
  });
  assert(replay.status === 409, "a referred account cannot be attributed twice");
  const stats = await call("/referrals/me", { token: advocate.token });
  assert(
    stats.body.referral.invited === 1 && stats.body.referral.rewarded === 0,
    "advocate metrics derive from PostgreSQL attribution state",
  );
  const rows = await pool.query(
    `SELECT a.id,a.status,rc.code,u.id friend_id FROM referral_attributions a JOIN referral_codes rc ON rc.id=a.code_id JOIN users u ON u.id=a.referred_user_id WHERE u.public_id=$1`,
    [friend.publicId],
  );
  assert(
    rows.rows[0]?.status === "pending" && rows.rows[0].code === summary.body.referral.code,
    "database attribution links campaign, advocate and friend without frontend authority",
  );
  const jobId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO jobs(
      id,public_id,kind,customer_id,status,pickup_address,pickup_location,
      dropoff_address,dropoff_location,service_level,quoted_amount_cents,
      final_amount_cents,distance_m,estimated_duration_s,metadata
    ) VALUES(
      $1,$2,'ride',$3,'completed','Origen',
      ST_SetSRID(ST_MakePoint(-58.38,-34.60),4326)::geography,'Destino',
      ST_SetSRID(ST_MakePoint(-58.39,-34.61),4326)::geography,'economy',
      100000,100000,1000,600,'{}'
    )`,
    [jobId, `REF-${crypto.randomUUID()}`, rows.rows[0].friend_id],
  );
  await pool.query(
    `INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,idempotency_key) VALUES($1,$2,'flash_wallet','captured',100000,100000,$3)`,
    [jobId, rows.rows[0].friend_id, `referral-smoke-${crypto.randomUUID()}`],
  );
  const rewarded = await call("/referrals/me", { token: friend.token });
  assert(
    rewarded.body.referral.attribution?.status === "rewarded",
    "first completed paid job settles the referral atomically",
  );
  const ledger = await pool.query(
    `SELECT count(*)::int transactions,
      COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE 0 END),0)::bigint credits
    FROM ledger_transactions t
    JOIN ledger_entries e ON e.transaction_id=t.id
    WHERE t.metadata->>'attributionId'=$1`,
    [rows.rows[0].id],
  );
  assert(
    ledger.rows[0].transactions === 4 && Number(ledger.rows[0].credits) === 400000,
    "two balanced ledger transactions credit advocate and friend exactly once",
  );
  const again = await call("/referrals/me", { token: friend.token });
  const ledgerAgain = await pool.query(
    `SELECT count(DISTINCT t.id)::int count FROM ledger_transactions t WHERE t.metadata->>'attributionId'=$1`,
    [rows.rows[0].id],
  );
  assert(
    again.status === 200 && ledgerAgain.rows[0].count === 2,
    "reward settlement is idempotent on repeated reads",
  );
} finally {
  for (const publicId of created) {
    const user = (await pool.query("SELECT id FROM users WHERE public_id=$1", [publicId])).rows[0];
    if (!user) continue;
    await pool.query("DELETE FROM audit_events WHERE actor_id=$1 OR entity_id=$2", [
      user.id,
      publicId,
    ]);
    const attrs = (
      await pool.query(
        "SELECT id FROM referral_attributions WHERE advocate_user_id=$1 OR referred_user_id=$1",
        [user.id],
      )
    ).rows.map((row) => row.id);
    if (attrs.length) {
      await pool.query(
        "DELETE FROM ledger_entries WHERE transaction_id IN(SELECT id FROM ledger_transactions WHERE metadata->>'attributionId'=ANY($1))",
        [attrs],
      );
      await pool.query(
        "UPDATE referral_attributions SET advocate_transaction_id=NULL,friend_transaction_id=NULL WHERE id=ANY($1)",
        [attrs],
      );
      await pool.query("DELETE FROM ledger_transactions WHERE metadata->>'attributionId'=ANY($1)", [
        attrs,
      ]);
    }
    await pool.query("DELETE FROM payment_intents WHERE customer_id=$1", [user.id]);
    await pool.query("DELETE FROM jobs WHERE customer_id=$1", [user.id]);
    await pool.query(
      "DELETE FROM referral_attributions WHERE advocate_user_id=$1 OR referred_user_id=$1",
      [user.id],
    );
    await pool.query("DELETE FROM referral_codes WHERE user_id=$1", [user.id]);
    await pool.query("DELETE FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1", [
      user.id,
    ]);
    await pool.query("DELETE FROM users WHERE id=$1", [user.id]);
  }
  await pool.end();
}
