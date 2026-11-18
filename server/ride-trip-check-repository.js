import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";

// Control del viaje (SEG-01), como RideCheck de Uber.
//
// La detección vive en la base (`app.detect_ride_trip_checks`, migración 141) y
// el cierre lejos del destino lo detecta un trigger. Acá van las dos partes que
// necesitan al servidor: **avisar** (push al pasajero y aviso a operaciones) y
// **la respuesta** del pasajero, que con «Pedir ayuda» abre un incidente de
// seguridad igual al del botón SOS.

const publicId = (prefix) => `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

/** Lo que dice el aviso, por señal. Sin afirmar más de lo que se sabe. */
export const tripCheckCopy = {
  long_stop: {
    title: "¿Todo bien en tu viaje?",
    body: "Notamos que el auto está detenido hace varios minutos.",
  },
  signal_lost: {
    title: "¿Todo bien en tu viaje?",
    body: "Dejamos de recibir la ubicación del conductor.",
  },
  route_deviation: {
    title: "¿Todo bien en tu viaje?",
    body: "El auto se alejó del recorrido hacia tu destino.",
  },
  early_end: {
    title: "¿Llegaste bien?",
    body: "El viaje terminó lejos de tu destino.",
  },
};

/**
 * Una vuelta del barrido: detecta señales nuevas y avisa lo pendiente.
 *
 * Avisa todo lo que tenga `notified_at` vacío, venga del barrido o del cierre del
 * viaje. El aviso al pasajero va como `security_alert`, que es esencial: sale por
 * push aunque haya apagado las novedades de servicio.
 */
export async function processPostgresTripChecks({ limit = 50, onlyJobId = null } = {}) {
  // `onlyJobId` acota la vuelta a un viaje: lo usan las pruebas para no tocar los demás.
  const detected = Number(
    (
      await postgresPool.query("SELECT app.detect_ride_trip_checks(only_job => $1::uuid) created", [
        onlyJobId,
      ])
    ).rows[0].created,
  );
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const pending = (
      await client.query(
        `UPDATE ride_trip_checks c SET notified_at=now()
        FROM jobs j
        WHERE c.id IN (
          SELECT id FROM ride_trip_checks
          WHERE notified_at IS NULL AND status='open' AND ($2::uuid IS NULL OR job_id=$2)
          ORDER BY detected_at FOR UPDATE SKIP LOCKED LIMIT $1
        ) AND j.id=c.job_id
        RETURNING c.public_id, c.kind, j.public_id ride_public_id, j.customer_id`,
        [limit, onlyJobId],
      )
    ).rows;
    for (const check of pending) {
      const copy = tripCheckCopy[check.kind];
      await enqueueNotificationForInternalUser(client, {
        userId: check.customer_id,
        channel: "push",
        template: "security_alert",
        payload: {
          ...copy,
          kind: check.kind,
          rideId: check.ride_public_id,
          checkId: check.public_id,
        },
        deduplicationKey: `trip-check:${check.public_id}`,
      });
      await client.query(
        `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status)
        SELECT 'NTF-'||upper(substr(md5(random()::text||u.id::text),1,8)),u.id,'in_app','safety_trip_check',$1,$2||':'||u.id,'sent'
        FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role IN('admin','support')
        ON CONFLICT DO NOTHING`,
        [
          { checkId: check.public_id, rideId: check.ride_public_id, kind: check.kind },
          `trip-check:${check.public_id}`,
        ],
      );
    }
    await client.query("COMMIT");
    return { detected, notified: pending.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * La respuesta del pasajero: «Estoy bien» cierra el aviso; «Pedir ayuda» abre un
 * incidente de seguridad, que operaciones atiende en la misma cola que el SOS.
 *
 * Sólo contesta quien viaja. Un aviso de final lejos del destino se contesta con
 * el viaje ya cerrado: por eso no se exige que siga activo, sólo que el aviso
 * siga abierto.
 */
export async function respondToTripCheck({
  ridePublicId,
  checkPublicId,
  userPublicId,
  response,
  location,
}) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const check = (
      await client.query(
        `SELECT c.id,c.kind,c.status,j.id job_id,j.customer_id,u.id user_id
        FROM ride_trip_checks c JOIN jobs j ON j.id=c.job_id
        LEFT JOIN users u ON u.public_id=$3
        WHERE c.public_id=$1 AND j.public_id=$2 AND j.kind='ride' FOR UPDATE OF c`,
        [checkPublicId, ridePublicId, userPublicId],
      )
    ).rows[0];
    if (!check) throw Object.assign(new Error("Aviso no encontrado"), { status: 404 });
    if (check.customer_id !== check.user_id)
      throw Object.assign(new Error("Sólo quien viaja puede contestar"), { status: 403 });
    if (check.status !== "open")
      throw Object.assign(new Error("Este aviso ya no está abierto"), { status: 409 });

    let incidentId = null;
    if (response === "help") {
      incidentId = publicId("SOS");
      const incident = (
        await client.query(
          `INSERT INTO ride_safety_incidents(public_id,job_id,reporter_id,incident_type,details,location)
          VALUES($1,$2,$3,'sos',$4,CASE WHEN $5::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6,$5),4326)::geography END)
          RETURNING id`,
          [
            incidentId,
            check.job_id,
            check.user_id,
            `Pidió ayuda desde el control del viaje (${check.kind})`,
            location?.lat ?? null,
            location?.lng ?? null,
          ],
        )
      ).rows[0];
      await client.query(
        "UPDATE ride_trip_checks SET status='help_requested',incident_id=$2,responded_at=now() WHERE id=$1",
        [check.id, incident.id],
      );
      await client.query(
        `INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status)
        SELECT 'NTF-'||upper(substr(md5(random()::text||u.id::text),1,8)),u.id,'in_app','safety_sos',$1,$2||':'||u.id,'sent'
        FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role IN('admin','support')
        ON CONFLICT DO NOTHING`,
        [
          { incidentId, rideId: ridePublicId, type: "sos", tripCheck: check.kind },
          `safety-sos:${incidentId}`,
        ],
      );
    } else {
      await client.query(
        "UPDATE ride_trip_checks SET status='rider_ok',responded_at=now() WHERE id=$1",
        [check.id],
      );
    }
    await client.query("COMMIT");
    return {
      id: checkPublicId,
      kind: check.kind,
      status: response === "help" ? "help_requested" : "rider_ok",
      incidentId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
