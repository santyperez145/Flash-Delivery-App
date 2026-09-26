// Selección de candidatos de dispatch (ticket DSP-001, hallazgo H-06).
//
// La versión anterior calculaba, **para cada conductor online del sistema**,
// `ST_Distance` tres veces, el conteo de trabajos activos y los agregados de
// aceptación y respuesta de los últimos 30 días. No había `ST_DWithin` ni orden
// KNN `<->` en todo el repositorio.
//
// Con decenas de conductores da igual. Con cientos o miles por ciudad, cada
// oleada recorre el padrón entero: el costo crece justo cuando la plataforma
// empieza a funcionar.
//
// Ahora son dos etapas. La primera acota el conjunto con `ST_DWithin` y lo
// ordena por KNN, que es lo que aprovecha el índice GiST parcial
// `drivers_available_location_gix ... WHERE online`. La segunda puntúa
// solamente esos 30 candidatos, así que el trabajo caro queda acotado por
// construcción en lugar de por suerte.
import { config } from "./config.js";

/**
 * Etapa 1: lista corta por cercanía.
 *
 * El punto de pickup entra como parámetro, no como columna de un join. El
 * planificador sólo usa el índice para KNN cuando uno de los operandos es
 * constante en la consulta.
 */
const SHORTLIST_SQL = `
  SELECT d.id
  FROM drivers d
  WHERE d.online
    AND $2::job_kind = ANY(d.service_modes)
    AND d.current_location IS NOT NULL
    AND ST_DWithin(d.current_location, $1::geography, $3)
    AND d.location_updated_at >= now() - interval '10 minutes'
    AND (d.location_accuracy_m IS NULL OR d.location_accuracy_m <= 200)
  ORDER BY d.current_location <-> $1::geography
  LIMIT $4`;

/**
 * Etapa 2: puntuación explicable sobre la lista corta.
 *
 * Los componentes del score son exactamente los de la versión anterior: la
 * optimización no cambia a quién se le ofrece un trabajo, sólo cuántos
 * conductores se evalúan para decidirlo.
 */
const SCORE_SQL = `
  SELECT d.id, d.user_id, j.public_id job_public_id, j.kind, j.metadata,
    ST_Distance(d.current_location, j.pickup_location) distance_m,
    d.rating*20 rating_points,
    LEAST(ST_Distance(d.current_location, j.pickup_location)/250, 40) distance_penalty,
    active_jobs.count*15 load_penalty,
    CASE WHEN d.location_updated_at < now()-interval '5 minutes' THEN 25 ELSE 0 END freshness_penalty,
    (COALESCE(history.acceptance_rate_30d,.5)-.5)*20 acceptance_points,
    GREATEST(-10, LEAST(10,(20-COALESCE(history.median_response_seconds,20))/2)) response_points,
    COALESCE(history.incident_score,0) incident_penalty,
    COALESCE(history.acceptance_rate_30d,.5) acceptance_rate,
    COALESCE(history.median_response_seconds,20) average_response_seconds,
    (d.rating*20)-LEAST(ST_Distance(d.current_location,j.pickup_location)/250,40)-(active_jobs.count*15)
      -CASE WHEN d.location_updated_at<now()-interval '5 minutes' THEN 25 ELSE 0 END
      +(COALESCE(history.acceptance_rate_30d,.5)-.5)*20
      +GREATEST(-10,LEAST(10,(20-COALESCE(history.median_response_seconds,20))/2))
      -COALESCE(history.incident_score,0) score
  FROM jobs j
  JOIN drivers d ON d.id = ANY($2::uuid[])
  JOIN vehicles vehicle ON vehicle.driver_id=d.id AND vehicle.active AND vehicle.retired_at IS NULL
    AND vehicle.status='approved' AND $3::job_kind=ANY(vehicle.service_modes)
  CROSS JOIN LATERAL(
    SELECT count(*)::numeric count FROM jobs active
    WHERE active.driver_id=d.id AND active.status NOT IN('completed','cancelled')) active_jobs
  LEFT JOIN driver_dispatch_stats history
    ON history.driver_id=d.id AND history.service=$3::job_kind
  WHERE j.id=$1
    AND NOT EXISTS(SELECT 1 FROM dispatch_offers prior WHERE prior.job_id=j.id AND prior.driver_id=d.id)
    AND (($3::job_kind='ride' AND NOT EXISTS(
          SELECT 1 FROM jobs active WHERE active.driver_id=d.id AND active.kind='ride'
            AND active.status NOT IN('completed','cancelled')))
      OR ($3::job_kind='delivery' AND (
          SELECT count(*) FROM jobs active WHERE active.driver_id=d.id AND active.kind='delivery'
            AND active.status NOT IN('completed','cancelled'))<2))
  ORDER BY score DESC, distance_m ASC
  LIMIT $4`;

/**
 * Radios a probar, del configurado al máximo.
 *
 * Un radio fijo deja trabajos sin ofrecer en zonas de baja densidad: el
 * conductor más cercano existe, pero está fuera del corte. Expandir sólo cuando
 * la lista corta no alcanza mantiene barato el caso normal y evita que un
 * trabajo se quede sin candidatos por un umbral arbitrario.
 */
export function radiusLadder({
  base = config.dispatch.searchRadiusM,
  max = config.dispatch.maxRadiusM,
} = {}) {
  const ladder = [base];
  let radius = base;
  while (radius < max) {
    radius = Math.min(max, radius * 2);
    ladder.push(radius);
  }
  return ladder;
}

/**
 * Devuelve los ids de la lista corta y el radio con el que se obtuvo.
 *
 * Se expande el radio sólo si no alcanzan candidatos para llenar las ofertas
 * pedidas. El radio usado se registra en la oferta, así que una zona que
 * necesita expandir siempre queda visible en lugar de degradar en silencio.
 */
export async function shortlistDrivers(
  client,
  { pickup, mode, needed, shortlistSize = config.dispatch.shortlistSize },
) {
  for (const radius of radiusLadder()) {
    const rows = (await client.query(SHORTLIST_SQL, [pickup, mode, radius, shortlistSize])).rows;
    if (rows.length >= needed || radius === config.dispatch.maxRadiusM) {
      return {
        driverIds: rows.map((row) => row.id),
        radiusM: radius,
        expanded: radius !== config.dispatch.searchRadiusM,
      };
    }
  }
  return { driverIds: [], radiusM: config.dispatch.maxRadiusM, expanded: true };
}

export async function scoreCandidates(client, { jobId, driverIds, mode, limit }) {
  if (driverIds.length === 0) return [];
  return (await client.query(SCORE_SQL, [jobId, driverIds, mode, limit])).rows;
}

export { SHORTLIST_SQL, SCORE_SQL };
