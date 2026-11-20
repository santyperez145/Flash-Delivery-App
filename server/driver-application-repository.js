// Alta real de repartidores y conductores (FE-06).
//
// Como en Uber y Uber Eats, postularse es empezar: quien se postula ya es conductor,
// pero **sin poder conectarse**. La postulación crea en una transacción el conductor
// desconectado, su legajo en `pending` y su vehículo en revisión, y le da el rol
// `driver` para que pueda subir sus documentos. Conectarse sigue exigiendo el legajo
// aprobado y vigente y un vehículo aprobado (`assertDriverCanGoOnline`): el rol sólo
// abre la carga de requisitos, no las ofertas.
//
// Se pide el teléfono verificado antes de postularse: es por donde operaciones y
// clientes contactan a quien reparte, y lo que impide anotar cuentas de a montones.
//
// La cola de operaciones es una sola consulta paginada que trae, por conductor, sus
// documentos vigentes y sus vehículos: revisar no hace un pedido por fila.
import crypto from "node:crypto";

import { requiredTypesForKinds } from "./compliance-repository.js";
import { postgresPool } from "./postgres.js";

const hex = (bytes) => crypto.randomBytes(bytes).toString("hex").toUpperCase();
const error = (mensaje, status, extra = {}) =>
  Object.assign(new Error(mensaje), { status, ...extra });

export const DRIVER_APPLICATION_VEHICLES = ["bicycle", "motorcycle", "car"];
export const DRIVER_QUEUE_STATUSES = ["pending", "approved", "rejected"];
const POR_PAGINA = 25;

const enTransaccion = async (trabajo) => {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (fallo) {
    await client.query("ROLLBACK");
    throw fallo;
  } finally {
    client.release();
  }
};

const fecha = (valor) => (valor ? new Date(valor).toISOString() : null);
const dia = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : null);
const modos = (valor) =>
  (Array.isArray(valor)
    ? valor
    : String(valor || "")
        .replace(/^\{|\}$/g, "")
        .split(",")
  )
    .filter(Boolean)
    .map(String);

/**
 * La postulación. Los datos llegan validados por el router. Una por persona: el
 * candado por cuenta evita que dos envíos simultáneos creen dos conductores.
 */
