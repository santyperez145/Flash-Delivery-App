// Alta de repartidores en las pantallas (FE-06).
//
// `test:driver-applications` prueba el servidor contra PostgreSQL. Esto vigila que las
// pantallas sigan cableadas a eso:
//
// - /repartir existe, se llega desde el ingreso, y el ingreso dice que es para repartir;
// - la postulación pide el teléfono verificado antes que nada y no lo guarda por el
//   perfil (que exige una dirección): lo manda con el pedido del código;
// - una bicicleta no pide patente, llevar pasajeros sólo con auto;
// - cada requisito es una fila con su estado y su acción, con el motivo del rechazo a la
//   vista, y las fotos se achican antes de subir;
// - operaciones revisa desde una sola cola paginada, abre el documento recién al pedirlo
//   y rechaza con motivo; pasa sola al siguiente;
// - lo que se pide depende del vehículo, y salir en moto exige los papeles de la moto;
// - en ninguna pantalla queda un « · » colgando donde una bici no tiene patente.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [
  app,
  login,
  pagina,
  documentos,
  cola,
  consola,
  api,
  router,
  repositorio,
  legajo,
  telefono,
  operaciones,
  movil,
] = await Promise.all(
  [
    "src/App.tsx",
    "src/auth/WebLogin.tsx",
    "src/partners/DriverApplication.tsx",
    "src/partners/driverDocuments.ts",
    "src/backoffice/AdminDriverApplications.tsx",
    "src/backoffice/AdminConsole.tsx",
    "src/api.ts",
    "server/http/applications-router.js",
    "server/driver-application-repository.js",
    "server/compliance-repository.js",
    "server/phone-verification-repository.js",
    "src/operations/OperationsSurface.tsx",
    "apps/mobile/src/screens/DriverAccountPanel.tsx",
  ].map(leer),
);

// --- La ruta y el ingreso --------------------------------------------------------------
assert.ok(
  contains(app, 'const RUTA_REPARTIR = "/repartir";') &&
    contains(app, "if (enRepartir && activeUser) {") &&
    contains(app, 'contexto={enComercios ? "comercio" : enRepartir ? "repartidor" : undefined}') &&
    contains(app, "onRepartir={abrirRepartir}"),
  "/repartir existe y el ingreso sabe que se viene a repartir",
);
assert.ok(
  contains(login, 'href="/repartir"') &&
    contains(login, "¿Querés repartir? Postulate") &&
    contains(login, 'accion: "Ingresá para postularte",'),
  "el ingreso ofrece postularse y lo dice cuando se llega desde /repartir",
);

// --- La postulación ----------------------------------------------------------------------
assert.ok(
  contains(
    pagina,
    "if (!verificado) return <VerificarTelefono user={user} onVerificado={() => setVerificado(true)} />;",
  ) &&
    contains(pagina, "const respuesta = await api.requestPhoneVerification(normalizado);") &&
    !contains(pagina, "api.updateProfile(") &&
    contains(
      telefono,
      "export async function requestPhoneVerification(userPublicId, { phone } = {}) {",
    ),
  "el teléfono se verifica antes de postularse, sin pasar por el perfil",
);
assert.ok(
  contains(pagina, 'plate: kind === "bicycle" ? null : plate.trim().toUpperCase(),') &&
    contains(pagina, '{kind !== "bicycle" && (') &&
    contains(pagina, 'services: kind === "car" && viajes ? ["delivery", "ride"] : ["delivery"],') &&
    contains(router, 'message: "Una bicicleta no lleva patente",') &&
    contains(router, 'message: "Para llevar pasajeros necesitás un auto y declarar sus asientos",'),
  "una bici no lleva patente y pasajeros sólo con auto, en la pantalla y en el servidor",
);

// --- Los requisitos ---------------------------------------------------------------------
assert.ok(
  contains(pagina, "{legajo.requiredTypes.map((tipo) => (") &&
    contains(pagina, '? `Rechazado: ${documento?.rejectionReason || "sin motivo"}`') &&
    contains(pagina, ": await achicarFoto(seleccionado);") &&
    contains(pagina, "if (info.vence && (!vence || vence < hoy))") &&
    contains(documentos, 'label: "Certificado de antecedentes penales",'),
  "cada requisito muestra su estado y su motivo, las fotos se achican y lo que vence pide fecha",
);
assert.ok(
  contains(
    legajo,
    'kinds.length && kinds.every((kind) => kind === "bicycle") ? TIPOS_BICICLETA : requiredTypes;',
  ) &&
    contains(legajo, 'const TIPOS_BICICLETA = ["identity", "background_check"];') &&
    contains(
      legajo,
      "if (row.motorized && row.has_documents && row.motor_documents < TIPOS_CON_MOTOR.length)",
    ),
  "lo que se pide depende del vehículo, y salir en moto exige sus papeles",
);
assert.ok(
  contains(repositorio, "if (!persona.phone_verified_at)") &&
    contains(
      repositorio,
      "INSERT INTO user_roles(user_id, role) VALUES($1, 'driver') ON CONFLICT DO NOTHING",
    ) &&
    contains(repositorio, "'{driverId}',to_jsonb($2::text),true)") &&
    contains(repositorio, "VALUES($1, $2, false, $3::job_kind, $4::job_kind[], $5, $6)"),
  "la postulación exige teléfono verificado y crea al conductor desconectado, con su rol y su sesión",
);

