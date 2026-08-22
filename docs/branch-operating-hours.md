# Horarios operativos por sucursal

La disponibilidad de comida dejó de depender de un booleano aislado. Cada sucursal conserva una zona horaria IANA, siete reglas semanales y excepciones por fecha en PostgreSQL.

## Decisión de apertura

`app.branch_is_scheduled_open(branch_id, instant)` convierte el instante a la zona de la sucursal y evalúa, en orden:

1. excepción del día local;
2. tramo nocturno de una excepción del día anterior;
3. regla semanal del día;
4. tramo nocturno de la regla anterior.

Una hora inicial igual a la final representa atención 24 horas. La apertura efectiva también exige `merchant.status = active`, `branch.status = active` y que la pausa manual esté desactivada.

Cotizar y confirmar un pedido vuelven a evaluar la función. Por eso una cotización anterior no permite cobrar si el comercio cerró antes de la confirmación.

## Operación y seguridad

- `PUT /api/restaurants/:restaurantId/branches/:branchId/schedule` reemplaza la semana de forma transaccional y valida la zona contra `pg_timezone_names`.
- `PUT /api/restaurants/:restaurantId/branches/:branchId/schedule-exceptions` crea o reemplaza una fecha especial.
- Sólo el dueño del comercio o administración puede modificar reglas.
- Cada cambio deja auditoría sin depender de ediciones directas en la base.
- Las tablas tienen RLS y la función no concede ejecución al rol `PUBLIC`.

El smoke integral prueba cierre semanal, ownership, excepción por fecha y continuidad correcta de un turno `22:00–02:00`.
