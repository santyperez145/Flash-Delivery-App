// Dividir la tarifa de un viaje (PAG-02), como Uber.
//
// Quien pidió un viaje pagado con Flash Wallet invita por email a otras cuentas
// Flash. Cada invitado que acepta paga su parte desde su Wallet. La tarifa se
// divide en partes iguales entre quien pidió y quienes aceptaron, y con cada
// aceptación se reequilibra: el nuevo paga su parte y a los anteriores se les
// devuelve lo que pagaron de más.
//
// **El dinero va de pasajero a pasajero** (asiento `fare_split`, migración 144). El
// viaje ya está cobrado entero a quien lo pidió, así que la liquidación del
// conductor y los reintegros no cambian. Si el viaje se cancela, quien pidió
// recibe el total como siempre y acá se le devuelve a cada invitado lo suyo.
import crypto from "node:crypto";

import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { pesos } from "./money.js";
import { postgresPool } from "./postgres.js";

const MAX_INVITADOS = 4;
const terminales = ["completed", "cancelled"];
const publicId = () => `SPL-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const primerNombre = (nombre) => String(nombre || "").split(" ")[0] || "Alguien";

const cuentaWallet = async (client, userId) =>
  (
    await client.query(
      `INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
       VALUES('user',$1,'ARS','wallet')
       ON CONFLICT(owner_type,owner_id,currency,account_type) DO UPDATE SET owner_type=EXCLUDED.owner_type
       RETURNING id`,
      [userId],
    )
  ).rows[0].id;

const saldo = async (client, accountId) =>
  Number(
    (
      await client.query(
        `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint balance
         FROM ledger_entries WHERE account_id=$1`,
        [accountId],
      )
    ).rows[0].balance,
  );

/** El viaje, bloqueado, con lo cobrado por Wallet. */
const viaje = (client, ridePublicId) =>
  client.query(
    `SELECT j.id,j.public_id,j.status,j.customer_id,j.dropoff_address,u.name customer_name,
       (SELECT p.captured_amount_cents FROM payment_intents p
         WHERE p.job_id=j.id AND p.provider='flash_wallet' AND p.status='captured') captured_cents
     FROM jobs j JOIN users u ON u.id=j.customer_id
     WHERE j.public_id=$1 AND j.kind='ride' FOR UPDATE OF j`,
    [ridePublicId],
  );

/**
 * Asienta movimientos entre billeteras en una sola transacción cuadrada.
 * `movimientos` es `[{ userId, cents }]`: positivo acredita, negativo debita.
 */
async function moverEntreBilleteras(client, { idempotencyKey, description, jobId, movimientos }) {
  const efectivos = movimientos.filter((movimiento) => movimiento.cents !== 0);
  if (!efectivos.length) return;
  const suma = efectivos.reduce((total, movimiento) => total + movimiento.cents, 0);
  if (suma !== 0) throw new Error("La división de la tarifa no cuadra");
  const cuentas = await Promise.all(
    efectivos.map(async (movimiento) => ({
      ...movimiento,
      accountId: await cuentaWallet(client, movimiento.userId),
    })),
  );
  // Se bloquean en orden fijo para que dos aceptaciones simultáneas no se traben.
  await client.query("SELECT id FROM ledger_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE", [
    cuentas.map((cuenta) => cuenta.accountId),
  ]);
  const transaccion = (
    await client.query(
      `INSERT INTO ledger_transactions(idempotency_key,kind,description,metadata)
       VALUES($1,'fare_split',$2,$3) RETURNING id`,
      [idempotencyKey, description, { jobId }],
    )
  ).rows[0].id;
  for (const cuenta of cuentas)
    await client.query(
      `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id)
       VALUES($1,$2,$3,$4,'fare_split',$5)`,
      [
        transaccion,
        cuenta.accountId,
        cuenta.cents > 0 ? "credit" : "debit",
        Math.abs(cuenta.cents),
        jobId,
      ],
    );
}

/** Quien pidió el viaje invita a otra cuenta Flash por su email. */
export async function inviteToSplitFare({ ridePublicId, userPublicId, email }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    const ride = (await viaje(client, ridePublicId)).rows[0];
    if (!ride) throw Object.assign(new Error("Viaje no encontrado"), { status: 404 });
    if (ride.customer_id !== user?.id)
      throw Object.assign(new Error("Sólo quien pidió el viaje puede dividirlo"), { status: 403 });
    if (terminales.includes(ride.status))
      throw Object.assign(new Error("El viaje ya terminó"), { status: 409 });
    if (!ride.captured_cents)
      throw Object.assign(new Error("Sólo se divide un viaje pagado con Flash Wallet"), {
        status: 409,
      });
    // Un email que no es de un cliente activo responde lo mismo que uno inexistente:
    // la invitación no sirve para averiguar quién tiene cuenta.
    const invitado = (
      await client.query(
        `SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id AND r.role='customer'
         WHERE lower(u.email)=lower($1) AND u.status='active' AND u.id<>$2 LIMIT 1`,
        [email, user.id],
      )
    ).rows[0];
    if (!invitado)
      throw Object.assign(new Error("No encontramos una cuenta Flash con ese email"), {
        status: 404,
      });
    const vigentes = Number(
      (
        await client.query(
          "SELECT count(*)::int count FROM ride_fare_splits WHERE job_id=$1 AND status IN('invited','accepted')",
          [ride.id],
        )
      ).rows[0].count,
    );
    if (vigentes >= MAX_INVITADOS)
      throw Object.assign(new Error(`Podés dividir con hasta ${MAX_INVITADOS} personas`), {
        status: 409,
      });
    const split = (
      await client.query(
        `INSERT INTO ride_fare_splits(public_id,job_id,inviter_id,invitee_id) VALUES($1,$2,$3,$4)
         ON CONFLICT(job_id,invitee_id) DO NOTHING RETURNING public_id`,
        [publicId(), ride.id, user.id, invitado.id],
      )
    ).rows[0];
    if (!split) throw Object.assign(new Error("Ya invitaste a esa persona"), { status: 409 });
    await enqueueNotificationForInternalUser(client, {
      userId: invitado.id,
      template: "ride_split_invite",
      payload: {
        title: "Te invitaron a dividir un viaje",
        body: `${primerNombre(ride.customer_name)} quiere dividir el viaje a ${ride.dropoff_address}.`,
        splitId: split.public_id,
        rideId: ridePublicId,
      },
      deduplicationKey: `ride-split:${split.public_id}`,
    });
    await client.query("COMMIT");
    return { id: split.public_id, status: "invited" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Para quien pidió: con quién divide, en qué estado y cuánto le toca a cada uno. */
export async function listRideFareSplits({ ridePublicId, userPublicId }) {
  const result = await postgresPool.query(
    `SELECT s.public_id,s.status,s.paid_cents,u.name invitee_name
     FROM ride_fare_splits s JOIN jobs j ON j.id=s.job_id JOIN users u ON u.id=s.invitee_id
     JOIN users me ON me.id=s.inviter_id
     WHERE j.public_id=$1 AND me.public_id=$2 ORDER BY s.created_at`,
    [ridePublicId, userPublicId],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    name: primerNombre(row.invitee_name),
    status: row.status,
    paid: pesos(row.paid_cents),
  }));
}

/** Para un invitado: las invitaciones pendientes, con cuánto pagaría si acepta. */
export async function listMyFareSplitInvitations(userPublicId) {
  const result = await postgresPool.query(
    `SELECT s.public_id,j.public_id ride_id,j.dropoff_address,inviter.name inviter_name,
       (SELECT p.captured_amount_cents FROM payment_intents p
         WHERE p.job_id=j.id AND p.provider='flash_wallet' AND p.status='captured') captured_cents,
       (SELECT count(*)::int FROM ride_fare_splits x WHERE x.job_id=j.id AND x.status='accepted') accepted
     FROM ride_fare_splits s JOIN jobs j ON j.id=s.job_id
     JOIN users me ON me.id=s.invitee_id JOIN users inviter ON inviter.id=s.inviter_id
     WHERE me.public_id=$1 AND s.status='invited' AND j.status NOT IN('completed','cancelled')
     ORDER BY s.created_at DESC`,
    [userPublicId],
  );
  return result.rows.map((row) => ({
    id: row.public_id,
    rideId: row.ride_id,
    inviterName: primerNombre(row.inviter_name),
    destination: row.dropoff_address,
    // Si acepta, el total se divide entre quien pidió, los que ya aceptaron y él.
    share: pesos(Math.floor(Number(row.captured_cents || 0) / (Number(row.accepted) + 2))),
  }));
}

/** El invitado acepta (y paga su parte) o rechaza. */
export async function respondToFareSplit({ splitPublicId, userPublicId, accept }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT id FROM users WHERE public_id=$1", [userPublicId]))
      .rows[0];
    const split = (
      await client.query(
        `SELECT s.id,s.status,s.invitee_id,j.public_id ride_public_id FROM ride_fare_splits s
         JOIN jobs j ON j.id=s.job_id WHERE s.public_id=$1`,
        [splitPublicId],
      )
    ).rows[0];
    if (!split) throw Object.assign(new Error("Invitación no encontrada"), { status: 404 });
    if (split.invitee_id !== user?.id)
      throw Object.assign(new Error("Esta invitación es para otra persona"), { status: 403 });
    // El viaje se bloquea primero: dos aceptaciones del mismo viaje se ordenan acá.
    const ride = (await viaje(client, split.ride_public_id)).rows[0];
    const vigente = (
      await client.query("SELECT status FROM ride_fare_splits WHERE id=$1 FOR UPDATE", [split.id])
    ).rows[0];
    if (vigente.status !== "invited")
      throw Object.assign(new Error("Esta invitación ya fue respondida"), { status: 409 });
    if (terminales.includes(ride.status) || !ride.captured_cents)
      throw Object.assign(new Error("El viaje ya terminó"), { status: 409 });
    if (!accept) {
      await client.query(
        "UPDATE ride_fare_splits SET status='declined',responded_at=now() WHERE id=$1",
        [split.id],
      );
      await client.query("COMMIT");
      return { id: splitPublicId, rideId: split.ride_public_id, status: "declined" };
    }
    const aceptados = (
      await client.query(
        "SELECT id,invitee_id,paid_cents FROM ride_fare_splits WHERE job_id=$1 AND status='accepted' FOR UPDATE",
        [ride.id],
      )
    ).rows;
    const total = Number(ride.captured_cents);
    const parte = Math.floor(total / (aceptados.length + 2));
    // Lo que cada uno tiene que mover para quedar en su parte: el nuevo paga entera
    // la suya; a los anteriores se les devuelve lo que pagaron de más.
    const movimientos = [
      { userId: user.id, cents: -parte },
      ...aceptados.map((row) => ({
        userId: row.invitee_id,
        cents: Number(row.paid_cents) - parte,
      })),
    ];
    const cuentaInvitado = await cuentaWallet(client, user.id);
    await client.query("SELECT id FROM ledger_accounts WHERE id=$1 FOR UPDATE", [cuentaInvitado]);
    if ((await saldo(client, cuentaInvitado)) < parte)
      throw Object.assign(new Error("Saldo insuficiente en Flash Wallet para tu parte"), {
        status: 402,
      });
    // Lo que entra o sale de los invitados lo compensa quien pidió el viaje.
    movimientos.push({
      userId: ride.customer_id,
      cents: -movimientos.reduce((suma, movimiento) => suma + movimiento.cents, 0),
    });
    await moverEntreBilleteras(client, {
      idempotencyKey: `fare-split-accept-${splitPublicId}`,
      description: `División de tarifa ${ride.public_id}`,
      jobId: ride.id,
      movimientos,
    });
    await client.query(
      "UPDATE ride_fare_splits SET paid_cents=$2 WHERE job_id=$1 AND status='accepted'",
      [ride.id, parte],
    );
    await client.query(
      "UPDATE ride_fare_splits SET status='accepted',paid_cents=$2,responded_at=now() WHERE id=$1",
      [split.id, parte],
    );
    await client.query("COMMIT");
    return {
      id: splitPublicId,
      rideId: split.ride_public_id,
      status: "accepted",
      share: pesos(parte),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Al cancelar un viaje dividido: quien pidió ya recibió el total de vuelta, así que
 * se le devuelve a cada invitado lo que pagó. Corre dentro de la transacción de la
 * cancelación.
 */
export async function refundFareSplitsOnCancel(client, { jobId, ridePublicId, customerId }) {
  const aceptados = (
    await client.query(
      "SELECT invitee_id,paid_cents FROM ride_fare_splits WHERE job_id=$1 AND status='accepted' AND paid_cents>0 FOR UPDATE",
      [jobId],
    )
  ).rows;
  const devuelto = aceptados.reduce((suma, row) => suma + Number(row.paid_cents), 0);
  await moverEntreBilleteras(client, {
    idempotencyKey: `fare-split-refund-${ridePublicId}`,
    description: `Reintegro de división ${ridePublicId}`,
    jobId,
    movimientos: [
      { userId: customerId, cents: -devuelto },
      ...aceptados.map((row) => ({ userId: row.invitee_id, cents: Number(row.paid_cents) })),
    ],
  });
  await client.query(
    "UPDATE ride_fare_splits SET status='cancelled',paid_cents=0 WHERE job_id=$1 AND status IN('invited','accepted')",
    [jobId],
  );
  return devuelto;
}
