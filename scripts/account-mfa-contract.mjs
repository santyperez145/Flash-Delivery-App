// Verificación en dos pasos de cualquier cuenta (SEG-08): el cableado, sin base.
//
// `test:account-mfa` recorre el flujo contra PostgreSQL. Esto vigila lo que esa
// prueba no ve: que las dos apps pidan el código al ingresar, que el panel esté en
// todas las cuentas (cliente, conductor y comercio, web y teléfono), que las
// acciones sensibles lo manden, y que un código mal escrito dentro de una sesión
// no responda 401 (los clientes renuevan ante un 401, y un administrador que
// renueva vuelve a pasar el segundo factor: quedaría afuera).
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  autenticacion,
  rutas,
  repositorio,
  sesiones,
  pasoExtra,
  comercio,
  cobros,
  borrado,
  webPerfil,
  webPortal,
  webComercio,
  webBorrado,
  webPanel,
  movilApi,
  movilIngreso,
  movilApp,
  movilCliente,
  movilConductor,
  movilComercio,
  movilComercioPantalla,
  movilBorrado,
  movilPanel,
] = await Promise.all(
  [
    "server/http/authentication.js",
    "server/http/auth-router.js",
    "server/mfa-repository.js",
    "server/auth-repository.js",
    "server/http/mfa-step-up.js",
    "server/http/merchant-router.js",
    "server/http/payment-provider-router.js",
    "server/account-deletion-repository.js",
    "src/customer/CustomerProfileScreen.tsx",
    "src/ui/SystemStateScreen.tsx",
    "src/merchant/MerchantConsole.tsx",
    "src/ui/AccountDeletion.tsx",
    "src/ui/TwoStepVerification.tsx",
    "apps/mobile/src/api.ts",
    "apps/mobile/src/screens/LoginScreen.tsx",
    "apps/mobile/App.tsx",
    "apps/mobile/src/screens/CustomerAccountScreen.tsx",
    "apps/mobile/src/screens/DriverScreen.tsx",
    "apps/mobile/src/variant-screen.merchant.tsx",
    "apps/mobile/src/screens/MerchantScreen.tsx",
    "apps/mobile/src/AccountDeletion.tsx",
    "apps/mobile/src/TwoStepVerification.tsx",
  ].map(leer),
);

// --- Servidor -----------------------------------------------------------------
assert.ok(
  contains(rutas, "if (await mfaRequiredFor(user)) {") &&
    contains(rutas, "usesPostgresAuth() && (await getMfaStatus(user.id)).enabled") &&
    !contains(rutas, 'user.roles?.includes("admin") &&\n    (await getAdminMfaStatus'),
  "el ingreso pide el segundo factor a cualquier cuenta que lo activó, no sólo a admin",
);
assert.ok(
  contains(autenticacion, 'if (payload.typ !== "access") return fail(res, 401') &&
    contains(rutas, 'jwt.sign({ typ: "access", sub: user.id'),
  "sólo un token de acceso autentica: el desafío del segundo factor no abre la cuenta",
);
assert.ok(
  !contains(rutas, "requireAdminIdentity") &&
    contains(rutas, 'router.post("/api/auth/mfa/enroll", requireAuth, async'),
  "cualquier cuenta autenticada puede activarla",
);
assert.ok(
  contains(rutas, '!user.roles?.includes("admin") &&') &&
    contains(rutas, "new Date(rotated.mfaVerifiedAt) >= new Date(mfa.confirmedAt)") &&
    contains(rutas, "if (mfa.enabled && !trustedSession) {"),
  "la renovación sólo confía en una sesión que pasó el segundo factor después de activarlo",
);
assert.ok(
  contains(sesiones, "current.rows[0].mfa_verified_at,") &&
    contains(sesiones, "CASE WHEN $5 THEN now() END"),
  "la sesión guarda la marca del segundo factor y la rotación la copia",
);
assert.ok(
  contains(rutas, "revokePostgresSessionsExcept({") &&
    contains(rutas, "keepRefreshToken: session.refreshToken"),
  "activarla cierra las demás sesiones",
);
assert.ok(
  contains(repositorio, "step > Number(row.last_totp_step ?? -1)") &&
    contains(repositorio, "authenticator.clone({ window: 1 })"),
  "un código TOTP sirve una sola vez, con un paso de tolerancia",
);
assert.ok(
  contains(repositorio, "locked ? 429 : invalidStatus") &&
    contains(repositorio, "{ invalidStatus: inSession ? 403 : 401 }") &&
    contains(pasoExtra, "res.status(403).json({") &&
    !contains(pasoExtra, "res.status(401)"),
  "dentro de una sesión, un código inválido o faltante responde 403 y no 401",
);
assert.ok(
  contains(borrado, "if (confirmSecondFactor) await confirmSecondFactor();") &&
    contains(rutas, "confirmSecondFactor: () => stepUpMfa(req, parsed.data.mfaCode)"),
  "eliminar la cuenta pide el código, después de comprobar la contraseña",
);
assert.ok(
  contains(comercio, "await stepUpMfa(req, parsed.data.mfaCode);") &&
    contains(cobros, "await stepUpMfa(req, req.body?.mfaCode);"),
  "autorizar un retiro y desvincular el cobro piden el código",
);
assert.ok(
  contains(rutas, 'router.post("/api/auth/mfa/disable", requireAuth') &&
    contains(rutas, 'router.post("/api/auth/mfa/recovery-codes", requireAuth') &&
    contains(rutas, 'hasRole(req, "admin") && config.requireAdminMfa'),
  "desactivar y regenerar existen, y la política impide a un admin apagarla",
);

