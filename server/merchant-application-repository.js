// Alta real de comercio (FE-05, OPS-W01), como la de Uber Eats y PedidosYa.
//
// Una persona con cuenta se postula con los datos de su local; operaciones la revisa
// desde una cola y decide: aprobar, pedir cambios o rechazar, siempre con motivo
// cuando no aprueba. **Aprobar es lo único que crea un comercio en todo el
// producto**, y lo hace en una transacción con la solicitud bloqueada: nace el
// comercio, su sucursal principal y recién ahí el rol `merchant`, con su auditoría y
// el aviso a quien se postuló. Si cualquier paso falla no queda nada a medias.
//
// **Lo que nace es lo que se declaró, y nada más.** El comercio arranca cerrado, sin
// horario, sin productos y sin foto: la consola lo guía hasta estar listo para
// vender. Inventar un horario de 9 a 23 o una foto de relleno para que se vea lleno
// es exactamente lo que «todo real, nada falso» prohíbe (FE-04).
import crypto from "node:crypto";

import { MERCHANT_VERTICALS } from "./catalog-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { postgresPool } from "./postgres.js";

export { MERCHANT_VERTICALS };
export const MERCHANT_APPLICATION_STATUSES = ["pending", "needs_changes", "approved", "rejected"];
/** Las dos que todavía esperan algo: revisión o cambios de quien se postuló. */
const ABIERTAS = ["pending", "needs_changes"];
const PAGINA = 25;

const error = (message, status) => Object.assign(new Error(message), { status });
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex").toUpperCase();
const iso = (valor) => (valor ? new Date(valor).toISOString() : null);

/**
 * Dígito verificador del CUIT/CUIL (módulo 11 de AFIP/ARCA).
 *
 * Once dígitos: los diez primeros por los pesos 5,4,3,2,7,6,5,4,3,2; el verificador
 * es 11 menos el resto de dividir la suma por 11, con 11 → 0. Un resto que da 10 no
 * tiene verificador válido: ningún CUIT emitido termina así. Sólo se controla la
 * forma: que el CUIT exista y sea de quien se postula lo confirma operaciones.
 */
