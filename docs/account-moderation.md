# Moderación de cuentas

La consola de superadministración permite suspender y reactivar cuentas mediante `PATCH /api/admin/users/:userId/status`. La acción exige rol administrativo y, cuando MFA está habilitado o requerido, una sesión con segundo factor verificado.

## Suspensión

La operación se ejecuta dentro de una única transacción PostgreSQL:

- cambia `users.status` a `suspended`;
- revoca todas las refresh sessions activas;
- deja al conductor asociado fuera de línea;
- retira sus ofertas de dispatch pendientes;
- registra actor, motivo, estado anterior, sesiones revocadas y ofertas retiradas en `audit_events`.

Los access tokens existentes dejan de funcionar inmediatamente porque cada request vuelve a resolver un usuario `active` en PostgreSQL. Una sesión revocada no se recupera al reactivar la cuenta: el usuario debe autenticarse nuevamente.

## Protecciones

- un administrador no puede suspender su propia cuenta;
- no se puede suspender al último administrador activo;
- suspender o reactivar una cuenta que ya está en ese estado devuelve conflicto;
- el motivo es obligatorio y queda limitado a 240 caracteres;
- los usuarios suspendidos permanecen visibles sólo en el estado administrativo.

La suite `npm run test:postgres` verifica revocación de access/refresh, desconexión de supply, retiro de ofertas, auditoría, visibilidad administrativa y reactivación.

La navegación desktop también valida el rol antes de renderizar una superficie: sólo `admin` accede al Command Center, sólo `merchant` al portal de negocio y las cuentas customer/driver reciben una vista restringida. La API continúa siendo la autoridad definitiva para cada acción.
