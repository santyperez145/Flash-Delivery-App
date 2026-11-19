// Perfil familiar (PAG-05), como el de Uber.
//
// Quien organiza invita por email a otras cuentas Flash; cada miembro que acepta paga
// sus viajes, envíos y pedidos con «Perfil familiar», y el cobro sale de la Flash
// Wallet de quien organiza. Quien organiza le pone a cada miembro un tope por mes, o
// ninguno, y recibe un aviso con cada cobro. El miembro nunca ve el saldo de quien
// organiza.
//
// **El dinero.** El cobro se asienta como cualquier pago con Wallet, pero de la
// billetera de quien organiza: `payment_intents.customer_id` es quien pagó y
// `family_member_id` la membresía que lo usó (migración 147). Todos los reintegros
// vuelven a `payment_intents.customer_id`.
//
// **El tope.** Se controla en la misma transacción del cobro, con la membresía
// bloqueada: dos pedidos simultáneos del mismo miembro no pasan los dos. Lo gastado es
// la suma de lo capturado en el mes (hora de Argentina) neto de reintegros, porque
// cada reintegro baja `captured_amount_cents`.
import crypto from "node:crypto";

import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import { pesos } from "./money.js";
import { postgresPool } from "./postgres.js";

/** La etiqueta del medio de pago en pedidos, viajes y envíos. */
export const FAMILY_LABEL = "Perfil familiar";
/** Hasta diez personas por perfil contando a quien organiza, como en Uber. */
export const FAMILY_MAX_MEMBERS = 9;

const publicIdPerfil = () => `FAM-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const publicIdMiembro = () => `FMB-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const primerNombre = (nombre) => String(nombre || "").split(" ")[0] || "Alguien";
const importe = (cents) => `$${pesos(cents).toLocaleString("es-AR")}`;
const error = (message, status) => Object.assign(new Error(message), { status });
const centavos = (pesosEnteros) =>
  pesosEnteros === null || pesosEnteros === undefined
    ? null
    : Math.round(Number(pesosEnteros) * 100);

/** Lo usado en el mes calendario de Argentina por una membresía, neto de reintegros. */
const INICIO_DEL_MES = `(date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
  AT TIME ZONE 'America/Argentina/Buenos_Aires')`;
// Lo capturado sigue en el cobro aunque vuelva una propina: la del checkout de un
// pedido que se completó sin repartidor (vuelve a quien pagó en la liquidación) y el
// ajuste aprobado de una propina. Se restan las dos, sólo las que pagó quien organiza.
const GASTADO_EN_EL_MES = `SELECT COALESCE(sum(p.captured_amount_cents
    - COALESCE((SELECT sum(t.amount_cents) FROM service_tips t
                 WHERE t.job_id=p.job_id AND t.customer_id=p.customer_id AND t.status='refunded'),0)
    - COALESCE((SELECT sum(a.amount_cents) FROM service_tip_adjustments a JOIN service_tips t ON t.id=a.tip_id
                 WHERE t.job_id=p.job_id AND t.customer_id=p.customer_id AND a.status='approved'),0)
  ),0)::bigint
  FROM payment_intents p
  WHERE p.family_member_id = fm.id AND p.status IN ('captured','partially_refunded')
    AND p.created_at >= ${INICIO_DEL_MES}`;

/**
 * Una persona a la vez: organizar y sumarse se excluyen, y dos aceptaciones simultáneas
 * de la misma persona pasaban los controles y chocaban con el índice único (500).
 * Un bloqueo consultivo por persona, tomado primero y uno solo por transacción: no
 * se cruza con los bloqueos de filas, así que no arma ciclos con ellos.
 */
const unaPorPersona = (client, userId) =>
  client.query("SELECT pg_advisory_xact_lock(hashtextextended('family:' || $1::text, 0))", [
    userId,
  ]);

/** Un choque con el índice de una membresía activa por persona es un 409, no un 500. */
const yaEsMiembro = (failure) =>
  failure?.code === "23505" && String(failure.constraint) === "family_members_one_active"
    ? error("Ya sos parte de otro perfil familiar: dejalo antes de sumarte", 409)
    : failure;

const enTransaccion = async (trabajo) => {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (failure) {
    await client.query("ROLLBACK");
    throw yaEsMiembro(failure);
  } finally {
    client.release();
  }
};

