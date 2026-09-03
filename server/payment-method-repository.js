// Métodos de pago del cliente — sandbox tokenizado (ARC-001).
//
// Separados de auth/sesión y del cobro marketplace (Mercado Pago seller).
// Acá sólo la tarjeta/wallet guardada en `payment_methods`.
import { postgresPool } from "./postgres.js";

export async function getPostgresPaymentMethods() {
  const result = await postgresPool.query(
    `SELECT pm.id::text,u.public_id user_id,pm.kind,pm.brand,pm.last4,pm.expiry_month,pm.expiry_year,pm.is_default
    FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.revoked_at IS NULL ORDER BY pm.created_at`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    type: row.kind,
    label:
      row.kind === "wallet"
        ? "Flash Wallet"
        : `${row.brand || row.kind} •••• ${row.last4 || ""}`.trim(),
    brand: row.brand || null,
    last4: row.last4 || null,
    expiryMonth: row.expiry_month || null,
    expiryYear: row.expiry_year || null,
    isDefault: row.is_default,
  }));
}

export async function createSandboxPaymentMethod({
  userPublicId,
  providerToken,
  brand,
  last4,
  expiryMonth,
  expiryYear,
  isDefault = false,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (
      await client.query("SELECT id FROM users WHERE public_id=$1 FOR UPDATE", [userPublicId])
    ).rows[0];
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const count = Number(
      (
        await client.query(
          "SELECT count(*)::int count FROM payment_methods WHERE user_id=$1 AND revoked_at IS NULL AND kind<>'wallet'",
          [user.id],
        )
      ).rows[0].count,
    );
    if (count >= 8)
      throw Object.assign(new Error("Alcanzaste el máximo de 8 métodos de pago"), { status: 409 });
    const makeDefault = Boolean(isDefault) || count === 0;
    if (makeDefault)
      await client.query(
        "UPDATE payment_methods SET is_default=false WHERE user_id=$1 AND revoked_at IS NULL",
        [user.id],
      );
    const row = (
      await client.query(
        `INSERT INTO payment_methods(user_id,provider,provider_payment_method_id,kind,brand,last4,expiry_month,expiry_year,is_default)
        VALUES($1,'sandbox',$2,'card',$3,$4,$5,$6,$7) RETURNING id::text`,
        [user.id, providerToken, brand, last4, expiryMonth, expiryYear, makeDefault],
      )
    ).rows[0];
    await client.query("COMMIT");
    return (await getPostgresPaymentMethods()).find((entry) => entry.id === row.id);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505")
      throw Object.assign(new Error("Ese método de pago ya fue registrado"), { status: 409 });
    throw error;
  } finally {
    client.release();
  }
}

export async function setDefaultPostgresPaymentMethod({ userPublicId, paymentMethodId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const owned = (
      await client.query(
        `SELECT pm.id FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.id=$1 AND u.public_id=$2 AND pm.revoked_at IS NULL FOR UPDATE`,
        [paymentMethodId, userPublicId],
      )
    ).rows[0];
    if (!owned) throw Object.assign(new Error("Método de pago no encontrado"), { status: 404 });
    await client.query(
      `UPDATE payment_methods SET is_default=(id=$1) WHERE user_id=(SELECT id FROM users WHERE public_id=$2) AND revoked_at IS NULL`,
      [paymentMethodId, userPublicId],
    );
    await client.query("COMMIT");
    return (await getPostgresPaymentMethods()).find(
      (entry) => entry.id === String(paymentMethodId),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokePostgresPaymentMethod({ userPublicId, paymentMethodId }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const owned = (
      await client.query(
        `SELECT pm.id,pm.user_id,pm.kind,pm.is_default FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.id=$1 AND u.public_id=$2 AND pm.revoked_at IS NULL FOR UPDATE`,
        [paymentMethodId, userPublicId],
      )
    ).rows[0];
    if (!owned) throw Object.assign(new Error("Método de pago no encontrado"), { status: 404 });
    if (owned.kind === "wallet")
      throw Object.assign(new Error("Flash Wallet no puede eliminarse"), { status: 409 });
    await client.query("UPDATE payment_methods SET revoked_at=now(),is_default=false WHERE id=$1", [
      paymentMethodId,
    ]);
    if (owned.is_default)
      await client.query(
        `UPDATE payment_methods SET is_default=true
        WHERE id=(SELECT id FROM payment_methods WHERE user_id=$1 AND revoked_at IS NULL
          ORDER BY CASE WHEN kind='wallet' THEN 0 ELSE 1 END,created_at LIMIT 1)`,
        [owned.user_id],
      );
    await client.query("COMMIT");
    return getPostgresPaymentMethods();
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
