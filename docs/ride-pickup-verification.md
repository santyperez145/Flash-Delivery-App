# PIN de retiro para Viajes

Los viajes creados después de la migración `073_ride_pickup_verification.sql` no pueden pasar de `arriving` a `in_progress` hasta verificar al pasajero.

## Flujo

1. La creación deriva un PIN de cuatro dígitos mediante HMAC y persiste únicamente un hash bcrypt.
2. Sólo el propietario puede consultar el PIN mientras el viaje está activo y aún no fue utilizado.
3. Al llegar, el conductor asignado introduce el PIN en su app.
4. La API valida rol, asignación, estado y hash. Recién entonces habilita el inicio.
5. La verificación se audita sin PIN ni hash y se publica como actualización del viaje.

Cinco intentos incorrectos bloquean nuevas verificaciones durante diez minutos. El endpoint utiliza además el limitador de operaciones sensibles.

## Privacidad y compatibilidad

- El PIN no se almacena en texto plano ni dentro de la respuesta idempotente de creación.
- El conductor no puede consultar el código y otro cliente no puede consultar ni verificar el viaje.
- El auditor sólo ve intentos, bloqueo y fecha de verificación; `pin_hash` no forma parte de sus privilegios.
- Los viajes activos anteriores al rollout pueden finalizar sin quedar bloqueados por la ausencia histórica de una fila. Todos los viajes nuevos la crean en la misma transacción que el job.

`test:postgres` cubre transición bloqueada, cinco fallos, lockout, bcrypt en reposo, ownership y comienzo correcto. `test:rls` cubre participantes y privilegios mínimos.
