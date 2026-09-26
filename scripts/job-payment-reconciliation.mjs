// La conciliación de pagos como trabajo programable (ticket PAY-001).
//
// Hasta acá `scanPaymentReconciliation()` sólo se disparaba desde
// `POST /api/admin/payment-reconciliation/scan`, es decir cuando alguien se
// acordaba de apretar el botón. Una conciliación que depende de que alguien se
// acuerde no es una conciliación: la diferencia aparece igual, lo que cambia es
// cuánto tarda en verse.
//
// Esto es el punto de entrada sin persona detrás. No trae su propio
// planificador a propósito: un `setInterval` dentro del servidor corre una vez
// por réplica —así que con dos réplicas se concilia dos veces— y no sobrevive a
// un reinicio en el momento equivocado. El planificador es del entorno que
// despliega: `cron`, un `CronJob` de Kubernetes, lo que haya. Acá está lo que
// ese planificador invoca.
//
// **Salir con cero cuando hay casos abiertos es deliberado.** Encontrar
// diferencias es el resultado esperado de conciliar, no una falla del trabajo.
// Un trabajo que se pone rojo cada vez que encuentra algo termina silenciado en
// dos semanas, y ahí sí se pierden las diferencias. Lo que sale distinto de cero
// es que la conciliación no haya podido correr.
//
// El rastro queda en `audit_events` vía `recordSystemAudit`, que exige declarar
// el origen. Al escribir esto apareció que `recordPostgresAudit` insertaba cero
// filas sin fallar cuando el actor no existía, que es lo que le habría pasado a
// un trabajo sin sesión: la conciliación habría corrido sin dejar rastro.
import { scanPaymentReconciliation } from "../server/payment-repository.js";
import { recordSystemAudit } from "../server/audit-repository.js";
import { postgresPool, usesPostgresCommerce } from "../server/postgres.js";

const ORIGEN = "scheduled-reconciliation";

if (!usesPostgresCommerce()) {
  console.error("La conciliación de pagos requiere PostgreSQL. Nada que hacer.");
  process.exit(1);
}

try {
  const reconciliacion = await scanPaymentReconciliation();
  // `count(*)` vuelve como cadena desde node-postgres, asi que se convierte
  // antes de compararlo. `"0" > 0` es false por coercion y hubiera andado de
  // casualidad; depender de eso es pedir que el dia que alguien castee la
  // consulta cambie el comportamiento sin tocar este archivo.
  const openCount = Number(reconciliacion.summary?.openCount ?? 0);
  const urgentCount = Number(reconciliacion.summary?.urgentCount ?? 0);

  await recordSystemAudit({
    action: "payment.reconciliation_scanned",
    entityType: "payment_reconciliation",
    entityId: "scheduled",
    origin: ORIGEN,
    afterData: { openCount, urgentCount },
  });

  console.log(
    `ok - conciliación ejecutada: ${openCount} caso(s) abierto(s), ${urgentCount} urgente(s)`,
  );
  if (urgentCount > 0) {
    console.log("");
    console.log(
      `${urgentCount} caso(s) urgente(s) esperan resolución en la bandeja de operaciones.`,
    );
    console.log("El trabajo sale con cero igual: encontrar diferencias es su resultado esperado,");
    console.log("y un trabajo que se pone rojo por hacer su trabajo termina silenciado.");
  }
} catch (error) {
  console.error("La conciliación de pagos no pudo ejecutarse.");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await postgresPool.end().catch(() => {});
}
