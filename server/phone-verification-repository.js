import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import { config } from "./config.js";
import { checkPhoneVerification, startPhoneVerification } from "./phone-verification-provider.js";

export async function requestPhoneVerification(userPublicId) {
  const snapshot = (
    await postgresPool.query(
      "SELECT id,public_id,phone,phone_verified_at FROM users WHERE public_id=$1 AND status='active'",
      [userPublicId],
    )
  ).rows[0];
  if (!snapshot) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
  if (!/^\+[1-9][0-9]{7,14}$/.test(snapshot.phone || ""))
    throw Object.assign(
      new Error("Guardá un teléfono en formato internacional antes de verificarlo"),
      { status: 409 },
    );
  if (snapshot.phone_verified_at)
    throw Object.assign(new Error("El teléfono ya está verificado"), { status: 409 });
  const recent = (
    await postgresPool.query(
      "SELECT created_at FROM phone_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [snapshot.id],
    )
  ).rows[0];
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 30000)
    throw Object.assign(new Error("Esperá 30 segundos antes de solicitar otro código"), {
      status: 429,
      retryAfter: 30,
    });
  const started = await startPhoneVerification(snapshot.phone);
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (
      await client.query(
        "SELECT id,public_id,phone,phone_verified_at FROM users WHERE public_id=$1 AND status='active' FOR UPDATE",
        [userPublicId],
      )
    ).rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    if (user.phone !== snapshot.phone)
      throw Object.assign(
        new Error("El teléfono cambió durante la verificación; solicitá un código nuevo"),
        { status: 409 },
      );
    if (!/^\+[1-9][0-9]{7,14}$/.test(user.phone || ""))
      throw Object.assign(
        new Error("Guardá un teléfono en formato internacional antes de verificarlo"),
        { status: 409 },
      );
    if (user.phone_verified_at)
      throw Object.assign(new Error("El teléfono ya está verificado"), { status: 409 });
    const previous = (
      await client.query(
        "SELECT created_at FROM phone_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [user.id],
      )
    ).rows[0];
    if (previous && Date.now() - new Date(previous.created_at).getTime() < 30000)
      throw Object.assign(new Error("Esperá 30 segundos antes de solicitar otro código"), {
        status: 429,
        retryAfter: 30,
      });
    await client.query(
      "UPDATE phone_verification_challenges SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL",
      [user.id],
    );
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await client.query(
      "INSERT INTO phone_verification_challenges(user_id,phone,provider,provider_reference,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        user.id,
        user.phone,
        config.phoneVerification.provider,
        started.providerReference,
        started.developmentCode ? bcrypt.hashSync(started.developmentCode, 12) : null,
        expiresAt,
      ],
    );
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) VALUES($1,ARRAY['customer']::user_role[],'auth.phone_verification_requested','user',$2,$3)",
      [
        user.id,
        user.public_id,
        { provider: config.phoneVerification.provider, expiresAt: expiresAt.toISOString() },
      ],
    );
    await client.query("COMMIT");
    return {
      expiresAt: expiresAt.toISOString(),
      retryAfterSeconds: 30,
      ...(started.developmentCode && !config.isProduction
        ? { developmentCode: started.developmentCode }
        : {}),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmPhoneVerification({ userPublicId, code }) {
  const client = await postgresPool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const row = (
      await client.query(
        `SELECT c.*, u.public_id
         FROM phone_verification_challenges c
         JOIN users u ON u.id=c.user_id
         WHERE u.public_id=$1 AND u.status='active' AND c.consumed_at IS NULL
         ORDER BY c.created_at DESC LIMIT 1
         FOR UPDATE OF c,u`,
        [userPublicId],
      )
    ).rows[0];
    if (!row || row.expires_at <= new Date() || row.failed_attempts >= 5)
      throw Object.assign(new Error("El código no existe, venció o agotó sus intentos"), {
        status: 400,
      });
    const valid =
      row.provider === "sandbox"
        ? Boolean(row.code_hash && bcrypt.compareSync(code, row.code_hash))
        : await checkPhoneVerification(row.phone, code);
    if (!valid) {
      const attempts = Math.min(5, Number(row.failed_attempts) + 1);
      await client.query(
        "UPDATE phone_verification_challenges SET failed_attempts=$2::smallint,consumed_at=CASE WHEN $2::smallint>=5 THEN now() ELSE consumed_at END WHERE id=$1",
        [row.id, attempts],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      throw Object.assign(new Error("Código incorrecto o vencido"), { status: 400 });
    }
    await client.query("UPDATE phone_verification_challenges SET consumed_at=now() WHERE id=$1", [
      row.id,
    ]);
    await client.query("UPDATE users SET phone_verified_at=now(),updated_at=now() WHERE id=$1", [
      row.user_id,
    ]);
    await client.query(
      "INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id) VALUES($1,ARRAY['customer']::user_role[],'auth.phone_verified','user',$2)",
      [row.user_id, row.public_id],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    return { verified: true, phone: row.phone };
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