// `FOR SHARE`: choca con el borrado de la cuenta, que la bloquea con `FOR UPDATE`
// (mismo criterio que las tarjetas de regalo, PAG-04).
const cliente = async (client, userPublicId) => {
  const user = (
    await client.query(
      `SELECT u.id,u.name,u.email FROM users u
       WHERE u.public_id=$1 AND u.status='active'
         AND EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id=u.id AND r.role='customer')
       FOR SHARE OF u`,
      [userPublicId],
    )
  ).rows[0];
  if (!user) throw error("Usuario no encontrado", 404);
  return user;
};

const miembroVista = (row, { conEmail }) => ({
  id: row.public_id,
  name: row.member_name ? primerNombre(row.member_name) : null,
  ...(conEmail ? { email: row.invitee_email } : {}),
  status: row.status,
  monthlyLimit: row.monthly_limit_cents === null ? null : pesos(row.monthly_limit_cents),
  spentThisMonth: pesos(row.spent_cents),
});

/**
 * El perfil desde el punto de vista de la persona: si organiza, sus miembros e
 * invitaciones; si es miembro, quién paga, su tope y lo que le queda; y las
 * invitaciones que recibió y todavía puede responder.
 */
export async function getFamilyProfile(userPublicId) {
  const user = (
    await postgresPool.query("SELECT id FROM users WHERE public_id=$1 AND status='active'", [
      userPublicId,
    ])
  ).rows[0];
  if (!user) throw error("Usuario no encontrado", 404);
  const perfil = (
    await postgresPool.query("SELECT id,public_id FROM family_profiles WHERE organizer_id=$1", [
      user.id,
    ])
  ).rows[0];
  const miembros = perfil
    ? (
        await postgresPool.query(
          `SELECT fm.*,u.name member_name,(${GASTADO_EN_EL_MES}) spent_cents
           FROM family_members fm LEFT JOIN users u ON u.id=fm.member_id AND fm.status='active'
           WHERE fm.profile_id=$1 AND fm.status IN ('invited','active')
           ORDER BY fm.status='active' DESC, fm.created_at`,
          [perfil.id],
        )
      ).rows
    : [];
  const membresia = (
    await postgresPool.query(
      `SELECT fm.*,o.name organizer_name,(${GASTADO_EN_EL_MES}) spent_cents
       FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
       JOIN users o ON o.id=p.organizer_id AND o.status='active'
       WHERE fm.member_id=$1 AND fm.status='active'`,
      [user.id],
    )
  ).rows[0];
  const invitaciones = (
    await postgresPool.query(
      `SELECT fm.public_id,fm.monthly_limit_cents,fm.created_at,o.name organizer_name
       FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
       JOIN users o ON o.id=p.organizer_id AND o.status='active'
       WHERE fm.member_id=$1 AND fm.status='invited' ORDER BY fm.created_at DESC`,
      [user.id],
    )
  ).rows;
  const activos = miembros.filter((row) => row.status === "active").length;
  return {
    role: membresia ? "member" : perfil && miembros.length ? "organizer" : "none",
    organizer: perfil
      ? {
          id: perfil.public_id,
          members: miembros.map((row) => miembroVista(row, { conEmail: true })),
          activeMembers: activos,
          maxMembers: FAMILY_MAX_MEMBERS,
        }
      : null,
    membership: membresia
      ? {
          id: membresia.public_id,
          organizerName: primerNombre(membresia.organizer_name),
          monthlyLimit:
            membresia.monthly_limit_cents === null ? null : pesos(membresia.monthly_limit_cents),
          spentThisMonth: pesos(membresia.spent_cents),
          remaining:
            membresia.monthly_limit_cents === null
              ? null
              : pesos(
                  Math.max(
                    0,
                    Number(membresia.monthly_limit_cents) - Number(membresia.spent_cents),
                  ),
                ),
        }
      : null,
    invitations: invitaciones.map((row) => ({
      id: row.public_id,
      organizerName: primerNombre(row.organizer_name),
      monthlyLimit: row.monthly_limit_cents === null ? null : pesos(row.monthly_limit_cents),
      createdAt: row.created_at,
    })),
  };
}

/**
 * Quien organiza invita a otra cuenta por email; el perfil se crea con la primera
 * invitación. Un email que no es de un cliente activo se guarda igual, sin
 * destinatario, y la respuesta es la misma: invitar no dice quién tiene cuenta.
 */
