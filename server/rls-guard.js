// El proceso no arranca en producción con un rol que puede saltear RLS
// (ticket DAT-001).
//
// `FORCE ROW LEVEL SECURITY` no se puede aplicar a todo, y la razón está en
// `docs/matriz-rls.md`: el dueño de las tablas es `flash_app`, que corre las
// migraciones y los backfills sobre filas de todos los usuarios. Aplicárselo
// rompería ese trabajo.
//
// Eso deja un riesgo que no es de código sino de configuración. Si
// `DATABASE_URL` apuntara alguna vez al rol migrador en lugar de a
// `flash_runtime` —una copia de `.env`, una sesión de depuración, un despliegue
// mal armado—, **todas las políticas dejarían de aplicarse en silencio**.
// Ninguna consulta fallaría: devolverían las filas de todo el mundo.
//
// `GET /api/ready` ya devolvía 503 en ese caso, lo que saca la instancia del
// balanceador. Pero un proceso que falla readiness sigue corriendo y sigue
// respondiendo a quien lo alcance directo, y «directo» incluye un balanceador
// mal configurado, un port-forward y cualquier tráfico interno. La única
// respuesta que no depende de que otro sistema esté bien configurado es no
// atender.
//
// La decisión se separa del arranque a propósito: acá es una función pura sobre
// el resultado de `postgresReadiness()`, así que `test:rls-guard` puede recorrer
// la tabla de casos sin levantar una base ni un proceso.
/**
 * @param readiness resultado de `postgresReadiness()`
 * @param isProduction si el proceso corre con `NODE_ENV=production`
 * @returns el motivo por el que hay que negarse a arrancar, o `null`
 */
export function bypassRefusalReason(readiness, { isProduction }) {
  // Fuera de producción el rol dueño es lo normal: un desarrollador corre
  // migraciones y aplicación con la misma URL, y negarse volvería inusable el
  // entorno local sin proteger nada real.
  if (!isProduction) return null;

  // Sin base configurada corre el respaldo SQLite, que no tiene RLS que saltear.
  if (!readiness?.configured) return null;

  // Si la base no responde no se puede afirmar nada sobre el rol. Negarse acá
  // convertiría una caída transitoria de PostgreSQL en un proceso que no
  // levanta, que es un daño seguro a cambio de uno hipotético. `/api/ready` ya
  // devuelve 503 mientras tanto, así que la instancia no recibe tráfico igual.
  if (!readiness.ready) return null;

  // `least_privilege` lo calcula `postgresReadiness()`: el rol no tiene
  // `BYPASSRLS` y no es el dueño del esquema.
  if (readiness.least_privilege) return null;

  const detalles = [];
  if (readiness.bypass_rls) detalles.push("tiene BYPASSRLS");
  if (readiness.database_role && readiness.database_role === readiness.schema_owner)
    detalles.push(`es dueño del esquema (${readiness.schema_owner})`);
  // Si `least_privilege` es falso alguna de las dos condiciones se cumple, pero
  // la lectura puede haber devuelto campos vacíos. Se dice lo que se sabe en vez
  // de afirmar una causa que no se comprobó.
  if (!detalles.length) detalles.push("no se pudo confirmar que sea de menor privilegio");

  return (
    `El rol PostgreSQL "${readiness.database_role || "desconocido"}" ${detalles.join(" y ")}, ` +
    "así que las políticas RLS no se le aplican. Apuntá DATABASE_URL al rol de runtime " +
    "(flash_runtime), no al rol migrador."
  );
}
