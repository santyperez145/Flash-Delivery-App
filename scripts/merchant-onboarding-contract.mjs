// Alta real de comercio (FE-05), del lado de las pantallas: el cableado, sin base.
//
// `test:merchant-applications` recorre la solicitud, la decisión y la creación del
// comercio contra PostgreSQL. Probado además de punta a punta en el navegador: postulación
// en /comercios con geocodificación real, aprobación desde la cola de Altas, consola del
// comercio con «Puesta en marcha», producto y horario. Esto vigila lo que esa prueba no ve:
//
// - /comercios es una ruta pública, con enlaces desde el ingreso y desde la web de cliente;
// - la consola de operaciones tiene Altas y la cola lleva ahí;
// - la puesta en marcha sale de datos reales (horario, productos, MFA, cobros) y no simula
//   la vinculación con Mercado Pago;
// - el horario de una sucursal no se borra solo mientras el comercio lo carga, y cada
//   control tiene un nombre que un lector de pantalla puede decir;
// - el teléfono de la solicitud no queda con «+54 +54».
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  app,
  ingreso,
  portal,
  solicitud,
  consola,
  altas,
  cola,
  puesta,
  horario,
  intervencion,
  perfil,
  repositorio,
] = await Promise.all(
  [
    "src/App.tsx",
    "src/auth/WebLogin.tsx",
    "src/ui/SystemStateScreen.tsx",
    "src/partners/MerchantApplication.tsx",
    "src/backoffice/AdminConsole.tsx",
    "src/backoffice/AdminApplications.tsx",
    "src/backoffice/WorkQueueBoard.tsx",
    "src/merchant/MerchantSetupChecklist.tsx",
    "src/merchant/MerchantCatalogEditors.tsx",
    "src/backoffice/OperationsInterventionPanel.tsx",
    "src/customer/CustomerProfileScreen.tsx",
    "server/merchant-application-repository.js",
  ].map(leer),
);

// --- La postulación es pública y se llega desde el ingreso ------------------------------
assert.ok(
  contains(app, 'const RUTA_COMERCIOS = "/comercios";') &&
    contains(app, "<MerchantApplicationPage"),
  "/comercios abre la solicitud de alta",
);
assert.ok(
  contains(ingreso, 'href="/comercios"') && contains(ingreso, "¿Tenés un comercio? Sumalo a Flash"),
  "el ingreso ofrece sumar un comercio",
);
assert.ok(
  contains(portal, 'href="/comercios"'),
  "la web de cliente en escritorio no es un callejón sin salida",
);
assert.ok(
  contains(solicitud, "await api.submitMerchantApplication(") ||
    contains(solicitud, "api.submitMerchantApplication("),
  "la solicitud se envía al servidor real",
);
assert.ok(
  contains(solicitud, 'event.target.value.replace(/^\\+54\\s*(?=\\+)/, "")'),
  "el teléfono no queda con «+54 +54» si la persona escribe su propio prefijo",
);

// --- Operaciones decide desde Altas ----------------------------------------------------
assert.ok(
  contains(consola, '["applications", "Altas", ClipboardCheck],') &&
    contains(consola, "<AdminApplications"),
  "la consola de operaciones tiene la sección Altas",
);
assert.ok(
  contains(altas, "api.getAdminMerchantApplications({ status, cursor: nextCursor })") &&
    contains(altas, "await api.decideMerchantApplication(solicitud.id, {"),
  "Altas lista con paginación y decide con el servidor",
);
assert.ok(
  contains(consola, 'merchant_applications: "applications",') &&
    contains(cola, "onClick={() => navegacion?.abrir(cola.key)}"),
  "la cola de solicitudes lleva a Altas",
);
assert.ok(
  contains(intervencion, '"Sin motivo ni fecha registrados"') &&
    !contains(intervencion, "Suspendido en esta sesión"),
  "el estado de un comercio sale del servidor, no de la sesión del navegador",
);

// --- La puesta en marcha mira datos reales -----------------------------------------------
assert.ok(
  contains(puesta, "api.getMfaStatus(),") &&
    contains(puesta, "api.getMerchantPaymentConnection(restaurant.id),") &&
    contains(puesta, "(sucursal) => !sucursal.weeklyHours.some((franja) => franja.enabled),"),
  "la puesta en marcha sale del horario, el segundo factor y los cobros reales",
);
assert.ok(
  contains(puesta, 'estado: mfa.estado === "ok" ? (mfa.valor ? "hecho" : "pendiente") : "borde",'),
  "si una lectura falla, el paso no se da por hecho",
);

// --- El horario no se borra solo, y se puede leer ---------------------------------------
assert.ok(
  contains(horario, "const horarioGuardado = JSON.stringify(branch.weeklyHours ?? []);") &&
    contains(horario, "}, [branch.id, branch.timezone, horarioGuardado]);") &&
    !contains(horario, "}, [branch.id, branch.timezone, branch.weeklyHours]);"),
  "el formulario de horario se reinicia sólo si el horario guardado cambió",
);
assert.ok(
  contains(horario, "aria-label={`Abrir el ${fullDayNames[hour.weekday]}`}") &&
    contains(horario, "aria-label={`Apertura del ${fullDayNames[hour.weekday]}`}") &&
    contains(horario, "aria-label={`Cierre del ${fullDayNames[hour.weekday]}`}"),
  "cada día y cada hora del horario tiene nombre",
);

// --- Lo que pidió la revisión del PR ---------------------------------------------------
assert.ok(
  contains(altas, ") : items.length === 0 && !nextCursor ? ("),
  "decidir toda la página no esconde las solicitudes que quedan en el servidor",
);
assert.ok(
  contains(solicitud, "const intervalo = window.setInterval(() => void releer(), 30_000);") &&
    contains(solicitud, 'document.addEventListener("visibilitychange", alVolver);'),
  "la solicitud abierta se actualiza sola mientras espera una decisión",
);
assert.ok(
  contains(perfil, '<a className="profile-partner-link" href="/comercios">'),
  "quien pide desde la web también encuentra cómo sumar su comercio",
);

const decidir = repositorio.slice(
  repositorio.indexOf("export async function decideMerchantApplication"),
);
assert.ok(
  contains(
    decidir,
    "pg_advisory_xact_lock(hashtextextended('merchant_application:' || $1::text, 0))",
  ) &&
    contains(decidir, "[solicitante.applicant_id],") &&
    squeeze(decidir).indexOf(squeeze("pg_advisory_xact_lock")) <
      squeeze(decidir).indexOf(squeeze("FROM merchant_applications WHERE public_id=$1 FOR UPDATE")),
  "aprobar toma el candado de la persona antes que la fila: un envío simultáneo no se cuela",
);

assert.ok(
  contains(altas, "if (pestanaVigente.current !== status) return;"),
  "una decisión que vuelve después de cambiar de pestaña no pisa la lista nueva",
);

console.log("merchant onboarding contract ok");