export const inviteFamilyMember = ({ userPublicId, email, monthlyLimit = null }) =>
  enTransaccion(async (client) => {
    const organizador = await cliente(client, userPublicId);
    await unaPorPersona(client, organizador.id);
    const correo = String(email).trim().toLowerCase();
    if (correo === String(organizador.email).toLowerCase())
      throw error("No podés invitarte a tu propio perfil familiar", 400);
    // Una persona paga con un solo perfil a la vez: quien ya es miembro de otro no
    // organiza el suyo hasta dejarlo.
    const yaEsMiembro = (
      await client.query("SELECT 1 FROM family_members WHERE member_id=$1 AND status='active'", [
        organizador.id,
      ])
    ).rows[0];
    if (yaEsMiembro)
      throw error("Sos parte de otro perfil familiar: dejalo antes de armar el tuyo", 409);
    await client.query(
      `INSERT INTO family_profiles(public_id,organizer_id) VALUES($1,$2)
       ON CONFLICT (organizer_id) DO NOTHING`,
      [publicIdPerfil(), organizador.id],
    );
    // Bloquear el perfil ordena las invitaciones simultáneas: el tope de miembros no
    // se pasa por dos invitaciones a la vez.
    const perfil = (
      await client.query("SELECT id FROM family_profiles WHERE organizer_id=$1 FOR UPDATE", [
        organizador.id,
      ])
    ).rows[0];
    const abiertos = Number(
      (
        await client.query(
          "SELECT count(*)::int n FROM family_members WHERE profile_id=$1 AND status IN ('invited','active')",
          [perfil.id],
        )
      ).rows[0].n,
    );
    if (abiertos >= FAMILY_MAX_MEMBERS)
      throw error(
        `Un perfil familiar admite hasta ${FAMILY_MAX_MEMBERS} personas además de vos`,
        409,
      );
    const invitado = (
      await client.query(
        `SELECT u.id FROM users u JOIN user_roles r ON r.user_id=u.id AND r.role='customer'
         WHERE lower(u.email)=$1 AND u.status='active' AND u.id<>$2 LIMIT 1 FOR SHARE OF u`,
        [correo, organizador.id],
      )
    ).rows[0];
    const fila = (
      await client.query(
        `INSERT INTO family_members(public_id,profile_id,member_id,invitee_email,monthly_limit_cents)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT (profile_id, invitee_email) WHERE status IN ('invited','active')
         DO NOTHING RETURNING *`,
        [publicIdMiembro(), perfil.id, invitado?.id ?? null, correo, centavos(monthlyLimit)],
      )
    ).rows[0];
    if (!fila) throw error("Ese email ya está en tu perfil familiar", 409);
    if (invitado)
      await enqueueNotificationForInternalUser(client, {
        userId: invitado.id,
        template: "family_invite",
        payload: {
          title: "Te invitaron a un perfil familiar",
          body: `${primerNombre(organizador.name)} te invitó a pagar tus viajes y pedidos con su perfil familiar.`,
          familyMemberId: fila.public_id,
        },
        deduplicationKey: `family_invite:${fila.public_id}`,
      });
    return miembroVista({ ...fila, member_name: null, spent_cents: 0 }, { conEmail: true });
  });

/** La membresía de un perfil de quien organiza, bloqueada. */
const miembroDelOrganizador = async (client, organizadorId, memberPublicId) => {
  const fila = (
    await client.query(
      `SELECT fm.* FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
       WHERE fm.public_id=$1 AND p.organizer_id=$2 FOR UPDATE OF fm`,
      [memberPublicId, organizadorId],
    )
  ).rows[0];
  if (!fila || !["invited", "active"].includes(fila.status))
    throw error("Miembro no encontrado", 404);
  return fila;
};

/** Quien organiza cambia el tope por mes de un miembro; `null` lo deja sin tope. */
export const setFamilyMemberLimit = ({ userPublicId, memberPublicId, monthlyLimit }) =>
  enTransaccion(async (client) => {
    const organizador = await cliente(client, userPublicId);
    const fila = await miembroDelOrganizador(client, organizador.id, memberPublicId);
    const actualizada = (
      await client.query(
        "UPDATE family_members SET monthly_limit_cents=$2 WHERE id=$1 RETURNING *",
        [fila.id, centavos(monthlyLimit)],
      )
    ).rows[0];
    return {
      id: actualizada.public_id,
      monthlyLimit:
        actualizada.monthly_limit_cents === null ? null : pesos(actualizada.monthly_limit_cents),
    };
  });