export async function submitDriverApplication({ userPublicId, actorRoles, input, requestId }) {
  return enTransaccion(async (client) => {
    const persona = (
      await client.query(
        "SELECT id, public_id, name, phone, phone_verified_at FROM users WHERE public_id=$1 AND status='active' FOR SHARE",
        [userPublicId],
      )
    ).rows[0];
    if (!persona) throw error("Usuario no encontrado", 404);
    if (!persona.phone_verified_at)
      throw error("Verificá tu teléfono antes de postularte", 409, {
        code: "phone_verification_required",
      });
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('driver_application:' || $1::text, 0))",
      [persona.id],
    );
    const existente = (
      await client.query("SELECT public_id FROM drivers WHERE user_id=$1", [persona.id])
    ).rows[0];
    if (existente)
      throw error("Ya estás registrado para repartir: completá tus requisitos", 409, {
        driverId: existente.public_id,
      });
    // Sólo ciudades abiertas al público, las mismas que lista `getPublicCities`.
    const ciudad = (
      await client.query(
        "SELECT id, enabled_services FROM cities WHERE public_id=$1 AND status IN ('beta','active')",
        [input.cityId],
      )
    ).rows[0];
    if (!ciudad) throw error("Flash todavía no opera en esa ciudad", 400);

    const servicios = input.services;
    const driverPublicId = `DRV-${hex(5)}`;
    const conductor = (
      await client.query(
        `INSERT INTO drivers(public_id, user_id, online, active_mode, service_modes, city_id, metadata)
         VALUES($1, $2, false, $3::job_kind, $4::job_kind[], $5, $6)
         RETURNING id`,
        [
          driverPublicId,
          persona.id,
          servicios.includes("delivery") ? "delivery" : "ride",
          servicios,
          ciudad.id,
          { name: persona.name, onboarding: "application" },
        ],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO driver_compliance(driver_id, status, updated_at) VALUES($1, 'pending', now())",
      [conductor.id],
    );
    const vehiclePublicId = `VEH-${hex(6)}`;
    try {
      await client.query(
        `INSERT INTO vehicles(public_id, driver_id, kind, model, plate, color, seats, service_modes, active)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8::job_kind[], true)`,
        [
          vehiclePublicId,
          conductor.id,
          input.vehicle.kind,
          input.vehicle.model,
          input.vehicle.plate ? input.vehicle.plate.toUpperCase() : null,
          input.vehicle.color || null,
          input.vehicle.seats || null,
          servicios,
        ],
      );
    } catch (fallo) {
      if (fallo.code === "23505") throw error("Esa patente ya está registrada en Flash", 409);
      throw fallo;
    }
    await client.query(
      "INSERT INTO user_roles(user_id, role) VALUES($1, 'driver') ON CONFLICT DO NOTHING",
      [persona.id],
    );
    // La sesión reconoce a su conductor por `profile.driverId` (`canActAsDriver`): sin
    // esto tendría el rol y no podría subir sus documentos.
    await client.query(
      "UPDATE users SET profile=jsonb_set(COALESCE(profile,'{}'::jsonb),'{driverId}',to_jsonb($2::text),true), updated_at=now() WHERE id=$1",
      [persona.id, driverPublicId],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id, actor_roles, action, entity_type, entity_id, request_id, after_data)
       VALUES($1, $2::user_role[], 'driver_application.submitted', 'driver', $3, $4, $5)`,
      [
        persona.id,
        actorRoles || [],
        driverPublicId,
        requestId || null,
        { vehicleId: vehiclePublicId, kind: input.vehicle.kind, services: servicios },
      ],
    );
    return { driverId: driverPublicId, vehicleId: vehiclePublicId };
  });
}

/** La postulación de la persona: su conductor, el estado del legajo y lo que falta. */
export async function getMyDriverApplication(userPublicId) {
  const fila = (
    await postgresPool.query(
      `SELECT d.public_id, d.service_modes, d.created_at, c.status, c.rejection_reason,
              ci.public_id city_id, ci.name city_name
       FROM drivers d JOIN users u ON u.id=d.user_id
       LEFT JOIN driver_compliance c ON c.driver_id=d.id
       LEFT JOIN cities ci ON ci.id=d.city_id
       WHERE u.public_id=$1`,
      [userPublicId],
    )
  ).rows[0];
  if (!fila) return null;
  return {
    driverId: fila.public_id,
    services: modos(fila.service_modes),
    status: fila.status || "pending",
    rejectionReason: fila.rejection_reason || null,
    city: fila.city_id ? { id: fila.city_id, name: fila.city_name } : null,
    createdAt: fecha(fila.created_at),
  };
}

/** El cursor viaja en base64url y se valida al desarmarlo: uno con otra forma es 400. */
export function parseDriverQueueCursor(valor) {
  if (!valor) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(valor), "base64url").toString("utf8"));
    if (
      typeof cursor.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(cursor.id) ||
      typeof cursor.createdAt !== "string" ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(cursor.createdAt)
    )
      return false;
    return cursor;
  } catch {
    return false;
  }
}

// «Para revisar» es tener un documento vigente o un vehículo esperando a operaciones.
// Aprobados y rechazados se leen del legajo.
const FILTROS = {
  pending: `(EXISTS(SELECT 1 FROM driver_documents doc WHERE doc.driver_id=d.id AND doc.status='pending')
             OR EXISTS(SELECT 1 FROM vehicles v WHERE v.driver_id=d.id AND v.retired_at IS NULL AND v.status='pending'))`,
  approved: "c.status='approved'",
  rejected: "c.status='rejected'",
};

/**
 * La cola de legajos, de a 25, del conductor más viejo al más nuevo. Trae los
 * documentos que cuentan (pendientes, aprobados y rechazados; no los reemplazados) sin
 * su contenido, que se pide aparte y sólo al abrirlo.
 */
export async function listDriverApplicationsForReview({ status, cursor }) {
  const filas = (
    await postgresPool.query(
      `SELECT d.id, d.public_id, d.service_modes, d.created_at,
              to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at,
              u.public_id user_public_id, u.name, u.email, u.phone, u.phone_verified_at,
              c.status compliance_status, c.rejection_reason, ci.name city_name,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', doc.public_id, 'type', doc.document_type, 'mimeType', doc.mime_type,
                  'sizeBytes', doc.size_bytes, 'expiresAt', doc.expires_at,
                  'status', CASE WHEN doc.status='approved' AND doc.expires_at<current_date
                                 THEN 'expired' ELSE doc.status END,
                  'rejectionReason', doc.rejection_reason, 'createdAt', doc.created_at)
                ORDER BY doc.created_at)
                FROM driver_documents doc
                WHERE doc.driver_id=d.id AND doc.status IN ('pending','approved','rejected')), '[]') documents,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', v.public_id, 'kind', v.kind, 'model', v.model, 'plate', v.plate,
                  'color', v.color, 'seats', v.seats, 'status', v.status,
                  'rejectionReason', v.rejection_reason, 'active', v.active)
                ORDER BY v.created_at)
                FROM vehicles v WHERE v.driver_id=d.id AND v.retired_at IS NULL), '[]') vehicles
       FROM drivers d
       JOIN users u ON u.id=d.user_id
       LEFT JOIN driver_compliance c ON c.driver_id=d.id
       LEFT JOIN cities ci ON ci.id=d.city_id
       WHERE ${FILTROS[status]}
         AND ($1::timestamptz IS NULL OR (d.created_at, d.id) > ($1::timestamptz, $2::uuid))
       ORDER BY d.created_at, d.id
       LIMIT ${POR_PAGINA + 1}`,
      [cursor?.createdAt || null, cursor?.id || null],
    )
  ).rows;
  const pagina = filas.slice(0, POR_PAGINA);
  const ultima = pagina.at(-1);
  return {
    drivers: pagina.map((fila) => {
      // Un documento rechazado que ya se reemplazó no es lo que hay que mirar: queda el
      // más nuevo de cada tipo.
      const porTipo = new Map();
      for (const doc of fila.documents) porTipo.set(doc.type, doc);
      return {
        id: fila.public_id,
        createdAt: fecha(fila.created_at),
        person: {
          id: fila.user_public_id,
          name: fila.name,
          email: fila.email,
          phone: fila.phone || null,
          phoneVerified: Boolean(fila.phone_verified_at),
        },
        city: fila.city_name || null,
        services: modos(fila.service_modes),
        status: fila.compliance_status || "pending",
        rejectionReason: fila.rejection_reason || null,
        requiredTypes: requiredTypesForKinds(fila.vehicles.map((vehiculo) => vehiculo.kind)),
        documents: [...porTipo.values()].map((doc) => ({
          ...doc,
          expiresAt: dia(doc.expiresAt),
          createdAt: fecha(doc.createdAt),
          rejectionReason: doc.rejectionReason || null,
        })),
        vehicles: fila.vehicles.map((vehiculo) => ({
          ...vehiculo,
          plate: vehiculo.plate || null,
          color: vehiculo.color || null,
          rejectionReason: vehiculo.rejectionReason || null,
        })),
      };
    }),
    nextCursor:
      filas.length > POR_PAGINA && ultima
        ? Buffer.from(
            JSON.stringify({ createdAt: ultima.cursor_created_at, id: ultima.id }),
          ).toString("base64url")
        : null,
  };
}