export function isValidCuit(valor) {
  const cuit = String(valor || "");
  if (!/^[0-9]{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((total, peso, indice) => total + peso * Number(cuit[indice]), 0);
  const verificador = 11 - (suma % 11);
  if (verificador === 10) return false;
  return (verificador === 11 ? 0 : verificador) === Number(cuit[10]);
}

const SELECCION = `SELECT a.id, a.public_id, a.status, a.business_name, a.legal_name, a.tax_id,
    a.vertical, a.contact_phone, a.address, ST_Y(a.location::geometry) lat,
    ST_X(a.location::geometry) lng, a.notes, a.decision_reason, a.created_at, a.decided_at,
    m.public_id merchant_public_id,
    to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at,
    u.public_id applicant_public_id, u.name applicant_name, u.email applicant_email
  FROM merchant_applications a
  JOIN users u ON u.id = a.applicant_id
  LEFT JOIN merchants m ON m.id = a.merchant_id`;

const vista = (row) => ({
  id: row.public_id,
  status: row.status,
  businessName: row.business_name,
  legalName: row.legal_name,
  taxId: row.tax_id,
  vertical: row.vertical,
  contactPhone: row.contact_phone,
  address: row.address,
  lat: Number(row.lat),
  lng: Number(row.lng),
  notes: row.notes,
  decisionReason: row.decision_reason,
  createdAt: iso(row.created_at),
  decidedAt: iso(row.decided_at),
  merchantId: row.merchant_public_id || null,
});
// Operaciones ve además quién se postuló, para poder contactarla. El email sale de
// la cuenta y no de la solicitud: es el que la persona verificó.
const vistaAdmin = (row) => ({
  ...vista(row),
  applicant: {
    id: row.applicant_public_id,
    name: row.applicant_name,
    email: String(row.applicant_email),
  },
});

const enTransaccion = async (trabajo) => {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (failure) {
    await client.query("ROLLBACK");
    // Dos envíos simultáneos de la misma persona pasan el control previo y chocan
    // con el índice de una solicitud abierta: es un 409, no un 500.
    if (failure?.code === "23505" && failure.constraint === "merchant_applications_one_open")
      throw error("Ya tenés una solicitud en curso", 409);
    throw failure;
  } finally {
    client.release();
  }
};

/**
 * Una persona activa, bloqueada `FOR SHARE`: choca con el borrado de la cuenta, que
 * la bloquea `FOR UPDATE`, así no se postula ni se aprueba una cuenta que se está
 * eliminando (mismo criterio que las tarjetas de regalo, PAG-04).
 */
const personaActiva = async (client, where, valor) =>
  (
    await client.query(
      `SELECT id, public_id, name FROM users WHERE ${where}=$1 AND status='active' FOR SHARE`,
      [valor],
    )
  ).rows[0];

const tieneComercio = async (client, userId) =>
  Boolean(
    (await client.query("SELECT 1 FROM merchants WHERE owner_id=$1 LIMIT 1", [userId])).rows[0],
  );

const filaPorId = async (client, id) =>
  (await client.query(`${SELECCION} WHERE a.id=$1`, [id])).rows[0];

/** Una solicitud nueva. Los datos llegan validados por el router. */
export async function submitMerchantApplication({ userPublicId, input }) {
  if (!isValidCuit(input.taxId)) throw error("El CUIT no es válido: revisá los 11 números", 400);
  return enTransaccion(async (client) => {
    const persona = await personaActiva(client, "public_id", userPublicId);
    if (!persona) throw error("Usuario no encontrado", 404);
    // Una a la vez por persona, tomado antes de mirar: sin esto, dos envíos
    // simultáneos ven los dos «no tiene comercio» y la carrera la decide el índice.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('merchant_application:' || $1::text, 0))",
      [persona.id],
    );
    if (await tieneComercio(client, persona.id))
      throw error("Ya tenés un comercio en Flash: gestionalo desde la consola", 409);
    const abierta = (
      await client.query(
        "SELECT 1 FROM merchant_applications WHERE applicant_id=$1 AND status = ANY($2) LIMIT 1",
        [persona.id, ABIERTAS],
      )
    ).rows[0];
    if (abierta) throw error("Ya tenés una solicitud en curso", 409);
    const creada = (
      await client.query(
        `INSERT INTO merchant_applications(public_id, applicant_id, business_name, legal_name, tax_id,
           vertical, contact_phone, address, location, notes)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11)
         RETURNING id`,
        [
          `MAP-${hex(5)}`,
          persona.id,
          input.businessName,
          input.legalName,
          input.taxId,
          input.vertical,
          input.contactPhone,
          input.address,
          input.lng,
          input.lat,
          input.notes || null,
        ],
      )
    ).rows[0];
    return vista(await filaPorId(client, creada.id));
  });
}

/** Las solicitudes de la persona, la más nueva primero, con el motivo si lo hay. */
export async function listMyMerchantApplications(userPublicId) {
  const filas = await postgresPool.query(
    `${SELECCION} WHERE u.public_id=$1 ORDER BY a.created_at DESC, a.id DESC`,
    [userPublicId],
  );
  return filas.rows.map(vista);
}

/** El cursor viaja en base64url y se valida al desarmarlo: uno con otra forma es 400. */
export function parseApplicationCursor(valor) {
  if (!valor) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(valor), "base64url").toString("utf8"));
    if (
      typeof cursor.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(cursor.id) ||
      typeof cursor.createdAt !== "string" ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(cursor.createdAt)
    )
      return false;
    return cursor;
  } catch {
    return false;
  }
}

