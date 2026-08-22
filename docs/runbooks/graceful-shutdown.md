# Drenaje y apagado de API

Ante `SIGTERM` o `SIGINT`, la instancia pasa inmediatamente a estado de
drenaje. Readiness responde `503`, los clientes SSE reciben
`server.shutdown` con `reconnect: true`, y el servidor deja de aceptar nuevas
conexiones mientras permite finalizar las solicitudes activas.

El orden de cierre es:

1. readiness y streams realtime;
2. conexiones HTTP activas;
3. listener PostgreSQL `LISTEN/NOTIFY`;
4. pools PostgreSQL/Redis y exportador OpenTelemetry.

`SHUTDOWN_GRACE_MS` controla el máximo de drenaje (10 segundos por defecto,
entre 1 y 60 segundos). Al vencer se cierran las conexiones HTTP restantes y
el hecho queda registrado. Docker Compose concede 20 segundos al proceso, por
lo que el grace interno debe mantenerse por debajo de ese límite.

Una salida con fallo en cualquier recurso termina con código 1 y evento
`shutdown.failed`. `npm run test:graceful-shutdown` verifica idempotencia ante
señales repetidas, aviso SSE, timeout forzado y el orden completo de liberación.
