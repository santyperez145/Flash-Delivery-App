// Un pago repetido no genera un segundo asiento (ticket PAY-001).
//
// `recordMarketplaceCapture` inserta la transacción contable con
// `ON CONFLICT(idempotency_key) DO NOTHING` y clave
// `marketplace-capture-<providerPaymentId>`. De ahí sale la idempotencia: si el
// webhook de Mercado Pago llega dos veces —cosa que pasa, los proveedores
// reintentan— la segunda no escribe nada y el dinero no se cuenta dos veces.
//
// Eso estaba afirmado y no probado. `test:ledger-balance` ya exige que la
// columna siga siendo UNIQUE, que es la mitad estructural; esto es la mitad de
// comportamiento: que el código efectivamente use la clave y trate el conflicto
// como «ya estaba» en lugar de reventar o insertar de nuevo.
//
// **Las dos mitades.** También se comprueba que dos pagos distintos generen dos
// transacciones. Una implementación que considere duplicado todo pasaría la
// primera comprobación y perdería pagos, que es peor que contarlos dos veces.
//
// Todo corre dentro de una transacción que termina en ROLLBACK. El chequeo
// diferido de la migración 118 se adelanta con `SET CONSTRAINTS ... IMMEDIATE`,
// así que además queda probado que la captura escribe asientos que cuadran.
import crypto from "node:crypto";
import pg from "pg";
import { recordMarketplaceCapture } from "../server/merchant-finance-repository.js";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const IMPORTE = 250000;
const COMISION = 37500;

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

const captura = (client, providerPaymentId) =>
  recordMarketplaceCapture(client, {
    paymentIntentId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobPublicId: `JOB-${providerPaymentId}`,
    providerPaymentId,
    amountCents: IMPORTE,
    applicationFeeCents: COMISION,
    collectorId: "collector-de-prueba",
  });

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const pago = `idem-${crypto.randomBytes(6).toString("hex")}`;
  const primera = await captura(client, pago);
  const segunda = await captura(client, pago);

  comparar(primera, { recorded: true, idempotent: false }, "la primera captura registra");
  comparar(
    segunda,
    { recorded: true, idempotent: true },
    "la segunda captura se reconoce repetida",
  );

  const transacciones = await client.query(
    "SELECT id FROM ledger_transactions WHERE idempotency_key = $1",
    [`marketplace-capture-${pago}`],
  );
  comparar(transacciones.rowCount, 1, "el pago repetido deja una sola transaccion contable");

  // Ordena por `direction::text` a proposito. `ORDER BY direction` a secas usa el
  // orden declarado del enum —('debit','credit')— y no el alfabetico, que es
  // justo lo que asumia la primera version de esta comprobacion. Castear saca la
  // ambiguedad y aguanta que alguien agregue un valor al enum.
  const asientos = await client.query(
    `SELECT direction, amount_cents FROM ledger_entries WHERE transaction_id = $1
     ORDER BY direction::text`,
    [transacciones.rows[0]?.id ?? null],
  );
  comparar(
    asientos.rows.map((fila) => `${fila.direction}:${fila.amount_cents}`),
    [`credit:${IMPORTE}`, `debit:${IMPORTE}`],
    "el pago repetido deja un solo par de asientos",
  );

  // La otra mitad: dos pagos distintos tienen que ser dos transacciones. Sin
  // esto, tratar todo como duplicado aprobaria las comprobaciones anteriores y
  // perderia pagos, que es peor que contarlos dos veces.
  const otro = `idem-${crypto.randomBytes(6).toString("hex")}`;
  const tercera = await captura(client, otro);
  comparar(tercera, { recorded: true, idempotent: false }, "un pago distinto si se registra");

  const distintas = await client.query(
    "SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = ANY($1)",
    [[`marketplace-capture-${pago}`, `marketplace-capture-${otro}`]],
  );
  comparar(distintas.rows[0].n, 2, "dos pagos distintos son dos transacciones");

  // Adelanta el chequeo diferido: de paso queda probado que la captura escribe
  // asientos que cuadran, no solo que no los duplica.
  let desbalance = null;
  await client
    .query("SET CONSTRAINTS ledger_entries_balance IMMEDIATE")
    .catch((error) => (desbalance = error));
  if (desbalance) {
    fallos++;
    console.error("FALLA - la captura escribio asientos que no cuadran");
    console.error(`        ${desbalance.message}`);
  } else {
    ok("los asientos de la captura cuadran");
  }
} finally {
  await client.query("ROLLBACK").catch(() => {});
  client.release();
  await pool.end();
}

if (fallos) {
  console.error(`\n${fallos} comprobacion(es) de idempotencia fallaron`);
  process.exit(1);
}
console.log("\nok - un pago repetido no genera un segundo asiento");
