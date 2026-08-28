// La partida doble se verifica, no se confía (ticket PAY-001).
//
// `ledger_entries` es un libro de partida doble: cada transacción agrupa
// débitos y créditos que tienen que sumar lo mismo. Hasta la migración 118 nada
// lo obligaba. La propiedad que hace que un ledger sea un ledger dependía de
// que nueve módulos de repositorio —dieciocho puntos de escritura— acertaran
// cada uno por su cuenta.
//
// Esta puerta hace tres cosas, y las tres hacen falta:
//
// 1. **Barre lo que ya está escrito.** El trigger sólo mira lo que se escribe
//    de ahora en más; un desbalance anterior seguiría ahí, callado.
// 2. **Confirma que el trigger existe y es diferido.** Si alguien lo borra o lo
//    vuelve inmediato, esto lo dice. Inmediato no es «más estricto»: rompería
//    la reversión proporcional, que inserta N débitos antes de su crédito.
// 3. **Prueba que el trigger corta de verdad, en cada corrida.** Un constraint
//    que no se ejerce es una afirmación, no una garantía. Se intenta escribir
//    una transacción torcida y se exige que la base la rechace.
//
// El punto 3 tiene sus dos mitades a propósito: también se comprueba que una
// transacción **bien** formada pasa. Un constraint que rechaza todo aprobaría
// la mitad negativa y rompería el producto.
//
// Nada de esto deja datos: las dos pruebas corren dentro de una transacción que
// termina en ROLLBACK, y el chequeo se adelanta con `SET CONSTRAINTS ...
// IMMEDIATE` en lugar de llegar al commit.
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

// El trigger que se verifica es el de la migracion 003, no el de la 118: la 118
// agrego un duplicado por no haber buscado triggers antes de escribirlo, y la
// 121 lo quita. El original hace lo mismo y ademas exige al menos dos asientos.
const TRIGGER = "ledger_entries_must_balance";
let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const fallo = (etiqueta, detalle) => {
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
};

// La consulta del barrido se define una sola vez y se usa en los dos lugares:
// contra la base real y contra la sonda que la falsea. Tener dos copias probaría
// que la copia funciona, que no es lo que interesa saber.
const CONSULTA_DESBALANCE = `
  SELECT transaction_id,
         COALESCE(sum(amount_cents) FILTER (WHERE direction = 'debit'), 0) AS debitos,
         COALESCE(sum(amount_cents) FILTER (WHERE direction = 'credit'), 0) AS creditos
  FROM ledger_entries
  GROUP BY transaction_id
  HAVING COALESCE(sum(amount_cents) FILTER (WHERE direction = 'debit'), 0)
       <> COALESCE(sum(amount_cents) FILTER (WHERE direction = 'credit'), 0)
  ORDER BY transaction_id
`;

// 1. Lo que ya está escrito cuadra.
//
// En CI la base viene recién migrada y esto barre cero transacciones. La
// comprobación 5 existe justamente por eso: sin ella, este ok sería un barrido
// que nunca encontró nada y del que nadie probó que sepa encontrar.
const desbalanceadas = await pool.query(CONSULTA_DESBALANCE);
const total = await pool.query("SELECT count(DISTINCT transaction_id)::int n FROM ledger_entries");
if (desbalanceadas.rowCount) {
  fallo(`${desbalanceadas.rowCount} transacción(es) contable(s) no cuadran`);
  for (const fila of desbalanceadas.rows.slice(0, 20)) {
    console.error(
      `        ${fila.transaction_id}: débitos ${fila.debitos}, créditos ${fila.creditos}`,
    );
  }
} else {
  ok(`las ${total.rows[0].n} transacciones contables existentes cuadran`);
}

// 2. El trigger está, y está diferido.
//
// Vale la pena decir por qué esta comprobación existe: el trigger vivía en la
// migración 003 desde el principio y **nadie verificaba que siguiera vivo**.
// Tanto es así que al escribir la 118 se lo dio por inexistente y se agregó un
// duplicado. Un trigger que nadie comprueba es una afirmación.
const trigger = await pool.query(
  `SELECT tgdeferrable, tginitdeferred, tgtype
   FROM pg_trigger WHERE tgname = $1 AND tgrelid = 'ledger_entries'::regclass`,
  [TRIGGER],
);
if (!trigger.rowCount) {
  fallo(`no existe el trigger ${TRIGGER} sobre ledger_entries`, "¿se revirtió la migración 118?");
} else {
  const { tgdeferrable, tginitdeferred } = trigger.rows[0];
  if (!tgdeferrable || !tginitdeferred) {
    fallo(
      `${TRIGGER} existe pero no es DEFERRABLE INITIALLY DEFERRED`,
      "inmediato rompe la reversión proporcional, que inserta N débitos antes de su crédito",
    );
  } else {
    ok(`${TRIGGER} existe y es diferido`);
  }
}

