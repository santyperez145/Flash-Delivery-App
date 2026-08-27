// La audiencia realtime, verificada contra PostgreSQL (ticket SEC-001).
//
// `test:realtime-audience` es estático: comprueba `classifyRealtimeAudience`,
// que es una función pura, y que ninguna publicación del servidor difunda a
// todos los roles por omisión. Es una buena puerta y corre en cada PR sin base
// de datos.
//
// Lo que no puede tocar es la mitad donde viviría una fuga de verdad: los
// resolutores de propiedad. `ownerOfDriver`, `ownerOfMerchant`,
// `ownerOfSupportTicket`, `ownerOfAddress` y `participantsOfJob` son consultas
// SQL con JOINs, y un JOIN mal escrito devuelve al usuario equivocado sin que
// ninguna comprobación estática se entere. La clasificación puede estar
// perfecta y el evento llegar igual a quien no debe.
//
// Por eso esto no verifica `resolveAudience` en aislamiento: publica de verdad
// y después le pregunta al **replay** qué recibiría cada usuario, que es la
// consulta que decide la entrega. La propiedad que interesa no es «el arreglo
// guardado tiene los ids correctos» sino «este usuario no recibe este evento».
//
// **Cada caso tiene sus dos mitades.** Se comprueba que el dueño reciba y que un
// tercero no. Sin la primera, una implementación que no entregue nada a nadie
// pasaría entera y rompería el producto; sin la segunda, no se estaría probando
// nada de lo que el ticket vino a arreglar.
import crypto from "node:crypto";
import pg from "pg";
import {
  persistPostgresRealtimeEvent,
  getPostgresRealtimeCursor,
  getPostgresRealtimeReplay,
} from "../server/realtime-repository.js";
import { postgresPool } from "../server/postgres.js";

const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ssl: false,
});

const marca = crypto.randomBytes(4).toString("hex");
const publicados = [];

let fallos = 0;
const ok = (etiqueta) => console.log(`ok - ${etiqueta}`);
const fallo = (etiqueta, detalle) => {
  fallos++;
  console.error(`FALLA - ${etiqueta}`);
  if (detalle) console.error(`        ${detalle}`);
};

const unaFila = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

