// El reintegro proporcional reparte bien, y siempre igual (ticket PAY-001).
//
// Cuando se aprueba una incidencia con reintegro, `resolveOrderIssue` revierte
// la liquidación del pedido: debita a cada parte —comercio, repartidor,
// plataforma— en proporción a lo que cobró, acredita el total a la cuenta de
// compensación, y en una segunda transacción acredita al cliente. Hasta acá no
// había ninguna prueba sobre ese reparto: el módulo entero estaba sin cobertura.
//
// El reparto usa `floor` y le da el resto al último renglón, así que dos cosas
// hacían falta antes de poder probarlo:
//
// - **Cuál es el último renglón.** La consulta que alimenta el bucle no tenía
//   `ORDER BY`, así que lo elegía el planificador y el centavo sobrante caía en
//   una parte u otra sin regla —y el mismo reintegro podía repartirse distinto
//   al repetirse—. Ahora ordena por importe: el resto lo absorbe la parte con
//   mayor participación, que es la que menos se distorsiona en relativo.
// - **Números que fuercen el redondeo.** Con proporciones exactas cualquier
//   implementación pasa. Acá la liquidación es 3333/3333/3334 sobre 10000 y el
//   reintegro es 1000: los ideales caen en 333,3 y 333,4, así que el reparto
//   tiene que dar 333/333/334 y no perder ni inventar un centavo.
import crypto from "node:crypto";
import pg from "pg";
import { resolveOrderIssue } from "../server/order-issue-repository.js";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const marca = `refund-split-${crypto.randomBytes(4).toString("hex")}`;
const issuePublicId = `ISS-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const LIQUIDACION = [3333, 3333, 3334];
const TOTAL = LIQUIDACION.reduce((suma, valor) => suma + valor, 0);
const REINTEGRO = 1000;
const ESPERADO = [333, 333, 334];

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const comparar = (obtenido, esperado, etiqueta) => {
  if (JSON.stringify(obtenido) === JSON.stringify(esperado)) return ok(etiqueta);
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  console.error(`        esperaba ${JSON.stringify(esperado)}`);
  console.error(`        obtuvo   ${JSON.stringify(obtenido)}`);
  return undefined;
};

const creado = { cuentas: [], transacciones: [], issue: null, pago: null };

try {
  // --- Siembra -------------------------------------------------------------
  const trabajo = (
    await pool.query(
      `SELECT j.id, j.public_id, j.customer_id, j.final_amount_cents
       FROM jobs j
       WHERE j.kind = 'delivery' AND j.metadata->>'subtype' = 'food_order'
         AND j.status NOT IN ('cancelled') AND j.final_amount_cents >= $1
       ORDER BY j.created_at DESC LIMIT 1`,
      [TOTAL],
    )
  ).rows[0];
  if (!trabajo) throw new Error("No hay un pedido de comida sembrado para usar de fixture");

  const actor = (await pool.query("SELECT public_id FROM users LIMIT 1")).rows[0];
  if (!actor) throw new Error("No hay usuarios para actuar de resolutor");

  const cuentaDe = async (ownerType, ownerId, tipo) => {
    const existente = (
      await pool.query(
        `SELECT id FROM ledger_accounts
         WHERE owner_type = $1 AND owner_id IS NOT DISTINCT FROM $2 AND account_type = $3`,
        [ownerType, ownerId, tipo],
      )
    ).rows[0];
    if (existente) return existente.id;
    const id = (
      await pool.query(
        `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
         VALUES($1, $2, 'ARS', $3) RETURNING id`,
        [ownerType, ownerId, tipo],
      )
    ).rows[0].id;
    creado.cuentas.push(id);
    return id;
  };

  const compensacion = await cuentaDe("platform", null, "cash_clearing");
  const billetera = await cuentaDe("user", trabajo.customer_id, "wallet");
  const partes = [];
  for (const importe of LIQUIDACION) {
    partes.push({
      importe,
      cuenta: await cuentaDe(`${marca}-parte-${importe}`, null, "settlement"),
    });
  }

  // La liquidación sembrada también tiene que cuadrar: desde la migración 118 la
  // base rechaza al commit una transacción cuyos débitos no igualen a sus
  // créditos, y un fixture no es una excepción.
  const liquidacion = (
    await pool.query(
      `INSERT INTO ledger_transactions(idempotency_key, kind, description, metadata)
       VALUES($1, 'payment', 'Liquidacion de fixture', $2) RETURNING id`,
      [`settlement-${trabajo.public_id}`, { marca }],
    )
  ).rows[0].id;
  creado.transacciones.push(liquidacion);
  for (const parte of partes) {
    await pool.query(
      `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents, reference_type, reference_id)
       VALUES($1, $2, 'credit', $3, 'settlement', $4)`,
      [liquidacion, parte.cuenta, parte.importe, trabajo.id],
    );
  }
  await pool.query(
    `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents, reference_type, reference_id)
     VALUES($1, $2, 'debit', $3, 'settlement', $4)`,
    [liquidacion, compensacion, TOTAL, trabajo.id],
  );

  creado.pago = (
    await pool.query(
      `INSERT INTO payment_intents(job_id, customer_id, provider, status, amount_cents, captured_amount_cents, currency, idempotency_key)
       VALUES($1, $2, 'flash_wallet', 'captured', $3, $3, 'ARS', $4) RETURNING id`,
      [trabajo.id, trabajo.customer_id, TOTAL, `${marca}-intent`],
    )
  ).rows[0].id;

  creado.issue = (
    await pool.query(
      `INSERT INTO order_issues(public_id, job_id, reporter_id, category, description, requested_refund_cents)
       VALUES($1, $2, $3, 'missing_item', 'Fixture de reparto proporcional', $4) RETURNING id`,
      [issuePublicId, trabajo.id, trabajo.customer_id, REINTEGRO],
    )
  ).rows[0].id;

  // --- Ejecución -----------------------------------------------------------
  await resolveOrderIssue({
    issuePublicId,
    actorPublicId: actor.public_id,
    status: "approved",
    approvedRefund: REINTEGRO / 100,
    resolutionNote: "Reparto proporcional verificado por contrato",
  });

  creado.transacciones.push(
    ...(
      await pool.query("SELECT id FROM ledger_transactions WHERE idempotency_key = ANY($1)", [
        [`issue-reversal-${issuePublicId}`, `issue-refund-${issuePublicId}`],
      ])
    ).rows.map((fila) => fila.id),
  );

  // --- Comprobaciones ------------------------------------------------------
  const reversion = await pool.query(
    `SELECT e.account_id, e.direction, e.amount_cents
     FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
     WHERE t.idempotency_key = $1`,
    [`issue-reversal-${issuePublicId}`],
  );
  const debitos = reversion.rows.filter((fila) => fila.direction === "debit");

  comparar(
    debitos.map((fila) => Number(fila.amount_cents)).sort((a, b) => a - b),
    ESPERADO,
    `el reintegro de ${REINTEGRO} se reparte ${ESPERADO.join("/")} sobre ${LIQUIDACION.join("/")}`,
  );

  comparar(
    debitos.reduce((total, fila) => total + Number(fila.amount_cents), 0),
    REINTEGRO,
    "los debitos de la reversion suman exactamente el reintegro",
  );

  // El resto tiene que caer en la parte mayor, no en cualquiera. Sin el ORDER BY
  // esta comprobación es la que se vuelve intermitente.
  const mayor = partes.reduce((a, b) => (a.importe >= b.importe ? a : b));
  const debitoDelMayor = debitos.find((fila) => String(fila.account_id) === String(mayor.cuenta));
  comparar(
    Number(debitoDelMayor?.amount_cents ?? 0),
    334,
    "el centavo sobrante lo absorbe la parte con mayor participacion",
  );

  const alCliente = (
    await pool.query(
      `SELECT e.amount_cents FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id = t.id
       WHERE t.idempotency_key = $1 AND e.direction = 'credit' AND e.account_id = $2`,
      [`issue-refund-${issuePublicId}`, billetera],
    )
  ).rows[0];
  comparar(
    Number(alCliente?.amount_cents ?? 0),
    REINTEGRO,
    "el cliente recibe exactamente el reintegro aprobado",
  );

  // --- Guardas -------------------------------------------------------------
  let segundaVez = null;
  await resolveOrderIssue({
    issuePublicId,
    actorPublicId: actor.public_id,
    status: "approved",
    approvedRefund: REINTEGRO / 100,
    resolutionNote: "Intento de resolver dos veces",
  }).catch((error) => {
    segundaVez = error;
  });
  if (segundaVez?.status === 409) {
    ok("una incidencia ya resuelta no se puede volver a reintegrar");
  } else {
    fallos++;
    console.error("FALLA - resolver dos veces la misma incidencia no dio 409");
    console.error(`        obtuvo ${segundaVez ? segundaVez.message : "ningun error"}`);
  }
} finally {
  // --- Limpieza ------------------------------------------------------------
  // Los asientos se borran antes que sus transacciones. Borrar todos los de una
  // transacción la deja en cero contra cero, que cuadra: el trigger de la 118 lo
  // acepta a propósito.
  if (creado.transacciones.length) {
    await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1)", [
      creado.transacciones,
    ]);
  }
  if (creado.issue) {
    await pool.query("DELETE FROM refunds WHERE reason = $1", [issuePublicId]);
    await pool.query("DELETE FROM order_issues WHERE id = $1", [creado.issue]);
  }
  if (creado.transacciones.length) {
    await pool.query("DELETE FROM ledger_transactions WHERE id = ANY($1)", [creado.transacciones]);
  }
  if (creado.pago) await pool.query("DELETE FROM payment_intents WHERE id = $1", [creado.pago]);
  if (creado.cuentas.length) {
    await pool.query("DELETE FROM ledger_accounts WHERE id = ANY($1)", [creado.cuentas]);
  }
  await pool.end();
}

if (fallos) {
  console.error(`\n${fallos} comprobacion(es) del reparto proporcional fallaron`);
  process.exit(1);
}
console.log("\nok - el reintegro proporcional reparte bien y siempre igual");