/**
 * La cola de operaciones, de a 25, paginada por cursor sobre `(created_at, id)`.
 *
 * **Las abiertas, la más vieja primero**: es la que más espera, y una cola que
 * muestra lo último que entró deja al fondo justo lo que hay que atender. Las
 * resueltas, la más nueva primero: ahí se busca lo que se decidió hace poco.
 */
export async function listAdminMerchantApplications({ status, cursor = null }) {
  const ascendente = ABIERTAS.includes(status);
  const comparacion = ascendente ? ">" : "<";
  const orden = ascendente ? "ASC" : "DESC";
  const filas = (
    await postgresPool.query(
      `${SELECCION}
       WHERE a.status=$1
         AND ($2::timestamptz IS NULL OR (a.created_at, a.id) ${comparacion} ($2::timestamptz, $3::uuid))
       ORDER BY a.created_at ${orden}, a.id ${orden}
       LIMIT $4`,
      [status, cursor?.createdAt || null, cursor?.id || null, PAGINA + 1],
    )
  ).rows;
  const pagina = filas.slice(0, PAGINA);
  const ultima = pagina.at(-1);
  return {
    applications: pagina.map(vistaAdmin),
    nextCursor:
      filas.length > PAGINA && ultima
        ? Buffer.from(
            JSON.stringify({ createdAt: ultima.cursor_created_at, id: ultima.id }),
          ).toString("base64url")
        : null,
  };
}

// Lo que lee quien se postuló, en la app y en el correo de avisos. El motivo va
// tal cual lo escribió operaciones: es lo que le dice qué hacer.
const avisos = {
  approved: (solicitud) => ({
    title: "¡Tu comercio ya está en Flash!",
    body: `Aprobamos ${solicitud.business_name}. Entrá a la consola del comercio para cargar el horario y tus productos.`,
  }),
  needs_changes: (solicitud, motivo) => ({
    title: "Tu solicitud necesita cambios",
    body: `Revisamos ${solicitud.business_name}: ${motivo}`,
  }),
  rejected: (solicitud, motivo) => ({
    title: "No pudimos aprobar tu solicitud",
    body: `${solicitud.business_name}: ${motivo}`,
  }),
};
const estadoDe = { approve: "approved", needs_changes: "needs_changes", reject: "rejected" };

/**
 * Crea el comercio y su sucursal principal desde la solicitud bloqueada.
 *
 * Arranca **cerrado** (`open=false`) y sin horario: abrir es una decisión del local
 * cuando ya cargó lo que vende. La sucursal se llama `branch_<comercio>` porque así
 * la busca `scripts/db-seed-derived.mjs`: con otro nombre, volver a correr esa
 * derivación le crearía una segunda sucursal principal y chocaría con el índice.
 *
 * La ciudad sale de la ubicación declarada. Fuera de toda ciudad habilitada no se
 * aprueba: un comercio ahí no lo vería nadie y nadie lo podría repartir.
 */