// --- Web ----------------------------------------------------------------------
for (const [fuente, donde] of [
  [webPerfil, "perfil del cliente"],
  [webPortal, "portal de otras cuentas"],
]) {
  assert.ok(contains(fuente, "<TwoStepVerification />"), `web: panel en el ${donde}`);
}
assert.ok(
  contains(webComercio, "<TwoStepVerification onChange={sincronizarMfa} />") &&
    contains(webPanel, "if (estado) onChange?.(estado);"),
  "web: activar o apagar en las finanzas del comercio actualiza el campo del código del retiro",
);
assert.ok(
  contains(webPanel, "await disableMfa(codigo)") &&
    contains(webPanel, "await regenerateMfaRecoveryCodes(codigo)") &&
    contains(webPanel, "await api.confirmMfa(codigo)"),
  "web: el panel activa, desactiva y regenera códigos",
);
assert.ok(
  contains(webBorrado, "deleteAccount(password, conCodigo ? codigo : undefined)") &&
    contains(webComercio, "mfaActive ? payoutMfaCode : undefined") &&
    contains(webComercio, "mfaActive ? disconnectMfaCode : undefined"),
  "web: borrar la cuenta, retirar y desvincular mandan el código",
);

// --- Teléfono -------------------------------------------------------------------
assert.ok(
  contains(movilApi, "throw new MfaRequiredError(session.mfaChallenge);") &&
    contains(movilApi, '"/auth/mfa/complete"') &&
    contains(movilIngreso, "if (loginError instanceof MfaRequiredError) {") &&
    contains(movilIngreso, "await onCompleteMfa(mfaChallenge, mfaCode.trim());") &&
    contains(movilApp, "onCompleteMfa={completeMfa}"),
  "teléfono: el ingreso pide el código cuando la cuenta lo tiene activo",
);
assert.ok(
  contains(movilApi, "if (!session.token || !session.refreshToken) {"),
  "teléfono: una renovación que pide el código vuelve al ingreso en vez de guardar un token vacío",
);
assert.ok(
  contains(movilApi, "token = result.token;") && contains(movilApi, '"/auth/mfa/confirm"'),
  "teléfono: al activarla adopta la sesión nueva (el servidor cerró la anterior)",
);
assert.ok(
  contains(movilComercio, "accountFooter={") && contains(movilComercioPantalla, "{accountFooter}"),
  "teléfono: en el comercio, el panel va dentro del scroll de la pestaña Cuenta",
);
for (const [fuente, donde] of [
  [movilCliente, "cliente"],
  [movilConductor, "conductor"],
  [movilComercio, "comercio"],
]) {
  assert.ok(
    contains(fuente, "<TwoStepVerification />"),
    `teléfono: panel en la cuenta del ${donde}`,
  );
}
assert.ok(
  contains(movilPanel, "Linking.openURL(alta.otpauthUri)") &&
    contains(movilBorrado, "deleteAccount(password, conCodigo ? codigo : undefined)"),
  "teléfono: abre la app autenticadora y borrar la cuenta manda el código",
);

console.log("ok - verificación en dos pasos cableada en servidor, web y teléfono");
