# Alta real de comercios (FE-05)

Hasta FE-05 no había ningún camino de producto para crear un comercio: el único
`INSERT INTO merchants` vivía en `scripts/db-seed-commerce.mjs`, y con «todo real, nada
falso» el catálogo quedaba vacío para siempre. Uber Eats y PedidosYa resuelven el alta
con una postulación que revisa el equipo de la plataforma; Flash hace lo mismo.

## Cómo funciona

1. **Postularse** (`POST /api/applications/merchant`, cualquier cuenta con sesión):
   nombre del comercio, razón social, CUIT (se valida el dígito verificador), rubro,
   teléfono en E.164 de Argentina, dirección con su ubicación y notas opcionales. Una
   persona tiene a lo sumo una solicitud abierta (`pending` o `needs_changes`), y quien
   ya tiene un comercio no se vuelve a postular: los dos casos responden 409.
2. **Seguirla** (`GET /api/applications/me`): las solicitudes de la persona, la más
   nueva primero, con el motivo de la última decisión.
3. **La cola de operaciones** (`GET /api/admin/merchant-applications?status&cursor`):
   admin y soporte la leen, de a 25, paginada por cursor sobre `(created_at, id)`. Las
   abiertas salen la más vieja primero. El tablero de colas
   (`/api/operations/work-queues`) cuenta las pendientes como
   `merchant_applications`, de dueño humano.
4. **Decidir** (`POST /api/admin/merchant-applications/:id/decision`, sólo admin):
   `approve`, `needs_changes` o `reject`; las dos últimas exigen motivo. Decidir una
   solicitud ya resuelta es 409.

**Aprobar es lo único que crea un comercio en todo el producto.** Lo hace en una sola
transacción, con la solicitud bloqueada `FOR UPDATE`: crea el comercio (activo y
cerrado), su sucursal principal (`branch_<comercio>`, cerrada y sin horario), recién
entonces otorga el rol `merchant`, anota el evento `merchant_application.approved` en
la auditoría y le deja a quien se postuló un aviso dentro de la app. Dos aprobaciones
simultáneas crean un solo comercio: la segunda espera el bloqueo y recibe 409. La
ciudad sale de la ubicación declarada; fuera de toda ciudad habilitada no se aprueba.

El comercio nace sin horario, sin productos y sin foto: la consola lo guía hasta estar
listo para vender. No se precarga nada para que parezca lleno.

## Base de datos

La migración 152 crea `merchant_applications`, clasificada `por-usuario` en
`database/rls-classification.json`: la ven quien se postuló, admin y soporte. La
auditoría de RLS no ve razón social, CUIT, teléfono, dirección, notas ni motivo. Al
eliminarse una cuenta, sus solicitudes no aprobadas se borran.

La 152 también le devuelve al runtime el `INSERT` sobre `merchants` y
`merchant_branches`, que las migraciones 134 y 135 habían revocado porque ninguna ruta
creaba comercios. `DELETE` sigue revocado; `test:runtime-write-scope` lo vigila.

## Suspendidos en operaciones

`/api/operations/restaurants` incluye ahora los comercios suspendidos, con `status`
(`active` o `suspended`, el CHECK de la migración 130) y `suspendedAt` y
`suspensionReason`, que salen del último evento `merchant.status_changed` que lo
suspendió. `merchants` no tiene columnas para eso y no se agregaron: la auditoría ya
guarda el motivo obligatorio, el actor y la hora. Un suspendido sin ese evento responde
`null` en los dos. La pausa del local no es un estado del comercio: es `manualOpen` y
la pausa de cada sucursal.

## Pruebas

`npm run test:merchant-applications` (en `ci-critical-flows`) usa cuentas sintéticas
rotuladas como prueba y la API real: CUIT inválido 400, alta 201, segunda abierta 409,
permisos de cliente y soporte, la cola y el tablero, pedir cambios con motivo que la
persona lee, rechazo con aviso, dos aprobaciones simultáneas con un solo comercio, el
rol `merchant`, `/api/merchant/me` del nuevo comercio, y la suspensión vista desde
operaciones. Borra todo lo que crea. `test:rls` prueba la política por rol y
`test:rls-matrix` la clasificación.

`npm run test:merchant-onboarding` (en `ci-fast`) vigila las pantallas: que `/comercios` sea
una ruta pública con enlaces desde el ingreso y desde la web de cliente, que la consola de
operaciones tenga Altas y la cola lleve ahí, que la puesta en marcha se calcule con el
horario, el segundo factor y los cobros reales sin simular Mercado Pago, que el estado de un
comercio salga del servidor, que el horario de una sucursal no se borre solo mientras se
carga (el defecto que encontró la prueba en el navegador: la consola se actualiza cada pocos
segundos y el formulario se reiniciaba) y que cada control del horario tenga nombre, y que el
teléfono no quede «+54 +54». Falsificado con 19 mutaciones. Si falla, un comercio de verdad
vuelve a perder su horario o a no encontrar cómo sumarse.

## Lo que falta

- **Corregir una observada.** No hay ruta para que quien se postuló edite una solicitud
  en `needs_changes`: hoy lee el motivo y operaciones decide (aprobar o rechazar). La
  edición queda para una ola siguiente.
- **Verificar el CUIT contra ARCA.** Sólo se controla el dígito verificador; que el
  CUIT exista y sea de quien se postula lo confirma operaciones a mano. Es borde de
  tercero (padrón de ARCA).