try {
  // --- Fixture ---------------------------------------------------------------
  // Se toma de los datos ya sembrados en lugar de crear un mundo aparte: lo que
  // interesa probar son los JOINs contra las tablas reales.
  const trabajo = await unaFila(`
    SELECT j.public_id job_id,
           cliente.public_id cliente,
           comercio.public_id comercio, duenio.public_id duenio,
           conductor.public_id conductor, conductor_usuario.public_id conductor_usuario
    FROM jobs j
    JOIN users cliente ON cliente.id = j.customer_id
    JOIN merchants comercio ON comercio.id = j.merchant_id
    JOIN users duenio ON duenio.id = comercio.owner_id
    JOIN drivers conductor ON conductor.id = j.driver_id
    JOIN users conductor_usuario ON conductor_usuario.id = conductor.user_id
    ORDER BY j.created_at DESC LIMIT 1
  `);
  if (!trabajo) throw new Error("No hay un servicio con cliente, comercio y conductor sembrado");

  const ajeno = await unaFila(
    // Los roles viven en `user_roles`, no en una columna de `users`. Se excluye
    // a quien tenga `admin` porque ese rol recibe todo por diseño y no sirve de
    // control negativo.
    `SELECT u.public_id FROM users u
     WHERE u.public_id <> ALL($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin'
       )
     LIMIT 1`,
    [[trabajo.cliente, trabajo.duenio, trabajo.conductor_usuario]],
  );
  if (!ajeno) throw new Error("No hay un usuario ajeno sin rol admin para el control negativo");

  // El ticket y la dirección se eligen con dueño distinto del usuario ajeno: si
  // coincidieran, el control negativo fallaría por casualidad y no por una fuga.
  const ticket = await unaFila(
    `SELECT t.public_id, u.public_id duenio FROM support_tickets t
     JOIN users u ON u.id = t.user_id WHERE u.public_id <> $1 LIMIT 1`,
    [ajeno.public_id],
  );
  const direccion = await unaFila(
    `SELECT a.id, u.public_id duenio FROM addresses a
     JOIN users u ON u.id = a.user_id WHERE u.public_id <> $1 LIMIT 1`,
    [ajeno.public_id],
  );

  // --- Utilidad --------------------------------------------------------------
  // Publica un evento y devuelve quién lo recibiría. El corte del replay se toma
  // justo antes de publicar, así la ventana contiene sólo este evento.
  const publicar = async ({ entityType, entityId, type = `contract.${marca}` }) => {
    const corte = Number(await getPostgresRealtimeCursor());
    const evento = await persistPostgresRealtimeEvent({
      type,
      entityType,
      entityId,
      action: "updated",
    });
    publicados.push(evento.id);
    const recibe = async (userPublicId, roles) =>
      (await getPostgresRealtimeReplay({ after: corte, userPublicId, roles })).some(
        (fila) => fila.id === evento.id,
      );
    return { evento, recibe };
  };

  const comprobar = async ({ etiqueta, entityType, entityId, reciben, noReciben }) => {
    const { recibe } = await publicar({ entityType, entityId });
    for (const [quien, id] of reciben) {
      if (await recibe(id, ["customer", "merchant", "driver"])) {
        ok(`${etiqueta}: ${quien} lo recibe`);
      } else {
        fallo(`${etiqueta}: ${quien} NO lo recibe`, "la audiencia quedó demasiado cerrada");
      }
    }
    for (const [quien, id] of noReciben) {
      if (await recibe(id, ["customer", "merchant", "driver"])) {
        fallo(`${etiqueta}: ${quien} lo recibe y no debería`, "fuga de audiencia");
      } else {
        ok(`${etiqueta}: ${quien} no lo recibe`);
      }
    }
    // Operaciones siempre. Un default-deny que también le cierre la puerta a
    // quien tiene que diagnosticar convierte cada incidente en una excavación.
    if (await recibe(ajeno.public_id, ["admin"])) {
      ok(`${etiqueta}: operaciones lo recibe`);
    } else {
      fallo(`${etiqueta}: operaciones NO lo recibe`);
    }
  };

  // --- Entidades con participantes ------------------------------------------
  await comprobar({
    etiqueta: "evento de pedido",
    entityType: "order",
    entityId: trabajo.job_id,
    reciben: [
      ["el cliente", trabajo.cliente],
      ["el dueño del comercio", trabajo.duenio],
      ["el conductor", trabajo.conductor_usuario],
    ],
    noReciben: [["un usuario ajeno", ajeno.public_id]],
  });

  await comprobar({
    etiqueta: "evento de conductor",
    entityType: "driver",
    entityId: trabajo.conductor,
    reciben: [["el conductor", trabajo.conductor_usuario]],
    noReciben: [
      ["el cliente del servicio", trabajo.cliente],
      ["un usuario ajeno", ajeno.public_id],
    ],
  });

  await comprobar({
    etiqueta: "evento de comercio",
    entityType: "restaurant",
    entityId: trabajo.comercio,
    reciben: [["el dueño", trabajo.duenio]],
    noReciben: [
      ["el cliente del servicio", trabajo.cliente],
      ["un usuario ajeno", ajeno.public_id],
    ],
  });

  if (ticket) {
    await comprobar({
      etiqueta: "evento de ticket de soporte",
      entityType: "support_ticket",
      entityId: ticket.public_id,
      reciben: [["quien abrió el ticket", ticket.duenio]],
      noReciben: [["un usuario ajeno", ajeno.public_id]],
    });
  } else {
    console.log("nota - no hay tickets de soporte sembrados: ese caso no se ejercitó");
  }

  if (direccion) {
    await comprobar({
      etiqueta: "evento de dirección",
      entityType: "address",
      entityId: direccion.id,
      reciben: [["el dueño de la dirección", direccion.duenio]],
      noReciben: [["un usuario ajeno", ajeno.public_id]],
    });
  } else {
    console.log("nota - no hay direcciones sembradas: ese caso no se ejercitó");
  }

  // --- Los tres caminos que tienen que cerrarse ------------------------------
  const cerrados = [
    {
      etiqueta: "entityType inventado",
      entityType: `inventado_${marca}`,
      entityId: trabajo.job_id,
      porque: "un tipo no contemplado no puede abrir la audiencia",
    },
    {
      etiqueta: "evento sin entidad",
      entityType: null,
      entityId: null,
      porque: "sin entidad no hay participantes que resolver",
    },
    {
      // `ownerOfAddress` descarta lo que no sea uuid antes de consultar. Si esa
      // guarda desapareciera, un identificador basura llegaría a la consulta.
      etiqueta: "dirección con identificador mal formado",
      entityType: "address",
      entityId: "no-es-un-uuid",
      porque: "un identificador basura no puede abrir la audiencia",
    },
  ];

  for (const caso of cerrados) {
    const { recibe } = await publicar({ entityType: caso.entityType, entityId: caso.entityId });
    const filtrados = [];
    for (const [quien, id] of [
      ["el cliente", trabajo.cliente],
      ["el dueño del comercio", trabajo.duenio],
      ["el conductor", trabajo.conductor_usuario],
      ["un usuario ajeno", ajeno.public_id],
    ]) {
      if (await recibe(id, ["customer", "merchant", "driver"])) filtrados.push(quien);
    }
    if (filtrados.length) {
      fallo(`${caso.etiqueta}: llegó a ${filtrados.join(", ")}`, caso.porque);
    } else {
      ok(`${caso.etiqueta}: no llega a ningún cliente, comercio ni conductor`);
    }
    if (await recibe(ajeno.public_id, ["admin"])) {
      ok(`${caso.etiqueta}: sólo operaciones lo recibe`);
    } else {
      fallo(
        `${caso.etiqueta}: no llegó ni a operaciones`,
        "un evento mal clasificado que además se pierde no se puede diagnosticar",
      );
    }
  }
} finally {
  if (publicados.length) {
    await pool
      .query("DELETE FROM realtime_events WHERE public_id = ANY($1)", [publicados])
      .catch(() => {});
  }
  await pool.end();
  await postgresPool.end().catch(() => {});
}

if (fallos) {
  console.error(`\n${fallos} comprobacion(es) de audiencia en runtime fallaron`);
  process.exit(1);
}
console.log(
  "\nok - la audiencia resuelta contra PostgreSQL entrega a quien debe, y sólo a quien debe",
);