// --- La cola de operaciones -------------------------------------------------------------
assert.ok(
  contains(api, "`/admin/driver-applications?${query.toString()}`") &&
    contains(
      cola,
      "const pagina = await api.getAdminDriverApplications({ status: estado, cursor });",
    ) &&
    !contains(cola, "getDriverCompliance(") &&
    contains(cola, "const respuesta = await api.getDriverDocumentContent(documento.id);") &&
    contains(cola, "URL.revokeObjectURL(vista.url)"),
  "la cola es un solo pedido paginado y el documento se abre recién al pedirlo",
);
assert.ok(
  contains(cola, "const valido = motivo.trim().length >= 5 && motivo.trim().length <= 500;") &&
    contains(cola, "disabled={!valido || enviando}") &&
    contains(cola, 'sigue && (estado !== "pending" || pendientes(sigue))') &&
    contains(consola, "<AdminDriverApplications"),
  "rechazar pide motivo y la cola pasa sola al siguiente",
);

// --- Sin patente no queda un separador colgando -----------------------------------------
assert.ok(
  contains(operaciones, '{driver.plate ? ` · ${driver.plate}` : ""}') &&
    contains(movil, '{vehicle.plate ? ` · ${vehicle.plate}` : ""}') &&
    contains(movil, 'plate: vehicleDraft.kind === "bicycle" ? null : vehicleDraft.plate.trim(),'),
  "una bici sin patente no deja « · » colgando y la app permite cargarla",
);

// --- Lo que encontró la revisión del PR ---------------------------------------------
assert.ok(
  contains(
    documentos,
    'ayuda: "La cédula verde o azul, con su fecha de vencimiento.", vence: true,',
  ),
  "la cédula pide vencimiento, como exige el servidor",
);
assert.ok(
  contains(telefono, "u.phone user_phone") &&
    contains(telefono, "if (row.phone !== row.user_phone) {") &&
    contains(telefono, "WHERE user_id IN (SELECT id FROM cambiado) AND consumed_at IS NULL"),
  "el código de un número no verifica otro",
);
assert.ok(
  contains(cola, 'key={`${tipo}-${documento(tipo)?.id ?? "falta"}`}') &&
    contains(cola, "if (!montado.current) return;") &&
    contains(cola, "for (let leidas = 0; leidas < paginas.current; leidas += 1) {"),
  "la vista sigue al documento y refrescar no pierde las páginas cargadas",
);
assert.ok(
  contains(pagina, "{!ciudades && errorCiudades && (") &&
    contains(
      pagina,
      'legajo.requiredTypes.every((tipo) => actual(tipo)?.status === "approved");',
    ) &&
    contains(
      pagina,
      "<CorregirVehiculo vehiculo={vehiculo} onCorregido={() => void releer()} />",
    ) &&
    contains(legajo, 'status: row.vencido ? "expired" : row.status,'),
  "las ciudades que no cargan se reintentan, un vencido no dice «listo» y un vehículo rechazado se corrige",
);

assert.ok(
  squeeze(repositorio).indexOf(
    squeeze("SELECT pg_advisory_xact_lock(hashtextextended('driver_application:'"),
  ) <
    squeeze(repositorio).indexOf(
      squeeze("FROM users WHERE public_id=$1 AND status='active' FOR SHARE"),
    ) && contains(cola, "if (pestanaVigente.current !== pedida) return;"),
  "dos envíos a la vez no se traban, y una página de otra pestaña no se mezcla",
);

assert.ok(
  contains(legajo, "THEN $4::text[] ELSE $5::text[] END)) expired,") &&
    contains(
      legajo,
      "[driverPublicId, activeMode, TIPOS_CON_MOTOR, TIPOS_BICICLETA, requiredTypes],",
    ),
  "un vencido bloquea sólo si es de lo que piden los vehículos de hoy, como lo muestra la pantalla",
);

console.log("driver onboarding contract ok");
