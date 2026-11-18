// Código de entrega en pedidos (SEG-03), como el PIN de Uber Eats.
//
// Un pedido con envío de valor alto, o de un cliente con un reclamo aprobado en
// los últimos 90 días, se entrega con un código: el cliente lo ve en el
// seguimiento y quien reparte lo ingresa antes de marcarlo entregado. Mismo
// esquema que el PIN de subida de los viajes: el código se deriva con HMAC y en
// la base sólo queda su hash bcrypt. Cinco intentos fallidos bloquean diez minutos.
import bcrypt from "bcryptjs";

import { config } from "./config.js";
import { postgresPool } from "./postgres.js";
import { deriveOrderDeliveryCode } from "./secret-envelope.js";

const terminales = ["completed", "cancelled"];

const pedido = (client, publicId, lock = false) =>
  client.query(
    `SELECT j.id,j.status,j.customer_id,d.user_id driver_user_id FROM jobs j
       LEFT JOIN drivers d ON d.id=j.driver_id
      WHERE j.public_id=$1 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order'
      ${lock ? "FOR UPDATE OF j" : ""}`,
    [publicId],
  );

/**
 * Decide, al crear el pedido y en su misma transacción, si se entrega con código.
 * Devuelve el motivo o `null`. Un retiro en el local no lleva código: no hay
 * entrega en una puerta.
 */
export async function requireOrderDeliveryCodeIfNeeded(
  client,
  { jobId, publicId, customerId, totalCents, pickup },
) {
  if (pickup) return null;
  let reason = null;
  if (totalCents >= config.orderDeliveryCodeMinCents) reason = "high_value";
  else {
    const reclamo = await client.query(
      `SELECT 1 FROM order_issues i JOIN jobs j ON j.id=i.job_id
        WHERE j.customer_id=$1 AND i.status='approved' AND i.created_at > now() - interval '90 days'
        LIMIT 1`,
      [customerId],
    );
    if (reclamo.rowCount) reason = "prior_claim";
  }
  if (!reason) return null;
  await client.query("INSERT INTO order_delivery_codes(job_id,pin_hash,reason) VALUES($1,$2,$3)", [
    jobId,
    await bcrypt.hash(deriveOrderDeliveryCode(publicId), 10),
    reason,
  ]);
  return reason;
}

/** ¿El pedido se entrega con código y todavía no se verificó? */
export async function orderNeedsDeliveryCode(orderPublicId) {
  const result = await postgresPool.query(
    `SELECT 1 FROM order_delivery_codes c JOIN jobs j ON j.id=c.job_id
      WHERE j.public_id=$1 AND c.verified_at IS NULL`,
    [orderPublicId],
  );
  return result.rowCount > 0;
}

/** El código, sólo para quien pidió y mientras el pedido sigue en curso. */
export async function getOrderDeliveryCode({ orderPublicId, userPublicId }) {
  const client = await postgresPool.connect();
  try {
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    const job = (await pedido(client, orderPublicId)).rows[0];
    if (!job) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
    if (job.customer_id !== user?.id)
      throw Object.assign(new Error("Sólo quien pidió puede ver el código"), { status: 403 });
    if (terminales.includes(job.status))
      throw Object.assign(new Error("El pedido ya terminó"), { status: 409 });
    const code = (
      await client.query("SELECT verified_at FROM order_delivery_codes WHERE job_id=$1", [job.id])
    ).rows[0];
    if (!code) throw Object.assign(new Error("Este pedido no usa código"), { status: 404 });
    if (code.verified_at) throw Object.assign(new Error("El código ya se usó"), { status: 409 });
    return { deliveryCode: deriveOrderDeliveryCode(orderPublicId) };
  } finally {
    client.release();
  }
}

/** Quien reparte ingresa el código al llegar. */
export async function verifyOrderDeliveryCode({ orderPublicId, userPublicId, pin }) {
  const client = await postgresPool.connect();
  let abierta = false;
  try {
    await client.query("BEGIN");
    abierta = true;
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    const job = (await pedido(client, orderPublicId, true)).rows[0];
    if (!job) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
    if (job.driver_user_id !== user?.id)
      throw Object.assign(new Error("Sólo quien reparte el pedido puede ingresar el código"), {
        status: 403,
      });
    if (job.status !== "delivering")
      throw Object.assign(new Error("El código se pide al llegar a la puerta"), { status: 409 });
    const code = (
      await client.query("SELECT * FROM order_delivery_codes WHERE job_id=$1 FOR UPDATE", [job.id])
    ).rows[0];
    if (!code) throw Object.assign(new Error("Este pedido no usa código"), { status: 404 });
    if (code.verified_at) {
      await client.query("COMMIT");
      abierta = false;
      return { verified: true, verifiedAt: new Date(code.verified_at).toISOString() };
    }
    if (code.locked_until && new Date(code.locked_until) > new Date())
      throw Object.assign(new Error("Demasiados intentos: probá de nuevo en unos minutos"), {
        status: 429,
      });
    if (!(await bcrypt.compare(pin, code.pin_hash))) {
      const intentos = Math.min(5, Number(code.failed_attempts) + 1),
        bloqueado = intentos >= 5;
      await client.query(
        "UPDATE order_delivery_codes SET failed_attempts=$2,locked_until=CASE WHEN $3 THEN now()+interval '10 minutes' ELSE NULL END,updated_at=now() WHERE job_id=$1",
        [job.id, intentos, bloqueado],
      );
      await client.query("COMMIT");
      abierta = false;
      throw Object.assign(
        new Error(bloqueado ? "Código incorrecto; esperá unos minutos" : "Código incorrecto"),
        { status: bloqueado ? 429 : 400, attemptsRemaining: Math.max(0, 5 - intentos) },
      );
    }
    const verifiedAt = (
      await client.query(
        "UPDATE order_delivery_codes SET verified_at=now(),verified_by=$2,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE job_id=$1 RETURNING verified_at",
        [job.id, user.id],
      )
    ).rows[0].verified_at;
    await client.query("COMMIT");
    abierta = false;
    return { verified: true, verifiedAt: new Date(verifiedAt).toISOString() };
  } catch (error) {
    if (abierta) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