/** Quien organiza saca a un miembro o retira una invitación. Desde ese momento no paga con el perfil. */
export const removeFamilyMember = ({ userPublicId, memberPublicId }) =>
  enTransaccion(async (client) => {
    const organizador = await cliente(client, userPublicId);
    const fila = await miembroDelOrganizador(client, organizador.id, memberPublicId);
    await client.query("UPDATE family_members SET status='removed',ended_at=now() WHERE id=$1", [
      fila.id,
    ]);
    if (fila.status === "active")
      await enqueueNotificationForInternalUser(client, {
        userId: fila.member_id,
        template: "family_removed",
        payload: {
          title: "Ya no estás en el perfil familiar",
          body: `${primerNombre(organizador.name)} te sacó de su perfil familiar. Tus próximos pagos salen de tu Wallet.`,
        },
        deduplicationKey: `family_removed:${fila.public_id}`,
      });
    return { id: fila.public_id, status: "removed" };
  });

/** Quien fue invitado acepta o rechaza. Al aceptar, desde el próximo pago puede usar el perfil. */
export const respondFamilyInvitation = ({ userPublicId, memberPublicId, accept }) =>
  enTransaccion(async (client) => {
    const user = await cliente(client, userPublicId);
    await unaPorPersona(client, user.id);
    // Primero la cuenta de quien organiza y después la membresía: el borrado de esa
    // cuenta bloquea su fila y después, con su trigger, las membresías. En el orden
    // inverso, aceptar y borrar se esperaban mutuamente.
    const perfil = (
      await client.query(
        `SELECT p.organizer_id FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
         WHERE fm.public_id=$1`,
        [memberPublicId],
      )
    ).rows[0];
    const organizador = perfil
      ? (
          await client.query("SELECT name FROM users WHERE id=$1 AND status='active' FOR SHARE", [
            perfil.organizer_id,
          ])
        ).rows[0]
      : null;
    const fila = (
      await client.query(
        `SELECT fm.*,p.organizer_id FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
         WHERE fm.public_id=$1 FOR UPDATE OF fm`,
        [memberPublicId],
      )
    ).rows[0];
    // Una invitación para otra cuenta responde como una que no existe.
    if (!fila || fila.member_id !== user.id) throw error("Invitación no encontrada", 404);
    if (fila.status !== "invited") throw error("Esa invitación ya no está vigente", 409);
    if (accept) {
      // Quien organiza tiene que seguir activa: si borró su cuenta, la invitación ya
      // no está vigente (el trigger la cierra), pero esto también cubre la carrera.
      if (!organizador) throw error("Esa invitación ya no está vigente", 409);
      const organiza = (
        await client.query(
          `SELECT 1 FROM family_profiles p JOIN family_members fm ON fm.profile_id=p.id
           WHERE p.organizer_id=$1 AND fm.status IN ('invited','active') LIMIT 1`,
          [user.id],
        )
      ).rows[0];
      if (organiza)
        throw error("Organizás tu propio perfil familiar: cerralo antes de sumarte a otro", 409);
      const otro = (
        await client.query("SELECT 1 FROM family_members WHERE member_id=$1 AND status='active'", [
          user.id,
        ])
      ).rows[0];
      if (otro) throw error("Ya sos parte de otro perfil familiar: dejalo antes de sumarte", 409);
      await client.query(
        "UPDATE family_members SET status='active',responded_at=now() WHERE id=$1",
        [fila.id],
      );
      await enqueueNotificationForInternalUser(client, {
        userId: fila.organizer_id,
        template: "family_member_joined",
        payload: {
          title: "Se sumaron a tu perfil familiar",
          body: `${primerNombre(user.name)} ya puede pagar con tu perfil familiar.`,
          familyMemberId: fila.public_id,
        },
        deduplicationKey: `family_member_joined:${fila.public_id}`,
      });
      return { id: fila.public_id, status: "active" };
    }
    await client.query(
      "UPDATE family_members SET status='declined',responded_at=now() WHERE id=$1",
      [fila.id],
    );
    return { id: fila.public_id, status: "declined" };
  });

/** El miembro deja el perfil. Desde ese momento sus pagos salen de su propia Wallet. */
export const leaveFamilyProfile = ({ userPublicId }) =>
  enTransaccion(async (client) => {
    const user = await cliente(client, userPublicId);
    const fila = (
      await client.query(
        `SELECT fm.*,p.organizer_id FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
         WHERE fm.member_id=$1 AND fm.status='active' FOR UPDATE OF fm`,
        [user.id],
      )
    ).rows[0];
    if (!fila) throw error("No sos parte de un perfil familiar", 404);
    await client.query("UPDATE family_members SET status='left',ended_at=now() WHERE id=$1", [
      fila.id,
    ]);
    await enqueueNotificationForInternalUser(client, {
      userId: fila.organizer_id,
      template: "family_member_left",
      payload: {
        title: "Alguien dejó tu perfil familiar",
        body: `${primerNombre(user.name)} ya no paga con tu perfil familiar.`,
      },
      deduplicationKey: `family_member_left:${fila.public_id}`,
    });
    return { id: fila.public_id, status: "left" };
  });

