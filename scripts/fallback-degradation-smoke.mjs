// Ninguna ruta responde 500 sobre el respaldo SQLite (tickets ARC-001 y CI-001).
//
// El runtime de respaldo es el que corre el job `local-fallback` de CI y la
// máquina de cualquier persona que clone el repositorio sin PostgreSQL. Una
// ruta que ahí revienta con 500 no es un detalle de desarrollo: es la
// diferencia entre poder trabajar en el proyecto y no poder.
//
// El defecto tiene una forma reconocible y ya documentada en `PUT /api/cart`:
// el handler llama a un repositorio de PostgreSQL sin preguntar antes por
// `usesPostgresCommerce()`, el pool es `null`, el repositorio lanza un
// `TypeError` y el `catch` lo convierte en 500. El comentario de aquella
// corrección lo dice mejor de lo que se puede resumir: **un 503 que dice por
// qué es honesto; un 500 con un TypeError no.**
//
// Se encontró levantando la aplicación de conductor en un navegador. Ninguna
// puerta estática lo veía, porque estáticamente el código es válido: la llamada
// existe, el nombre está importado y el error está capturado.
//
// Lo que se prueba es la degradación, no la funcionalidad. Una ruta puede
// responder 200 con datos vacíos, 400 por parámetros, 401, 403, 404 o 503
// porque necesita PostgreSQL. Lo único inadmisible es 500: significa que el
// servidor no anticipó su propio runtime.
import { spawn } from "node:child_process";
import { waitForHealthy } from "./wait-for-api.mjs";

const PUERTO = Number(process.env.FALLBACK_PROBE_PORT || 4399);
const BASE = `http://127.0.0.1:${PUERTO}/api`;
const CLAVE = "demo123";

// Una cuenta por audiencia: una ruta puede degradar bien para el cliente y
// reventar para el conductor, que es exactamente lo que pasó.
const CUENTAS = [
  { rol: "customer", email: "cliente@flash.app" },
  { rol: "driver", email: "conductor@flash.app" },
  { rol: "merchant", email: "comercio@flash.app" },
  { rol: "admin", email: "ops@flash.app" },
];

// Rutas GET con los parámetros que necesitan. El identificador sale de la
// sesión donde la ruta lo admite; donde no, se usa el sembrado.
const RUTAS = [
  "/health",
  "/openapi.json",
  "/bootstrap/customer",
  "/me",
  "/me/activity?limit=10",
  "/me/sessions",
  "/me/assigned-drivers",
  "/referrals/me",
  "/catalog/restaurants?limit=10",
  "/restaurants",
  "/cities",
  "/zones",
  "/pricing",
  "/promotions",
  "/shipment-options",
  "/features",
  "/favorites",
  "/ratings",
  "/notifications",
  "/notification-preferences",
  "/dietary-preferences",
  "/addresses",
  "/payment-methods",
  "/support/tickets",
  "/cart",
  "/driver/me",
  "/driver/earnings",
  "/driver/demand-zones",
  "/driver/preferences",
  "/driver/offers",
  "/drivers/drv_lautaro/compliance",
  "/drivers/drv_lautaro/vehicles",
  "/merchant/me",
  "/merchant/dashboard",
  "/merchant/orders/active",
  "/merchant/finance",
  "/merchant/payment-provider",
  "/shipment-returns",
  "/shipment-claims",
  "/operations/restaurants?limit=10",
  "/operations/drivers?limit=10",
  "/operations/users?limit=10",
  "/operations/support-tickets?limit=10",
  "/operations/audit-events?limit=10",
  "/operations/feature-flags",
  "/operations/product-metrics",
  "/admin/dashboard",
  "/admin/tip-adjustments",
  "/admin/pricing-changes",
  "/admin/payouts",
  "/admin/payment-reconciliation",
  "/admin/transaction-risks",
  "/admin/notifications/dead-letters",
  "/admin/support/agents",
  "/admin/service-chat/quick-replies",
];

// `DATABASE_URL` se quita del entorno, no se vacía: la validación de
// `config.js` rechaza una cadena vacía como URL inválida, que es lo correcto
// —una variable presente y vacía es casi siempre un error de despliegue— pero
// significa que ausente y vacía no son lo mismo.
const entorno = { ...process.env };
delete entorno.DATABASE_URL;

const hijo = spawn(process.execPath, ["server/start.js"], {
  cwd: process.cwd(),
  env: {
    ...entorno,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    PORT: String(PUERTO),
    RATE_LIMIT_MAX: "5000",
    AUTH_RATE_LIMIT_MAX: "500",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
hijo.stderr.on("data", (dato) => process.stderr.write(dato));

const quinientos = [];
let sondeos = 0;
try {
  await waitForHealthy(`${BASE}/ready`);

  for (const cuenta of CUENTAS) {
    const acceso = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: cuenta.email, password: CLAVE }),
    });
    const sesion = await acceso.json();
    if (!sesion.token) {
      throw new Error(`no se pudo iniciar sesión como ${cuenta.rol}: ${sesion.message}`);
    }

    for (const ruta of RUTAS) {
      const respuesta = await fetch(`${BASE}${ruta}`, {
        headers: { authorization: `Bearer ${sesion.token}` },
      });
      sondeos += 1;
      // 503 es la respuesta correcta y no un fallo: dice que la ruta necesita
      // PostgreSQL y que este runtime no lo tiene. Lo que se persigue es 500,
      // que significa que nadie previó el caso.
      if (respuesta.status >= 500 && respuesta.status !== 503) {
        const cuerpo = await respuesta.json().catch(() => ({}));
        quinientos.push(`${cuenta.rol} GET ${ruta} → ${respuesta.status} ${cuerpo.message || ""}`);
      }
    }
  }
} finally {
  hijo.kill("SIGTERM");
}

if (quinientos.length) {
  console.error(`${quinientos.length} respuesta(s) 5xx sobre el respaldo SQLite:\n`);
  for (const caso of quinientos) console.error(`  - ${caso}`);
  console.error("\nUna ruta que necesita PostgreSQL degrada con 503 y un mensaje que lo dice.");
  console.error("Preguntá por `usesPostgresCommerce()` antes de llamar al repositorio.");
  process.exit(1);
}

console.log(`ok - ${sondeos} sondeos sobre el respaldo SQLite sin ninguna respuesta 500`);
console.log(`     ${RUTAS.length} rutas × ${CUENTAS.length} audiencias`);
