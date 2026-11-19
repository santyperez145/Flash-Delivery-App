// Verificación en dos pasos de cualquier cuenta (SEG-08) contra la API y PostgreSQL.
//
// Con un cliente y un conductor sintéticos:
//
// - activar: el secreto queda cifrado; confirmar cierra las demás sesiones y avisa
//   por push y por email;
// - ingresar: la contraseña sola devuelve un desafío; con el código, una sesión que
//   se renueva sin volver a pedirlo (dispositivo de confianza);
// - una sesión que no pasó el segundo factor no se renueva: pide el código;
// - un código TOTP no se puede reusar, y uno de recuperación sirve una sola vez;
// - acciones sensibles: eliminar la cuenta pide el código (403 `mfaRequired`);
// - desactivar y regenerar códigos piden un código vigente;
// - cinco códigos inválidos bloquean la verificación.
//
// Todo lo que crea lo borra al final.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { createPool } from "./db-client.mjs";
import { closePostgres } from "../server/postgres.js";
import { createPostgresSession } from "../server/auth-repository.js";

const base = process.env.API_URL || "http://127.0.0.1:4000/api",
  pool = createPool(),
  marca = `mfa-${crypto.randomBytes(4).toString("hex")}`,
  password = `Clave-${crypto.randomBytes(9).toString("base64url")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};
// Un código del paso siguiente de 30 s: el servidor tolera uno de desfase y así la
// prueba no espera para tener un código que todavía no se usó.
const siguiente = (secret, pasos = 1) =>
  authenticator.clone({ epoch: Date.now() + pasos * 30000 }).generate(secret);

async function api(path, { token, body, method = body ? "POST" : "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
const login = (email, deviceName) => api("/auth/login", { body: { email, password, deviceName } });
const refresh = (refreshToken) =>
  api("/auth/refresh", { body: { refreshToken, deviceName: "account-mfa-smoke" } });

const usuarios = {};
try {
  const hash = await bcrypt.hash(password, 10);
  for (const [clave, rol] of [
    ["cliente", "customer"],
    ["conductor", "driver"],
  ]) {
    const user = (
      await pool.query(
        `INSERT INTO users(public_id,email,password_hash,name,email_verified_at)
         VALUES($1,$1||'@flash.test',$2,$3,now()) RETURNING id,public_id,email`,
        [`${marca}-${clave}`, hash, `${clave} sintético`],
      )
    ).rows[0];
    await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,$2)", [user.id, rol]);
    usuarios[clave] = user;
  }
  const { cliente, conductor } = usuarios;

  // --- Activar ----------------------------------------------------------------
  const primera = await login(cliente.email, "teléfono");
  const otra = await login(cliente.email, "computadora");
  assert(
    primera.status === 200 && primera.body.token && otra.body.refreshToken,
    "sin verificación, la contraseña alcanza",
  );
  const inicial = await api("/auth/mfa/status", { token: primera.body.token });
  assert(
    inicial.status === 200 && inicial.body.mfa.enabled === false,
    "un cliente puede consultar su verificación en dos pasos",
  );
  const alta = await api("/auth/mfa/enroll", { token: primera.body.token, body: {} });
  const secret = alta.body.enrollment?.secret;
  const recuperacion = alta.body.enrollment?.recoveryCodes || [];
  assert(
    alta.status === 200 &&
      secret &&
      recuperacion.length === 8 &&
      alta.body.enrollment.otpauthUri.startsWith("otpauth://totp/Flash:"),
    "un cliente puede empezar a activarla y recibe ocho códigos de recuperación",
  );
  const guardado = (
    await pool.query("SELECT secret_ciphertext,enabled FROM user_mfa WHERE user_id=$1", [
      cliente.id,
    ])
  ).rows[0];
  assert(
    !guardado.secret_ciphertext.includes(secret) && guardado.enabled === false,
    "el secreto queda cifrado y la verificación no se activa sin confirmar",
  );
  const malConfirmada = await api("/auth/mfa/confirm", {
    token: primera.body.token,
    body: { code: "000000" === authenticator.generate(secret) ? "111111" : "000000" },
  });
  assert(malConfirmada.status === 400, "un código equivocado no la activa");
  const codigoAlta = authenticator.generate(secret);
  const confirmada = await api("/auth/mfa/confirm", {
    token: primera.body.token,
    body: { code: codigoAlta, deviceName: "teléfono" },
  });
  assert(
    confirmada.status === 200 &&
      confirmada.body.mfa.enabled &&
      confirmada.body.token &&
      confirmada.body.revokedSessions >= 2,
    "confirmar la activa, emite una sesión nueva y cierra las demás",
  );
  assert(
    (await refresh(otra.body.refreshToken)).status === 401 &&
      (await refresh(primera.body.refreshToken)).status === 401,
    "las sesiones abiertas antes de activarla ya no se renuevan",
  );
  const avisos = (
    await pool.query(
      `SELECT channel,template,payload FROM notifications WHERE user_id=$1 AND deduplication_key LIKE 'mfa:mfa_enabled:%'`,
      [cliente.id],
    )
  ).rows;
  assert(
    avisos.some((aviso) => aviso.template === "security_alert") &&
      avisos.some(
        (aviso) => aviso.template === "account_security_change" && aviso.channel === "email",
      ),
    "activarla avisa por push y por email",
  );

  // --- Dispositivo de confianza ------------------------------------------------
  const renovada = await refresh(confirmada.body.refreshToken);
  assert(
    renovada.status === 200 && renovada.body.token && !renovada.body.mfaRequired,
    "la sesión que pasó el segundo factor se renueva sin volver a pedirlo",
  );
  const otraVez = await refresh(renovada.body.refreshToken);
  assert(otraVez.status === 200 && otraVez.body.token, "la marca sigue después de rotar");

  // --- Ingresar ------------------------------------------------------------------
  const desafio = await login(cliente.email, "tablet");
  assert(
    desafio.status === 200 &&
      desafio.body.mfaRequired &&
      desafio.body.mfaChallenge &&
      !desafio.body.token &&
      !desafio.body.refreshToken,
    "con la verificación activa, la contraseña sola sólo devuelve un desafío",
  );
  const repetido = await api("/auth/mfa/complete", {
    body: { challenge: desafio.body.mfaChallenge, code: codigoAlta },
  });
  assert(repetido.status === 401, "el código que activó la verificación no se puede reusar");
  const codigoIngreso = siguiente(secret);
  const completo = await api("/auth/mfa/complete", {
    body: { challenge: desafio.body.mfaChallenge, code: codigoIngreso, deviceName: "tablet" },
  });
  assert(
    completo.status === 200 && completo.body.token && completo.body.refreshToken,
    "con el código, el ingreso emite la sesión",
  );
  const reusado = await api("/auth/mfa/complete", {
    body: {
      challenge: (await login(cliente.email, "otra")).body.mfaChallenge,
      code: codigoIngreso,
    },
  });
  assert(reusado.status === 401, "un código TOTP ya usado no sirve otra vez");
  assert(
    (await refresh(completo.body.refreshToken)).status === 200,
    "la sesión del ingreso con código también se renueva sola",
  );

  // Una sesión creada sin pasar el segundo factor (por ejemplo, una carrera con la
  // activación) no se renueva: pide el código y queda cerrada.
  const sinMarca = await createPostgresSession({ internalId: cliente.id }, "sin marca");
  const pedida = await refresh(sinMarca.refreshToken);
  assert(
    pedida.status === 200 && pedida.body.mfaRequired && !pedida.body.token,
    "una sesión que no pasó el segundo factor no se renueva: pide el código",
  );
  assert((await refresh(sinMarca.refreshToken)).status === 401, "y esa sesión queda cerrada");

  // --- Acciones sensibles --------------------------------------------------------
  const token = completo.body.token;
  const sinCodigo = await api("/me/delete", { token, body: { password } });
  assert(
    sinCodigo.status === 403 && sinCodigo.body.mfaRequired === true,
    "eliminar la cuenta pide el código (403 con mfaRequired, no 401)",
  );
  const malaClave = await api("/me/delete", {
    token,
    body: { password: "otra-clave", mfaCode: recuperacion[0] },
  });
  const sigueRecuperacion = (await api("/auth/mfa/status", { token })).body.mfa;
  assert(
    malaClave.status === 403 && sigueRecuperacion.recoveryCodesRemaining === 8,
    "con la contraseña equivocada, el código no se gasta",
  );

  // --- Desactivar y regenerar ----------------------------------------------------
  const sinCodigoValido = await api("/auth/mfa/disable", { token, body: { code: "ZZZZ-ZZZZ" } });
  assert(sinCodigoValido.status === 403, "desactivarla pide un código vigente (403, no 401)");
  const regenerada = await api("/auth/mfa/recovery-codes", {
    token,
    body: { code: recuperacion[0] },
  });
  assert(
    regenerada.status === 200 &&
      regenerada.body.recoveryCodes.length === 8 &&
      regenerada.body.recoveryCodes.every((codigo) => !recuperacion.includes(codigo)),
    "un código de recuperación permite generar ocho nuevos",
  );
  const viejo = await api("/auth/mfa/disable", { token, body: { code: recuperacion[1] } });
  assert(viejo.status === 403, "los códigos anteriores dejan de servir");
  const apagada = await api("/auth/mfa/disable", {
    token,
    body: { code: regenerada.body.recoveryCodes[0] },
  });
  assert(
    apagada.status === 200 && apagada.body.mfa.enabled === false,
    "con un código vigente se desactiva",
  );
  const sinDesafio = await login(cliente.email, "después");
  assert(
    sinDesafio.status === 200 && sinDesafio.body.token && !sinDesafio.body.mfaRequired,
    "desactivada, la contraseña vuelve a alcanzar",
  );
  const avisoBaja = (
    await pool.query(
      `SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND deduplication_key LIKE 'mfa:mfa_disabled:%'`,
      [cliente.id],
    )
  ).rows[0].n;
  assert(avisoBaja === 2, "desactivarla avisa por push y por email");

  // --- Conductor: bloqueo por intentos ------------------------------------------
  const chofer = await login(conductor.email, "teléfono del conductor");
  const altaChofer = await api("/auth/mfa/enroll", { token: chofer.body.token, body: {} });
  const secretoChofer = altaChofer.body.enrollment.secret;
  const activaChofer = await api("/auth/mfa/confirm", {
    token: chofer.body.token,
    body: { code: authenticator.generate(secretoChofer) },
  });
  assert(activaChofer.status === 200, "un conductor también puede activarla");
  const desafioChofer = (await login(conductor.email, "otro teléfono")).body.mfaChallenge;
  const respuestas = [];
  for (let intento = 0; intento < 5; intento += 1)
    respuestas.push(
      (
        await api("/auth/mfa/complete", {
          body: { challenge: desafioChofer, code: `ZZ${intento}Z-ZZZZ` },
        })
      ).status,
    );
  const bloqueado = await api("/auth/mfa/complete", {
    body: { challenge: desafioChofer, code: siguiente(secretoChofer) },
  });
  assert(
    respuestas.slice(0, 4).every((status) => status === 401) &&
      respuestas[4] === 429 &&
      bloqueado.status === 429,
    "cinco códigos inválidos bloquean la verificación, aunque después llegue uno bueno",
  );
} finally {
  const ids = Object.values(usuarios).map((user) => user.id);
  const publicos = Object.values(usuarios).map((user) => user.public_id);
  await pool.query("DELETE FROM audit_events WHERE actor_id = ANY($1) OR entity_id = ANY($2)", [
    ids,
    publicos,
  ]);
  await pool.query("DELETE FROM notifications WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM refresh_sessions WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_mfa WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [ids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [ids]);
  await pool.end();
  await closePostgres();
}