async function crearComercio(client, solicitud) {
  const persona = await personaActiva(client, "id", solicitud.applicant_id);
  if (!persona) throw error("La cuenta que se postuló ya no está activa", 409);
  if (await tieneComercio(client, persona.id))
    throw error("Quien se postuló ya tiene un comercio en Flash", 409);
  const ciudad = (
    await client.query(
      `SELECT c.id FROM cities c, merchant_applications a
       WHERE a.id=$1 AND ST_Covers(c.boundary, a.location)
       ORDER BY c.created_at LIMIT 1`,
      [solicitud.id],
    )
  ).rows[0];
  if (!ciudad) throw error("La dirección queda fuera de las ciudades donde opera Flash", 409);
  const merchantPublicId = `MER-${hex(5)}`;
  const comercio = (
    await client.query(
      `INSERT INTO merchants(public_id, owner_id, name, vertical, status, address, location, open, city_id)
       SELECT $1, a.applicant_id, a.business_name, a.vertical, 'active', a.address, a.location, false, $3
       FROM merchant_applications a WHERE a.id=$2
       RETURNING id`,
      [merchantPublicId, solicitud.id, ciudad.id],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO merchant_branches(public_id, merchant_id, name, address, location, status, open, is_primary)
     SELECT $1, $2, a.business_name || ' · Principal', a.address, a.location, 'active', false, true
     FROM merchant_applications a WHERE a.id=$3`,
    [`branch_${merchantPublicId}`, comercio.id, solicitud.id],
  );
  // Recién con el comercio creado: un rol `merchant` sin comercio abre una consola
  // vacía que no puede hacer nada.
  await client.query(
    "INSERT INTO user_roles(user_id, role) VALUES($1, 'merchant') ON CONFLICT DO NOTHING",
    [persona.id],
  );
  return comercio.id;
}

/**
 * Aprobar, pedir cambios o rechazar una solicitud abierta.
 *
 * Todo en una transacción con la solicitud `FOR UPDATE`: dos operadores que
 * aprueban a la vez no crean dos comercios; el segundo espera, encuentra la
 * solicitud ya aprobada y recibe 409. La auditoría y el aviso van adentro de la
 * misma transacción: una aprobación sin rastro, o un rastro de algo que se deshizo,
 * es peor que un error.
 */
export async function decideMerchantApplication({
  applicationPublicId,
  decision,
  reason = null,
  actorPublicId,
  actorRoles = [],
  requestId = null,
}) {
  return enTransaccion(async (client) => {
    const solicitud = (
      await client.query(
        `SELECT id, public_id, status, applicant_id, business_name
         FROM merchant_applications WHERE public_id=$1 FOR UPDATE`,
        [applicationPublicId],
      )
    ).rows[0];
    if (!solicitud) throw error("Solicitud no encontrada", 404);
    if (!ABIERTAS.includes(solicitud.status)) throw error("Esta solicitud ya fue resuelta", 409);
    const actor = (await client.query("SELECT id FROM users WHERE public_id=$1", [actorPublicId]))
      .rows[0];
    // Mismo criterio que `recordPostgresAudit`: una decisión sin actor no se anota
    // en silencio, falla.
    if (!actor) throw new Error(`No se registró la decisión: el actor ${actorPublicId} no existe`);
    const status = estadoDe[decision];
    const merchantId = decision === "approve" ? await crearComercio(client, solicitud) : null;
    await client.query(
      `UPDATE merchant_applications
       SET status=$2, decision_reason=$3, decided_by=$4, decided_at=now(), updated_at=now(),
           merchant_id=COALESCE($5, merchant_id)
       WHERE id=$1`,
      [solicitud.id, status, reason || null, actor.id, merchantId],
    );
    const fila = await filaPorId(client, solicitud.id);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,request_id,before_data,after_data)
       VALUES($1,$2::user_role[],$3,'merchant_application',$4,$5,$6,$7)`,
      [
        actor.id,
        actorRoles,
        `merchant_application.${status}`,
        solicitud.public_id,
        requestId,
        { status: solicitud.status },
        { status, reason: reason || null, merchantId: fila.merchant_public_id || null },
      ],
    );
    // El aviso va dentro de la app (`in_app`): es la respuesta a algo que la persona
    // pidió, y la tiene que encontrar aunque no tenga un teléfono registrado.
    await enqueueNotificationForInternalUser(client, {
      userId: solicitud.applicant_id,
      channel: "in_app",
      template: "merchant_application",
      payload: {
        kind: "merchant_application",
        applicationId: solicitud.public_id,
        status,
        merchantId: fila.merchant_public_id || null,
        ...avisos[status](solicitud, reason),
      },
      deduplicationKey: `merchant_application:${solicitud.public_id}:${status}:${Date.now()}`,
    });
    return {
      application: vistaAdmin(fila),
      merchant: fila.merchant_public_id
        ? { id: fila.merchant_public_id, name: fila.business_name, status: "active", open: false }
        : undefined,
    };
  });
}
