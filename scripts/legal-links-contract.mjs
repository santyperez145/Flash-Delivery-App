// Contrato de los enlaces legales (LAN-002).
//
// Las tiendas exigen que la política de privacidad se pueda abrir desde la app, y
// el registro dice que quien continúa acepta los términos. Dos cosas se pueden
// romper sin que ninguna prueba de comportamiento lo note: que una superficie
// deje de mostrar los enlaces, y que el registro vuelva a decir «aceptás» sobre
// documentos que no existen. Este contrato vigila las dos, y ejecuta la
// configuración real para probar que las URLs se leen, se validan y que una
// vacía equivale a no publicada.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";

import { contains } from "./source-contract.mjs";

const ok = (mensaje) => console.log(`ok - ${mensaje}`);
const leer = (ruta) => fs.readFile(ruta, "utf8");

// --- La configuración, ejecutada --------------------------------------------
const legalCon = (env) =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'const { config } = await import("./server/config.js"); console.log(JSON.stringify(config.legal));',
    ],
    { env: { PATH: process.env.PATH, NODE_ENV: "test", ...env }, encoding: "utf8", stdio: "pipe" },
  ).trim();
assert.equal(
  legalCon({ LEGAL_TERMS_URL: "", LEGAL_PRIVACY_URL: "" }),
  JSON.stringify({ termsUrl: null, privacyUrl: null }),
  "una URL vacía en el .env no equivale a no publicada",
);
assert.equal(
  legalCon({
    LEGAL_TERMS_URL: "https://flash.example/terminos",
    LEGAL_PRIVACY_URL: "https://flash.example/privacidad",
  }),
  JSON.stringify({
    termsUrl: "https://flash.example/terminos",
    privacyUrl: "https://flash.example/privacidad",
  }),
  "la configuración no expone las URLs legales",
);
assert.throws(
  () => legalCon({ LEGAL_TERMS_URL: "no-es-una-url" }),
  /LEGAL_TERMS_URL/,
  "la configuración acepta una URL legal inválida",
);
ok("las URLs legales se leen de la configuración, se validan y vacía es «no publicada»");

// En producción son obligatorias y HTTPS: sin ellas no se publica nada que diga
// «aceptás». Se lee la guarda: ejecutarla exige toda la configuración productiva.
const config = await leer("server/config.js");
assert.ok(
  contains(config, '["LEGAL_TERMS_URL", env.LEGAL_TERMS_URL],') &&
    contains(config, '["LEGAL_PRIVACY_URL", env.LEGAL_PRIVACY_URL],') &&
    contains(
      config,
      'if (env.NODE_ENV === "production" && !value?.startsWith("https://")) throw new Error(`${name} must be an HTTPS URL in production`);',
    ),
  "producción arranca sin las URLs legales o sin HTTPS",
);
ok("producción no arranca sin las dos URLs legales en HTTPS");

// --- La ruta pública, montada y documentada ---------------------------------
const ruta = await leer("server/http/legal-router.js");
assert.ok(
  contains(ruta, 'legalRouter.get("/api/public/legal", (_req, res) => {') &&
    contains(ruta, "termsUrl: config.legal.termsUrl, privacyUrl: config.legal.privacyUrl") &&
    contains(await leer("server/index.js"), "app.use(legalRouter);") &&
    contains(await leer("server/openapi-account.js"), '"/api/public/legal": {'),
  "la ruta de los enlaces legales no existe, no está montada o no está documentada",
);
ok("GET /api/public/legal responde la configuración, montada y en OpenAPI");

// --- Ofrecidos donde alguien administra su cuenta ---------------------------
const superficies = [
  ["perfil web del cliente", "src/customer/CustomerProfileScreen.tsx", "<LegalLinks />"],
  ["acceso web de escritorio", "src/ui/SystemStateScreen.tsx", "<LegalLinks />"],
  [
    "cuenta móvil del cliente",
    "apps/mobile/src/screens/CustomerAccountScreen.tsx",
    "<LegalLinks />",
  ],
  [
    "cuenta móvil del repartidor",
    "apps/mobile/src/screens/DriverScreen.tsx",
    '{driverView === "account" && <LegalLinks />}',
  ],
  ["app móvil del comercio", "apps/mobile/src/variant-screen.merchant.tsx", "<LegalLinks />"],
  [
    "registro móvil",
    "apps/mobile/src/screens/LoginScreen.tsx",
    '<LegalLinks variante="aceptacion"',
  ],
];
for (const [nombre, archivo, montaje] of superficies)
  assert.ok(contains(await leer(archivo), montaje), `los enlaces legales no están en ${nombre}`);
ok("los enlaces legales están en web, en las tres apps y en el registro");

// --- Nada falso: sin URL no hay enlace ni «aceptás» -------------------------
const login = await leer("apps/mobile/src/screens/LoginScreen.tsx");
assert.ok(
  !contains(login, "Al continuar aceptás"),
  "el registro afirma la aceptación con un texto fijo, exista o no el documento",
);
const movil = await leer("apps/mobile/src/LegalLinks.tsx");
assert.ok(
  contains(movil, 'if (variante === "aceptacion") return termsUrl && privacyUrl ? (') &&
    contains(movil, "todavía no están publicados."),
  "el registro dice «aceptás» aunque falte alguno de los documentos",
);
for (const archivo of ["src/ui/LegalLinks.tsx", "apps/mobile/src/LegalLinks.tsx"])
  assert.ok(
    contains(await leer(archivo), "todavía sin publicar"),
    `${archivo} no dice que el documento falta cuando no hay URL`,
  );
assert.ok(
  contains(await leer("src/ui/LegalLinks.tsx"), 'target="_blank" rel="noopener noreferrer"'),
  "el enlace web abre otra pestaña con acceso a la que lo abrió",
);
ok("sin URL se dice que falta: ni enlace inventado ni aceptación de lo que no existe");
