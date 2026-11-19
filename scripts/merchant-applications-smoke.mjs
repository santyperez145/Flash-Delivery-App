// Alta real de comercio (FE-05) contra PostgreSQL y la API.
//
// Con cuentas sintéticas, rotuladas como prueba —dos personas que se postulan, una
// clienta sin permisos, una de soporte y una de administración—, recorre:
//
// - postularse: un CUIT con el dígito verificador mal es 400; la solicitud entra con
//   201; una segunda abierta es 409;
// - permisos: una clienta no lista ni decide (403); soporte lista pero no decide;
// - la cola: admin ve la pendiente, la más vieja primero, y el tablero de colas la
//   cuenta;
// - pedir cambios exige motivo, y quien se postuló lo lee en sus solicitudes;
// - rechazar, con motivo y aviso;
// - aprobar dos veces a la vez: una sola gana, la otra es 409, y nace un solo
//   comercio, activo, cerrado, con su sucursal principal sin horario y el rol
//   `merchant`, con auditoría y aviso; decidir de nuevo es 409;
// - quien se postuló ya tiene su comercio: `/api/merchant/me` lo trae, y otra
//   postulación es 409;
// - operaciones ve el comercio suspendido con fecha y motivo, y al reactivarlo deja
//   de verlos.
//
// Todo lo que crea lo borra en el `finally`: solicitudes, comercio, sucursal, roles,
// avisos, eventos de auditoría y de tiempo real, sesiones y cuentas.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `map-${crypto.randomBytes(4).toString("hex")}`,
  password = `Clave-${crypto.randomBytes(9).toString("base64url")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const usuarios = {};
const solicitudes = [];
async function api(path, { token, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const ingresar = async (user) => {
  const sesion = await api("/auth/login", {
    body: { email: user.email, password, deviceName: "merchant-applications-smoke" },
  });
  if (!sesion.body.token) throw new Error(`no se pudo ingresar como ${user.email}`);
  return sesion.body.token;
};
// CUIT sintético de prueba: 30-00000000-7 tiene el dígito verificador bien.
const solicitud = (nombre, extra = {}) => ({
  businessName: `${nombre} (prueba)`,
  legalName: `${nombre} Sintética SRL`,
  taxId: "30-00000000-7",
  vertical: "restaurant",
  contactPhone: "+541100000000",
  address: "Defensa 982, San Telmo (dirección de prueba)",
  lat: -34.6177,
  lng: -58.3621,
  notes: "Solicitud creada por test:merchant-applications",
  ...extra,
});

try {
  // --- Cuentas sintéticas -----------------------------------------------------------
  const hash = await bcrypt.hash(password, 10);
  for (const [clave, rol] of [
    ["ana", "customer"],
    ["beto", "customer"],
    ["caro", "customer"],
    ["soporte", "support"],
    ["admin", "admin"],
  ]) {
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,email_verified_at,created_at)
         VALUES($1,$1||'@flash.test',$2,$3,now(),now()-interval '30 days') RETURNING id,public_id,email`,
        [`${marca}-${clave}`, hash, `${clave[0].toUpperCase()}${clave.slice(1)} Sintética`],
      )
    ).rows[0];
    await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2)", [user.id, rol]);
    usuarios[clave] = user;
  }
  const { ana, beto } = usuarios;
  const tokens = {};
  for (const clave of Object.keys(usuarios)) tokens[clave] = await ingresar(usuarios[clave]);

  // --- Postularse ---------------------------------------------------------------------
  const cuitMalo = await api("/applications/merchant", {
    token: tokens.ana,
    body: solicitud("Cocina de Ana", { taxId: "30000000000" }),
  });
  const sinSesion = await api("/applications/merchant", { body: solicitud("Sin sesión") });
  assert(
    cuitMalo.status === 400 && /CUIT/.test(cuitMalo.body.message || "") && sinSesion.status === 401,
    "un CUIT con el dígito verificador mal es 400, y sin sesión es 401",
  );
  const deAna = await api("/applications/merchant", {
    token: tokens.ana,
    body: solicitud("Cocina de Ana"),
  });
  solicitudes.push(deAna.body.application?.id);
  assert(
    deAna.status === 201 &&
      deAna.body.application.status === "pending" &&
      deAna.body.application.taxId === "30000000007" &&
      deAna.body.application.decidedAt === null &&
      deAna.body.application.merchantId === null &&
      Math.abs(deAna.body.application.lat - -34.6177) < 1e-6,
    "la solicitud entra pendiente, con el CUIT sin guiones y la ubicación declarada",
  );
  const segunda = await api("/applications/merchant", {
    token: tokens.ana,
    body: solicitud("Otra cocina de Ana"),
  });
  assert(
    segunda.status === 409 && segunda.body.message === "Ya tenés una solicitud en curso",
    "una segunda solicitud abierta es 409",
  );
  const deBeto = await api("/applications/merchant", {
    token: tokens.beto,
    body: solicitud("Almacén de Beto", { vertical: "grocery" }),
  });
  solicitudes.push(deBeto.body.application?.id);
  assert(deBeto.status === 201, "otra persona se postula aparte");

  // --- Permisos -----------------------------------------------------------------------
  const idAna = deAna.body.application.id;
  const listaCliente = await api("/admin/merchant-applications", { token: tokens.caro });
  const decisionCliente = await api(`/admin/merchant-applications/${idAna}/decision`, {
    token: tokens.caro,
    body: { decision: "approve" },
  });
  const listaSoporte = await api("/admin/merchant-applications?status=pending", {
    token: tokens.soporte,
  });
  const decisionSoporte = await api(`/admin/merchant-applications/${idAna}/decision`, {
    token: tokens.soporte,
    body: { decision: "approve" },
  });
  assert(
    listaCliente.status === 403 &&
      decisionCliente.status === 403 &&
      listaSoporte.status === 200 &&
      decisionSoporte.status === 403,
    "una clienta no lista ni decide; soporte lista y no decide",
  );

  // --- La cola ------------------------------------------------------------------------
  const pendientes = await api("/admin/merchant-applications?status=pending", {
    token: tokens.admin,
  });
  const propias = (pendientes.body.applications || []).filter((fila) =>
    solicitudes.includes(fila.id),
  );
  assert(
    pendientes.status === 200 &&
      propias.length === 2 &&
      propias[0].id === idAna &&
      propias[0].applicant?.email === ana.email &&
      "nextCursor" in pendientes.body,
    "admin lista las pendientes, la más vieja primero, con quien se postuló",
  );
  const cursorMalo = await api("/admin/merchant-applications?status=pending&cursor=nada", {
    token: tokens.admin,
  });
  assert(cursorMalo.status === 400, "un cursor con otra forma es 400");
  const colas = await api("/operations/work-queues", { token: tokens.admin });
  const cola = colas.body.queues?.find((fila) => fila.key === "merchant_applications");
  assert(
    colas.status === 200 && cola?.owner === "human" && cola.pending >= 2,
    "el tablero de colas cuenta las solicitudes por revisar",
  );

  // --- Pedir cambios ------------------------------------------------------------------
  const cambiosSinMotivo = await api(`/admin/merchant-applications/${idAna}/decision`, {
    token: tokens.admin,
    body: { decision: "needs_changes" },
  });
  const motivoCambios = "Falta el número de la calle en la dirección";
  const cambios = await api(`/admin/merchant-applications/${idAna}/decision`, {
    token: tokens.admin,
    body: { decision: "needs_changes", reason: motivoCambios },
  });
  const vistaAna = await api("/applications/me", { token: tokens.ana });
  assert(
    cambiosSinMotivo.status === 400 &&
      cambios.status === 200 &&
      cambios.body.application.status === "needs_changes" &&
      vistaAna.status === 200 &&
      vistaAna.body.applications?.[0]?.id === idAna &&
      vistaAna.body.applications[0].decisionReason === motivoCambios &&
      vistaAna.body.applications[0].decidedAt,
    "pedir cambios exige motivo, y quien se postuló lo lee en sus solicitudes",
  );
  const otraConCambios = await api("/applications/merchant", {
    token: tokens.ana,
    body: solicitud("Otra cocina de Ana"),
  });
  assert(otraConCambios.status === 409, "una observada sigue contando como solicitud en curso");

  // --- Rechazar -----------------------------------------------------------------------
  const idBeto = deBeto.body.application.id;
  const rechazo = await api(`/admin/merchant-applications/${idBeto}/decision`, {
    token: tokens.admin,
    body: { decision: "reject", reason: "El CUIT no corresponde a la razón social" },
  });
  const vistaBeto = await api("/applications/me", { token: tokens.beto });
  const rechazadas = await api("/admin/merchant-applications?status=rejected", {
    token: tokens.admin,
  });
  assert(
    rechazo.status === 200 &&
      rechazo.body.application.status === "rejected" &&
      rechazo.body.merchant === undefined &&
      vistaBeto.body.applications?.[0]?.decisionReason ===
        "El CUIT no corresponde a la razón social" &&
      rechazadas.body.applications?.some((fila) => fila.id === idBeto),
    "rechazar registra el motivo y la solicitud pasa a las rechazadas",
  );
  const avisoRechazo = (
    await pool.query(
      "SELECT channel,template,payload FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
      [beto.id],
    )
  ).rows[0];
  assert(
    avisoRechazo?.channel === "in_app" &&
      avisoRechazo.template === "merchant_application" &&
      avisoRechazo.payload.status === "rejected" &&
      avisoRechazo.payload.title &&
      avisoRechazo.payload.body.includes("El CUIT no corresponde"),
    "quien fue rechazado recibe un aviso dentro de la app con el motivo",
  );

  // --- Aprobar, dos veces a la vez ----------------------------------------------------
  const [primera, simultanea] = await Promise.all(
    [0, 1].map(() =>
      api(`/admin/merchant-applications/${idAna}/decision`, {
        token: tokens.admin,
        body: { decision: "approve" },
      }),
    ),
  );
  const estados = [primera.status, simultanea.status].sort();
  const aprobada = [primera, simultanea].find((r) => r.status === 200);
  assert(
    estados[0] === 200 && estados[1] === 409,
    "dos aprobaciones simultáneas: una gana y la otra es 409",
  );
  const merchantId = aprobada.body.merchant?.id;
  const comercios = (
    await pool.query(
      `SELECT m.id,m.public_id,m.name,m.vertical,m.status,m.open,m.address,
         ST_Y(m.location::geometry) lat,
         (SELECT count(*)::int FROM merchant_branches b WHERE b.merchant_id=m.id) sucursales,
         (SELECT count(*)::int FROM merchant_branches b WHERE b.merchant_id=m.id AND b.is_primary AND NOT b.open
            AND b.public_id='branch_'||m.public_id) principal_cerrada,
         (SELECT count(*)::int FROM branch_operating_hours h JOIN merchant_branches b ON b.id=h.branch_id
            WHERE b.merchant_id=m.id) horarios
       FROM merchants m WHERE m.owner_id=$1`,
      [ana.id],
    )
  ).rows;
  assert(
    aprobada.body.application.status === "approved" &&
      aprobada.body.application.merchantId === merchantId &&
      comercios.length === 1 &&
      comercios[0].public_id === merchantId &&
      comercios[0].name === "Cocina de Ana (prueba)" &&
      comercios[0].vertical === "restaurant" &&
      comercios[0].status === "active" &&
      comercios[0].open === false &&
      Math.abs(comercios[0].lat - -34.6177) < 1e-6 &&
      comercios[0].sucursales === 1 &&
      comercios[0].principal_cerrada === 1 &&
      comercios[0].horarios === 0,
    "aprobar crea un solo comercio activo y cerrado, con su sucursal principal y sin horario",
  );
  const roles = (
    await pool.query(
      "SELECT array_agg(role::text ORDER BY role) r FROM user_roles WHERE user_id=$1",
      [ana.id],
    )
  ).rows[0].r;
  const auditoria = (
    await pool.query(
      "SELECT action,after_data FROM audit_events WHERE entity_type='merchant_application' AND entity_id=$1 ORDER BY id",
      [idAna],
    )
  ).rows;
  const avisoAprobacion = (
    await pool.query(
      "SELECT payload FROM notifications WHERE user_id=$1 AND payload->>'status'='approved'",
      [ana.id],
    )
  ).rows;
  assert(
    roles.includes("merchant") &&
      roles.includes("customer") &&
      auditoria.map((fila) => fila.action).join() ===
        "merchant_application.needs_changes,merchant_application.approved" &&
      auditoria[0].after_data.reason === motivoCambios &&
      auditoria[1].after_data.merchantId === merchantId &&
      avisoAprobacion.length === 1 &&
      avisoAprobacion[0].payload.merchantId === merchantId,
    "aprobar otorga el rol merchant, queda auditado una sola vez y avisa a quien se postuló",
  );
  const otraVez = await api(`/admin/merchant-applications/${idAna}/decision`, {
    token: tokens.admin,
    body: { decision: "reject", reason: "Intento de decidir de nuevo" },
  });
  const inexistente = await api(`/admin/merchant-applications/MAP-NOEXISTE/decision`, {
    token: tokens.admin,
    body: { decision: "approve" },
  });
  assert(
    otraVez.status === 409 && inexistente.status === 404,
    "decidir una solicitud ya resuelta es 409, y una inexistente 404",
  );

  // --- El comercio ya es de quien se postuló ------------------------------------------
  const consola = await api("/merchant/me", { token: tokens.ana });
  const propio = consola.body.restaurants?.find((fila) => fila.id === merchantId);
  assert(
    consola.status === 200 &&
      consola.body.restaurants.length === 1 &&
      propio?.ownerId === ana.public_id &&
      propio.manualOpen === false &&
      propio.menu.length === 0 &&
      propio.branches?.length === 1 &&
      propio.branches[0].weeklyHours.length === 0,
    "quien se postuló ve su comercio en /api/merchant/me, cerrado, sin productos ni horario",
  );
  const conComercio = await api("/applications/merchant", {
    token: tokens.ana,
    body: solicitud("Segunda cocina de Ana"),
  });
  assert(
    conComercio.status === 409 && /comercio/.test(conComercio.body.message || ""),
    "quien ya tiene un comercio no se vuelve a postular",
  );

  // --- Operaciones ve la suspensión ---------------------------------------------------
  const motivoSuspension = "Prueba de suspensión de test:merchant-applications";
  const suspension = await api(`/admin/merchants/${merchantId}/status`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "suspended", reason: motivoSuspension },
  });
  const listado = await api(`/operations/restaurants?q=${merchantId}`, { token: tokens.admin });
  const suspendido = listado.body.restaurants?.find((fila) => fila.id === merchantId);
  assert(
    suspension.status === 200 &&
      suspendido?.status === "suspended" &&
      suspendido.suspensionReason === motivoSuspension &&
      Date.now() - new Date(suspendido.suspendedAt).getTime() < 5 * 60_000,
    "operaciones ve el comercio suspendido, con la fecha y el motivo de la suspensión",
  );
  await api(`/admin/merchants/${merchantId}/status`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "active", reason: "Fin de la prueba de suspensión" },
  });
  const reactivado = (
    await api(`/operations/restaurants?q=${merchantId}`, { token: tokens.admin })
  ).body.restaurants?.find((fila) => fila.id === merchantId);
  assert(
    reactivado?.status === "active" &&
      reactivado.suspendedAt === null &&
      reactivado.suspensionReason === null,
    "al reactivarlo, el comercio vuelve a activo sin fecha ni motivo de suspensión",
  );
} finally {
  const ids = Object.values(usuarios).map((user) => user.id);
  const publicos = Object.values(usuarios).map((user) => user.public_id);
  const comercios = (
    await pool.query("SELECT id,public_id FROM merchants WHERE owner_id = ANY($1)", [ids])
  ).rows;
  const deSolicitudes = (
    await pool.query("SELECT public_id FROM merchant_applications WHERE applicant_id = ANY($1)", [
      ids,
    ])
  ).rows.map((fila) => fila.public_id);
  const entidades = [
    ...publicos,
    ...comercios.map((fila) => fila.public_id),
    ...solicitudes.filter(Boolean),
    ...deSolicitudes,
  ];
  // La solicitud apunta al comercio: va primero. La sucursal y lo que cuelga de ella
  // se van en cascada con el comercio.
  await pool.query("DELETE FROM merchant_applications WHERE applicant_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM merchants WHERE id = ANY($1)", [comercios.map((fila) => fila.id)]);
  await pool.query(
    "DELETE FROM realtime_events WHERE entity_id = ANY($1) OR actor_public_id = ANY($2)",
    [entidades, publicos],
  );
  await pool.query("DELETE FROM audit_events WHERE actor_id = ANY($1) OR entity_id = ANY($2)", [
    ids,
    entidades,
  ]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
}
