// Modo staging (INF-002): producción endurecida sin las cuentas de terceros.
//
// Staging es un despliegue real (NODE_ENV=production) que todavía no tiene Google Maps,
// SMTP, Twilio, Expo ni Mercado Pago. Esto prueba la configuración en procesos aparte,
// con el entorno de cada caso:
//
// - producción con proveedores de prueba **no arranca** (nada cambió para producción);
// - staging con proveedores de prueba arranca;
// - staging **sigue exigiendo** los secretos propios: con uno por defecto no arranca;
// - los códigos de verificación sólo se muestran en staging si se pide a mano;
// - staging permite pagos de prueba y direcciones sin proveedor comercial; producción no.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

// Secretos propios, todos distintos de los valores locales que producción rechaza.
const secretos = {
  JWT_SECRET: "jwt-secret-de-prueba-staging-0123456789",
  DATABASE_URL: "postgresql://flash_runtime:clave@127.0.0.1:5432/flash",
  PAYMENT_WEBHOOK_SECRET: "webhook-secret-de-prueba-staging-0123456789",
  METRICS_TOKEN: "metrics-token-de-prueba-staging-0123456789",
  PUSH_TOKEN_ENCRYPTION_KEY: "push-key-de-prueba-staging-0123456789",
  DELIVERY_PIN_SECRET: "delivery-pin-de-prueba-staging-0123456789",
  MFA_ENCRYPTION_KEY: "mfa-key-de-prueba-staging-0123456789",
  KYC_DOCUMENT_ENCRYPTION_KEY: "kyc-key-de-prueba-staging-0123456789",
  DELIVERY_PROOF_ENCRYPTION_KEY: "proof-key-de-prueba-staging-0123456789",
  RECOVERY_TOKEN_ENCRYPTION_KEY: "recovery-key-de-prueba-staging-0123456789",
  FEATURE_FLAG_SALT: "flag-salt-de-prueba-staging-0123456789-abcdef",
  PAYMENT_OAUTH_ENCRYPTION_KEY: "oauth-key-de-prueba-staging-0123456789",
  REQUIRE_ADMIN_MFA: "true",
  CORS_ORIGIN: "https://flash-web-staging.example.run.app",
};
// Proveedores de prueba: lo que staging admite y producción no.
const proveedoresDePrueba = {
  MAPS_PROVIDER: "openstreetmap",
  NOTIFICATION_PROVIDER: "sandbox",
  EMAIL_PROVIDER: "sandbox",
  PHONE_VERIFY_PROVIDER: "sandbox",
  PAYMENT_MARKETPLACE_PROVIDER: "disabled",
};

const leerConfig = (entorno) => {
  const salida = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { config } = await import("./server/config.js");
       console.log(JSON.stringify({
         isProduction: config.isProduction, isStaging: config.isStaging,
         deployStage: config.deployStage, exposeDevelopmentCodes: config.exposeDevelopmentCodes,
         exposeRecoveryTokens: config.exposeRecoveryTokens,
         requireCommercialGeocoding: config.requireCommercialGeocoding,
         allowSandboxPayments: config.allowSandboxPayments, allowSandboxTopups: config.allowSandboxTopups,
       }));`,
    ],
    // Sin el entorno del que corre la prueba: cada caso arranca de cero.
    {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...entorno },
      encoding: "utf8",
    },
  );
  if (salida.status !== 0)
    return { error: salida.stderr.split("\n").find((l) => l.includes("Error")) || salida.stderr };
  return JSON.parse(salida.stdout.trim().split("\n").at(-1));
};

const produccion = leerConfig({ NODE_ENV: "production", ...secretos, ...proveedoresDePrueba });
assert.ok(produccion.error, "producción con proveedores de prueba no arranca");

const staging = leerConfig({
  NODE_ENV: "production",
  DEPLOY_STAGE: "staging",
  ...secretos,
  ...proveedoresDePrueba,
});
assert.ok(!staging.error, `staging con proveedores de prueba arranca (${staging.error ?? ""})`);
assert.equal(staging.isProduction, true, "staging corre como producción");
assert.equal(staging.isStaging, true);
assert.equal(staging.deployStage, "staging");
assert.equal(staging.exposeDevelopmentCodes, false, "staging no muestra códigos si no se pide");
assert.equal(
  staging.requireCommercialGeocoding,
  false,
  "staging admite direcciones sin proveedor comercial",
);
assert.equal(staging.allowSandboxPayments, true, "staging admite pagos de prueba");

const conCodigos = leerConfig({
  NODE_ENV: "production",
  DEPLOY_STAGE: "staging",
  STAGING_EXPOSE_DEV_CODES: "true",
  ...secretos,
  ...proveedoresDePrueba,
});
assert.equal(conCodigos.exposeDevelopmentCodes, true, "staging muestra códigos sólo si se pide");
// Aun con los códigos visibles, el token de recuperación no: con sólo saber el email de
// alguien se le cambiaría la contraseña.
assert.equal(
  conCodigos.exposeRecoveryTokens,
  false,
  "staging nunca muestra tokens de recuperación",
);
assert.equal(staging.exposeRecoveryTokens, false);

const stagingSinSecreto = leerConfig({
  NODE_ENV: "production",
  DEPLOY_STAGE: "staging",
  ...secretos,
  ...proveedoresDePrueba,
  JWT_SECRET: undefined,
});
assert.ok(stagingSinSecreto.error, "staging con el secreto JWT por defecto no arranca");

const stagingSinMfa = leerConfig({
  NODE_ENV: "production",
  DEPLOY_STAGE: "staging",
  ...secretos,
  ...proveedoresDePrueba,
  REQUIRE_ADMIN_MFA: "false",
});
assert.ok(stagingSinMfa.error, "staging exige el segundo factor de operaciones");

const stagingLegalHttp = leerConfig({
  NODE_ENV: "production",
  DEPLOY_STAGE: "staging",
  ...secretos,
  ...proveedoresDePrueba,
  LEGAL_TERMS_URL: "http://inseguro.example/terminos",
});
assert.ok(stagingLegalHttp.error, "en staging un documento legal, si está, tiene que ser HTTPS");

const local = leerConfig({});
assert.equal(local.deployStage, "local");
assert.equal(
  local.exposeDevelopmentCodes,
  true,
  "en desarrollo local los códigos se muestran como antes",
);
assert.equal(local.requireCommercialGeocoding, false);
assert.equal(
  local.exposeRecoveryTokens,
  true,
  "en desarrollo local el token se muestra como antes",
);

// El servidor usa la bandera de recuperación, y la web compilada llama a la API del mismo
// origen (en Cloud Run la misma API sirve la web).
const fuente = (ruta) => fs.readFileSync(ruta, "utf8").replace(/\s+/g, "");
assert.ok(
  fuente("server/http/auth-router.js").includes("...(config.exposeRecoveryTokens&&recovery"),
  "la recuperación usa su propia bandera",
);
assert.ok(
  fuente("src/api.ts").includes(
    'import.meta.env.VITE_API_URL||(import.meta.env.DEV?"http://127.0.0.1:4000/api":"/api");',
  ),
  "la web compilada llama a /api del mismo origen",
);
const terraform = fuente("infra/gcp/main.tf");
assert.ok(
  terraform.includes('EMAIL_PROVIDER=var.staging_smtp?"smtp":"sandbox"') &&
    terraform.includes(
      "terceros_en_staging=var.staging_smtp?setsubtract(local.secretos_de_terceros,local.secretos_smtp):local.secretos_de_terceros",
    ),
  "staging puede usar un SMTP real y entonces monta sus secretos",
);

console.log("staging config contract ok");
