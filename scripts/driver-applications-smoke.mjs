// Alta real de repartidores y conductores (FE-06) contra PostgreSQL y la API.
//
// Con cuentas sintéticas, rotuladas como prueba —una repartidora en bicicleta, un
// conductor de auto, una persona sin teléfono verificado, una clienta, soporte y
// administración—, recorre:
//
// - postularse: sin sesión es 401; sin teléfono verificado es 409 con su código; una
//   bici con patente, una moto sin patente, viajes en bici y una ciudad cerrada son 400;
// - la postulación crea el conductor desconectado, el legajo pendiente, el vehículo en
//   revisión (la bici sin patente) y el rol `driver`; otra es 409 y dice cuál es; una
//   patente repetida es 409 y no deja nada a medias;
// - lo que se pide depende del vehículo: en bici, identidad y antecedentes; en auto,
//   los cinco documentos;
// - conectarse antes de la aprobación es 409;
// - la cola: una clienta no la ve (403), soporte sí; trae a los dos, el más viejo
//   primero, con documentos sin contenido y sus vehículos;
// - rechazar un documento con motivo: quien se postuló lo lee, lo reemplaza y la cola
//   muestra sólo el nuevo;
// - aprobar los documentos y el vehículo: el legajo queda aprobado y puede conectarse;
//   la cola lo pasa a «Aprobados»;
// - quien se aprobó en bici y activa una moto aprobada no se conecta sin licencia,
//   cédula y seguro.
//
// Todo lo que crea lo borra en el `finally`.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `drv-${crypto.randomBytes(4).toString("hex")}`,
  password = `Clave-${crypto.randomBytes(9).toString("base64url")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
const usuarios = {};
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
    body: { email: user.email, password, deviceName: "driver-applications-smoke" },
  });
  if (!sesion.body.token) throw new Error(`no se pudo ingresar como ${user.email}`);
  return sesion.body.token;
};
const documento = (type) => ({
  type,
  mimeType: "application/pdf",
  contentBase64: Buffer.from(`documento de prueba ${type} ${crypto.randomUUID()}`).toString(
    "base64",
  ),
  expiresAt: ["driver_license", "vehicle_registration", "insurance"].includes(type)
    ? "2099-12-31"
    : null,
});
// Patentes sintéticas que no existen en el registro: tres letras de la marca.
const sufijo = marca.slice(-3).toUpperCase().replace(/[0-9]/g, "X");

try {
  const ciudad = (
    await pool.query("SELECT public_id FROM cities WHERE status IN ('beta','active') LIMIT 1")
  ).rows[0];
  if (!ciudad) throw new Error("No hay ninguna ciudad abierta para postularse");

  // --- Cuentas sintéticas -----------------------------------------------------------
  const hash = await bcrypt.hash(password, 10);
  let telefono = 0;
  for (const [clave, rol, verificado] of [
    ["bici", "customer", true],
    ["auto", "customer", true],
    ["sintel", "customer", false],
    ["clienta", "customer", true],
    ["doble", "customer", true],
    ["soporte", "support", false],
    ["admin", "admin", false],
  ]) {
    telefono += 1;
    const numero = `+5491199${crypto.randomInt(10000, 99999)}${telefono}`;
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,phone,phone_verified_at,email_verified_at,created_at)
         VALUES($1,$1||'@flash.test',$2,$3,$4,$5,now(),now()-interval '30 days') RETURNING id,public_id,email`,
        [
          `${marca}-${clave}`,
          hash,
          `${clave[0].toUpperCase()}${clave.slice(1)} Sintética`,
          numero,
          verificado ? new Date() : null,
        ],
      )
    ).rows[0];
    await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2)", [user.id, rol]);
    usuarios[clave] = user;
  }
  const tokens = {};
  for (const clave of Object.keys(usuarios)) tokens[clave] = await ingresar(usuarios[clave]);

  const enBici = {
    cityId: ciudad.public_id,
    services: ["delivery"],
    vehicle: { kind: "bicycle", model: "Bicicleta urbana (prueba)" },
  };
  const enAuto = {
    cityId: ciudad.public_id,
    services: ["delivery", "ride"],
    vehicle: {
      kind: "car",
      model: "Auto de prueba",
      plate: `AA${sufijo}11`,
      color: "Gris",
      seats: 4,
    },
  };

  // --- Postularse ---------------------------------------------------------------------
  const sinSesion = await api("/applications/driver", { body: enBici });
  const sinTelefono = await api("/applications/driver", { token: tokens.sintel, body: enBici });
  assert(
    sinSesion.status === 401 &&
      sinTelefono.status === 409 &&
      sinTelefono.body.code === "phone_verification_required",
    "sin sesión es 401, y sin teléfono verificado es 409 con su código",
  );
  // El código vale para el número al que se mandó: cambiar de número antes de confirmarlo
  // lo anula, aunque el segundo pedido choque con la espera de 30 segundos.
  const numeroA = `+5491188${crypto.randomInt(100000, 999999)}`;
  const numeroB = `+5491177${crypto.randomInt(100000, 999999)}`;
  const pedidoA = await api("/me/phone-verification/request", {
    token: tokens.sintel,
    body: { phone: numeroA },
  });
  const pedidoB = await api("/me/phone-verification/request", {
    token: tokens.sintel,
    body: { phone: numeroB },
  });
  const conCodigoDeA = await api("/me/phone-verification/confirm", {
    token: tokens.sintel,
    body: { code: pedidoA.body.developmentCode },
  });
  const trasCambio = (
    await pool.query("SELECT phone, phone_verified_at FROM users WHERE id=$1", [usuarios.sintel.id])
  ).rows[0];
  assert(
    pedidoA.status === 200 &&
      pedidoB.status === 429 &&
      conCodigoDeA.status === 400 &&
      trasCambio.phone === numeroB &&
      trasCambio.phone_verified_at === null,
    "el código de un número no verifica otro: cambiar de número anula el código anterior",
  );
  const invalidas = await Promise.all(
    [
      { ...enBici, vehicle: { ...enBici.vehicle, plate: "ABC123" } },
      { ...enBici, vehicle: { kind: "motorcycle", model: "Moto de prueba" } },
      { ...enBici, services: ["ride"] },
      { ...enBici, cityId: "CITY-NO-EXISTE" },
    ].map((body) => api("/applications/driver", { token: tokens.bici, body })),
  );
  assert(
    invalidas.every((respuesta) => respuesta.status === 400),
    "una bici con patente, una moto sin patente, viajes en bici y una ciudad cerrada son 400",
  );

  const bici = await api("/applications/driver", { token: tokens.bici, body: enBici });
  const driverBici = bici.body.application?.driverId;
  const filaBici = (
    await pool.query(
      `SELECT d.online, c.status, v.plate, v.status vehicle_status, v.active,
              EXISTS(SELECT 1 FROM user_roles r WHERE r.user_id=d.user_id AND r.role='driver') rol
       FROM drivers d JOIN driver_compliance c ON c.driver_id=d.id JOIN vehicles v ON v.driver_id=d.id
       WHERE d.public_id=$1`,
      [driverBici],
    )
  ).rows[0];
  assert(
    bici.status === 201 &&
      bici.body.application.status === "pending" &&
      filaBici &&
      !filaBici.online &&
      filaBici.status === "pending" &&
      filaBici.plate === null &&
      filaBici.vehicle_status === "pending" &&
      filaBici.active &&
      filaBici.rol,
    "la postulación crea el conductor desconectado, el legajo pendiente, la bici sin patente en revisión y el rol",
  );
  const otra = await api("/applications/driver", { token: tokens.bici, body: enBici });
  const mia = await api("/applications/driver/me", { token: tokens.bici });
  assert(
    otra.status === 409 &&
      otra.body.driverId === driverBici &&
      mia.body.application?.driverId === driverBici,
    "otra postulación es 409 y dice cuál es; la propia se lee",
  );
  // Dos envíos a la vez de la misma cuenta: uno entra y el otro es 409, sin que la base
  // aborte ninguno por un bloqueo cruzado.
  const aLaVez = await Promise.all(
    [1, 2].map(() => api("/applications/driver", { token: tokens.doble, body: enBici })),
  );
  assert(
    aLaVez
      .map((respuesta) => respuesta.status)
      .sort()
      .join() === "201,409",
    "dos postulaciones a la vez de la misma cuenta: una entra y la otra es 409",
  );

  const auto = await api("/applications/driver", { token: tokens.auto, body: enAuto });
  const driverAuto = auto.body.application?.driverId;
  const patenteRepetida = await api("/applications/driver", {
    token: tokens.clienta,
    body: { ...enAuto, services: ["delivery"] },
  });
  const restos = (await pool.query("SELECT 1 FROM drivers WHERE user_id=$1", [usuarios.clienta.id]))
    .rowCount;
  assert(
    auto.status === 201 && patenteRepetida.status === 409 && restos === 0,
    "una patente repetida es 409 y no deja un conductor a medias",
  );
  // La cédula del vehículo vence: sin fecha es 400, como la licencia y el seguro.
  const cedulaSinFecha = await api(`/drivers/${driverAuto}/documents`, {
    token: tokens.auto,
    body: { ...documento("vehicle_registration"), expiresAt: null },
  });
  assert(cedulaSinFecha.status === 400, "la cédula del vehículo sin vencimiento es 400");

  const legajoBici = await api(`/drivers/${driverBici}/compliance`, { token: tokens.bici });
  const legajoAuto = await api(`/drivers/${driverAuto}/compliance`, { token: tokens.auto });
  assert(
    legajoBici.body.compliance?.requiredTypes.join() === "identity,background_check" &&
      legajoAuto.body.compliance?.requiredTypes.length === 5,
    "en bici se pide identidad y antecedentes; en auto, los cinco documentos",
  );
  const antes = await api(`/drivers/${driverBici}/availability`, {
    token: tokens.bici,
    method: "PATCH",
    body: { online: true },
  });
  assert(antes.status === 409, "conectarse antes de la aprobación es 409");

  // --- La cola de operaciones -------------------------------------------------------
  const deClienta = await api("/admin/driver-applications", { token: tokens.clienta });
  const deSoporte = await api("/admin/driver-applications", { token: tokens.soporte });
  assert(
    deClienta.status === 403 && deSoporte.status === 200,
    "una clienta no ve la cola; soporte sí",
  );
  const mios = (cola) =>
    (cola.body.drivers || []).filter((fila) => [driverBici, driverAuto].includes(fila.id));
  const cola = await api("/admin/driver-applications?status=pending", { token: tokens.admin });
  const enCola = mios(cola);
  assert(
    enCola.length === 2 &&
      enCola[0].id === driverBici &&
      enCola[0].vehicles[0].plate === null &&
      enCola[0].person.phoneVerified &&
      enCola[1].vehicles[0].seats === 4,
    "la cola trae a los dos, el más viejo primero, con sus vehículos",
  );

  const subidos = {};
  for (const tipo of ["identity", "background_check"]) {
    const subido = await api(`/drivers/${driverBici}/documents`, {
      token: tokens.bici,
      body: documento(tipo),
    });
    subidos[tipo] = subido.body.document?.id;
  }
  const conDocumentos = mios(
    await api("/admin/driver-applications?status=pending", { token: tokens.admin }),
  ).find((fila) => fila.id === driverBici);
  assert(
    conDocumentos?.documents.length === 2 &&
      conDocumentos.documents.every((doc) => doc.status === "pending" && !("contentBase64" in doc)),
    "los documentos llegan a la cola pendientes y sin su contenido",
  );

  // --- Rechazar, reemplazar, aprobar -------------------------------------------------
  const rechazo = await api(`/admin/driver-documents/${subidos.background_check}/review`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "rejected", rejectionReason: "Foto borrosa: no se lee el certificado" },
  });
  const visto = await api(`/drivers/${driverBici}/compliance`, { token: tokens.bici });
  assert(
    rechazo.status === 200 &&
      visto.body.compliance.status === "rejected" &&
      visto.body.compliance.documents.some(
        (doc) => doc.type === "background_check" && /borrosa/.test(doc.rejectionReason || ""),
      ),
    "un documento rechazado con motivo: quien se postuló lo lee",
  );
  const reemplazo = await api(`/drivers/${driverBici}/documents`, {
    token: tokens.bici,
    body: documento("background_check"),
  });
  subidos.background_check = reemplazo.body.document?.id;
  const trasReemplazo = mios(
    await api("/admin/driver-applications?status=pending", { token: tokens.admin }),
  ).find((fila) => fila.id === driverBici);
  const antecedentes = trasReemplazo.documents.filter((doc) => doc.type === "background_check");
  assert(
    antecedentes.length === 1 &&
      antecedentes[0].id === subidos.background_check &&
      antecedentes[0].status === "pending",
    "al reemplazarlo, la cola muestra sólo el documento nuevo",
  );
  for (const id of Object.values(subidos))
    await api(`/admin/driver-documents/${id}/review`, {
      token: tokens.admin,
      method: "PATCH",
      body: { status: "approved" },
    });
  const vehiculoBici = enCola[0].vehicles[0].id;
  await api(`/admin/driver-vehicles/${vehiculoBici}/review`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "approved" },
  });
  const aprobado = await api(`/drivers/${driverBici}/compliance`, { token: tokens.bici });
  const conectada = await api(`/drivers/${driverBici}/availability`, {
    token: tokens.bici,
    method: "PATCH",
    body: { online: true },
  });
  assert(
    aprobado.body.compliance.status === "approved" &&
      conectada.status === 200 &&
      conectada.body.driver?.online,
    "con identidad, antecedentes y la bici aprobados, el legajo queda aprobado y se conecta",
  );
  await api(`/drivers/${driverBici}/availability`, {
    token: tokens.bici,
    method: "PATCH",
    body: { online: false },
  });
  const aprobados = mios(
    await api("/admin/driver-applications?status=approved", { token: tokens.admin }),
  );
  const pendientes = mios(
    await api("/admin/driver-applications?status=pending", { token: tokens.admin }),
  );
  assert(
    aprobados.some((fila) => fila.id === driverBici) &&
      !pendientes.some((fila) => fila.id === driverBici),
    "la cola lo pasa a «Aprobados»",
  );

  // --- De la bici a la moto ----------------------------------------------------------
  const moto = await api(`/drivers/${driverBici}/vehicles`, {
    token: tokens.bici,
    body: {
      kind: "motorcycle",
      model: "Moto de prueba",
      plate: `A${sufijo}222`,
      serviceModes: ["delivery"],
    },
  });
  const motoId = moto.body.vehicle?.id;
  await api(`/admin/driver-vehicles/${motoId}/review`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "approved" },
  });
  await api(`/driver-vehicles/${motoId}/activate`, { token: tokens.bici, method: "POST" });
  const enMoto = await api(`/drivers/${driverBici}/availability`, {
    token: tokens.bici,
    method: "PATCH",
    body: { online: true },
  });
  assert(
    moto.status === 201 && enMoto.status === 409 && /licencia/.test(enMoto.body.message || ""),
    "quien se aprobó en bici no sale en moto sin licencia, cédula y seguro aprobados",
  );

  // --- De vuelta a la bici: lo que ya no se pide no bloquea ---------------------------
  await api(`/driver-vehicles/${vehiculoBici}/activate`, { token: tokens.bici, method: "POST" });
  const retirada = await api(`/driver-vehicles/${motoId}`, {
    token: tokens.bici,
    method: "DELETE",
  });
  const seguro = await api(`/drivers/${driverBici}/documents`, {
    token: tokens.bici,
    body: documento("insurance"),
  });
  await api(`/admin/driver-documents/${seguro.body.document?.id}/review`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "approved" },
  });
  await pool.query("UPDATE driver_documents SET expires_at=current_date-1 WHERE public_id=$1", [
    seguro.body.document?.id,
  ]);
  const enBiciDeNuevo = await api(`/drivers/${driverBici}/availability`, {
    token: tokens.bici,
    method: "PATCH",
    body: { online: true },
  });
  assert(
    retirada.status === 200 && seguro.status === 201 && enBiciDeNuevo.status === 200,
    "de vuelta en bici, el seguro vencido de la moto retirada no impide conectarse",
  );
  await api(`/drivers/${driverBici}/availability`, {
    token: tokens.bici,
    method: "PATCH",
    body: { online: false },
  });

  // --- Un documento aprobado que venció --------------------------------------------
  await pool.query("UPDATE driver_documents SET expires_at=current_date-1 WHERE public_id=$1", [
    subidos.identity,
  ]);
  const conVencido = await api(`/drivers/${driverBici}/compliance`, { token: tokens.bici });
  const enColaVencido = mios(
    await api("/admin/driver-applications?status=approved", { token: tokens.admin }),
  ).find((fila) => fila.id === driverBici);
  assert(
    conVencido.body.compliance.documents.find((doc) => doc.id === subidos.identity)?.status ===
      "expired" &&
      enColaVencido?.documents.find((doc) => doc.type === "identity")?.status === "expired",
    "un documento aprobado que venció se muestra vencido, para que se reemplace",
  );

  // --- Un vehículo rechazado se corrige y vuelve a revisión -------------------------
  const vehiculoAuto = enCola[1].vehicles[0].id;
  await api(`/admin/driver-vehicles/${vehiculoAuto}/review`, {
    token: tokens.admin,
    method: "PATCH",
    body: { status: "rejected", rejectionReason: "La patente no coincide con la cédula" },
  });
  const corregido = await api(`/driver-vehicles/${vehiculoAuto}`, {
    token: tokens.auto,
    method: "PATCH",
    body: { plate: `AB${sufijo}33` },
  });
  const vuelveACola = mios(
    await api("/admin/driver-applications?status=pending", { token: tokens.admin }),
  ).find((fila) => fila.id === driverAuto);
  assert(
    corregido.status === 200 &&
      corregido.body.vehicle?.status === "pending" &&
      vuelveACola?.vehicles[0].status === "pending",
    "un vehículo rechazado se corrige y vuelve a la cola para revisar",
  );
} finally {
  const ids = Object.values(usuarios).map((user) => user.id);
  const publicos = Object.values(usuarios).map((user) => user.public_id);
  const conductores = (
    await pool.query("SELECT public_id FROM drivers WHERE user_id = ANY($1)", [ids])
  ).rows.map((fila) => fila.public_id);
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  await pool.query(
    "DELETE FROM realtime_events WHERE entity_id = ANY($1) OR actor_public_id = ANY($2)",
    [[...publicos, ...conductores], publicos],
  );
  await pool.query("DELETE FROM audit_events WHERE actor_id = ANY($1) OR entity_id = ANY($2)", [
    ids,
    conductores,
  ]);
  // El legajo, los documentos y los vehículos se van en cascada con el conductor.
  await pool.query("DELETE FROM drivers WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
}