/**
 * Dentro de la transacción del cobro: quién paga un servicio de `customerId` con
 * «Perfil familiar». Bloquea la membresía (dos cobros del mismo miembro no pasan el
 * tope a la vez) y la cuenta de quien organiza (contra su borrado), y controla el
 * tope. El saldo lo controla el cobro, con la Wallet de quien organiza bloqueada.
 */
export async function resolveFamilyPayer(client, { customerId, amountCents }) {
  const sinPerfil = () =>
    error("No tenés un perfil familiar activo: elegí otro medio de pago", 409);
  // Primero la cuenta de quien organiza (`FOR SHARE`, contra su borrado) y después la
  // membresía: el borrado bloquea la cuenta y después, con su trigger, las
  // membresías. En el orden inverso, cobro y borrado se esperaban mutuamente.
  const vista = (
    await client.query(
      `SELECT p.organizer_id FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
       WHERE fm.member_id=$1 AND fm.status='active'`,
      [customerId],
    )
  ).rows[0];
  if (!vista) throw sinPerfil();
  const organizador = (
    await client.query("SELECT id,name FROM users WHERE id=$1 AND status='active' FOR SHARE", [
      vista.organizer_id,
    ])
  ).rows[0];
  if (!organizador) throw error("El perfil familiar ya no está disponible", 409);
  // Bloqueada, y otra vez controlada: entre la lectura y el bloqueo pudo terminar.
  const fila = (
    await client.query(
      `SELECT fm.id,fm.public_id,fm.monthly_limit_cents,p.organizer_id
       FROM family_members fm JOIN family_profiles p ON p.id=fm.profile_id
       WHERE fm.member_id=$1 AND fm.status='active' FOR UPDATE OF fm`,
      [customerId],
    )
  ).rows[0];
  if (!fila || fila.organizer_id !== organizador.id) throw sinPerfil();
  if (fila.monthly_limit_cents !== null) {
    const gastado = Number(
      (
        await client.query(`SELECT (${GASTADO_EN_EL_MES.replaceAll("fm.id", "$1")}) gastado`, [
          fila.id,
        ])
      ).rows[0].gastado,
    );
    const quedan = Number(fila.monthly_limit_cents) - gastado;
    if (amountCents > quedan)
      throw error(
        `Superás el tope de tu perfil familiar: te quedan ${importe(Math.max(0, quedan))} este mes`,
        402,
      );
  }
  return { organizerId: organizador.id, familyMemberId: fila.id };
}

/** El aviso a quien organiza por cada cobro: es su comprobante, como en Uber. */
export async function notifyFamilyCharge(
  client,
  { organizerId, memberId, familyMemberId, amountCents, description, jobPublicId },
) {
  const miembro = (await client.query("SELECT name FROM users WHERE id=$1", [memberId])).rows[0];
  await enqueueNotificationForInternalUser(client, {
    userId: organizerId,
    template: "family_charge",
    payload: {
      title: "Se usó tu perfil familiar",
      body: `${primerNombre(miembro?.name)} pagó ${description.toLowerCase()} por ${importe(amountCents)} con tu Wallet.`,
      jobId: jobPublicId,
      familyMemberId,
    },
    deduplicationKey: `family_charge:${jobPublicId}`,
  });
}

/**
 * Para la pantalla de pago: si la persona puede pagar con el perfil y cuánto le
 * queda. Nunca el saldo de quien organiza.
 */
export async function getFamilyPaymentOption(userPublicId) {
  const fila = (
    await postgresPool.query(
      `SELECT fm.public_id,fm.monthly_limit_cents,o.name organizer_name,(${GASTADO_EN_EL_MES}) spent_cents
       FROM users u JOIN family_members fm ON fm.member_id=u.id AND fm.status='active'
       JOIN family_profiles p ON p.id=fm.profile_id JOIN users o ON o.id=p.organizer_id AND o.status='active'
       WHERE u.public_id=$1`,
      [userPublicId],
    )
  ).rows[0];
  if (!fila) return null;
  return {
    label: FAMILY_LABEL,
    organizerName: primerNombre(fila.organizer_name),
    remaining:
      fila.monthly_limit_cents === null
        ? null
        : pesos(Math.max(0, Number(fila.monthly_limit_cents) - Number(fila.spent_cents))),
  };
}