// 3. El trigger corta de verdad — y sólo lo torcido.
async function probar({ etiqueta, creditoCents, esperaRechazo }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cuenta = (
      await client.query(
        `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
         VALUES('contract_probe', gen_random_uuid(), 'ARS', 'probe') RETURNING id`,
      )
    ).rows[0].id;
    const transaccion = (
      await client.query(
        `INSERT INTO ledger_transactions(idempotency_key, kind, description)
         VALUES('ledger-balance-contract-' || gen_random_uuid(), 'adjustment', 'sonda de contrato')
         RETURNING id`,
      )
    ).rows[0].id;
    await client.query(
      `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents, reference_type)
       VALUES($1, $2, 'debit', 1000, 'probe')`,
      [transaccion, cuenta],
    );
    if (creditoCents > 0) {
      await client.query(
        `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents, reference_type)
         VALUES($1, $2, 'credit', $3, 'probe')`,
        [transaccion, cuenta, creditoCents],
      );
    }
    // Adelanta el chequeo diferido sin llegar al commit.
    let rechazada = null;
    try {
      await client.query(`SET CONSTRAINTS ${TRIGGER} IMMEDIATE`);
    } catch (error) {
      rechazada = error;
    }
    if (esperaRechazo && !rechazada) {
      fallo(etiqueta, "la base aceptó una transacción que no cuadra: el trigger no está cortando");
    } else if (!esperaRechazo && rechazada) {
      fallo(etiqueta, `la base rechazó una transacción correcta: ${rechazada.message}`);
    } else {
      ok(etiqueta);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

await probar({
  etiqueta: "la base rechaza un débito sin su crédito",
  creditoCents: 0,
  esperaRechazo: true,
});
await probar({
  etiqueta: "la base rechaza un crédito que no iguala al débito",
  creditoCents: 999,
  esperaRechazo: true,
});
await probar({
  etiqueta: "la base acepta una transacción que cuadra",
  creditoCents: 1000,
  esperaRechazo: false,
});

// 4. La idempotencia sigue siendo estructural.
//
// `ledger_transactions.idempotency_key` es UNIQUE, y de ahi sale que un pago
// repetido no genere un segundo asiento: los repositorios insertan con esa
// clave y tratan el conflicto como «ya estaba». Si alguien quitara el UNIQUE
// nada fallaria a la vista —los inserts pasarian— y la idempotencia moriria en
// silencio, que es la peor forma de morir para una garantia de dinero.
const unica = await pool.query(`
  SELECT 1
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'ledger_transactions'::regclass
    AND c.contype IN ('u', 'p')
    AND array_length(c.conkey, 1) = 1
    AND a.attname = 'idempotency_key'
`);
if (unica.rowCount) {
  ok("ledger_transactions.idempotency_key sigue siendo unica");
} else {
  fallo(
    "ledger_transactions.idempotency_key perdio su restriccion de unicidad",
    "sin ella un pago repetido genera un segundo asiento y nada lo delata",
  );
}

// 5. El barrido sabe encontrar un desbalance.
//
// Sin esto, la comprobacion 1 en CI es una consulta que devuelve cero filas
// sobre una tabla vacia: pasaria igual con un HAVING mal escrito, y seguiria
// pasando para siempre. Se escriben asientos torcidos sin llegar al commit —el
// trigger es diferido, todavia no miro— y se le pide al barrido que los vea.
const clienteBarrido = await pool.connect();
try {
  await clienteBarrido.query("BEGIN");
  const cuenta = (
    await clienteBarrido.query(
      `INSERT INTO ledger_accounts(owner_type, owner_id, currency, account_type)
       VALUES('contract_probe', gen_random_uuid(), 'ARS', 'probe') RETURNING id`,
    )
  ).rows[0].id;
  const transaccion = (
    await clienteBarrido.query(
      `INSERT INTO ledger_transactions(idempotency_key, kind, description)
       VALUES('ledger-sweep-probe-' || gen_random_uuid(), 'adjustment', 'sonda de barrido')
       RETURNING id`,
    )
  ).rows[0].id;
  await clienteBarrido.query(
    `INSERT INTO ledger_entries(transaction_id, account_id, direction, amount_cents, reference_type)
     VALUES($1, $2, 'debit', 1000, 'probe'), ($1, $2, 'credit', 400, 'probe')`,
    [transaccion, cuenta],
  );
  const visto = await clienteBarrido.query(CONSULTA_DESBALANCE);
  const fila = visto.rows.find((r) => r.transaction_id === transaccion);
  if (!fila) {
    fallo(
      "el barrido no vio un desbalance de 600 centavos",
      "la comprobacion 1 no prueba nada: revisa el HAVING de CONSULTA_DESBALANCE",
    );
  } else if (Number(fila.debitos) !== 1000 || Number(fila.creditos) !== 400) {
    fallo(
      "el barrido vio el desbalance pero mal sumado",
      `reporto debitos ${fila.debitos} y creditos ${fila.creditos}, esperaba 1000 y 400`,
    );
  } else {
    ok("el barrido encuentra un desbalance cuando lo hay");
  }
} finally {
  await clienteBarrido.query("ROLLBACK").catch(() => {});
  clienteBarrido.release();
}

await pool.end();

if (fallos) {
  console.error(`\n${fallos} comprobación(es) de partida doble fallaron`);
  process.exit(1);
}
console.log("\nok - la partida doble está garantizada por la base, no sólo por el código");
