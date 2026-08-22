# Propinas post-servicio

`POST /api/jobs/:jobId/tips` permite al cliente propietario enviar entre $100 y
$100.000 después de completar un pedido, viaje o envío con conductor asignado.
El máximo efectivo es además 50% de la tarifa del servicio.

La operación exige `Idempotency-Key`, bloquea job y ambas Wallets, verifica saldo
y crea dos asientos: débito al cliente y crédito íntegro al conductor. No hay
comisión de plataforma. `service_tips.job_id` es único, por lo que un servicio no
puede recibir dos propinas, incluso usando claves diferentes.

Cliente y conductor ven el registro mediante el agregado autenticado; RLS impide
que terceros lo consulten. El conductor recibe una notificación sin datos de la
Wallet del cliente. La app móvil muestra sugerencias en Actividad para servicios
completados y reemplaza los botones por el importe persistido luego del pago.

## Correcciones operativas con cuatro ojos

La propina capturada no se edita ni se elimina. Un administrador puede solicitar
una corrección parcial o total con `POST /api/admin/tip-adjustments`, importe,
motivo e `Idempotency-Key`. PostgreSQL bloquea la propina y suma ajustes pendientes
y aprobados, por lo que dos solicitudes concurrentes nunca pueden superar el
importe original.

Otro administrador debe aprobar o rechazar mediante
`PATCH /api/admin/tip-adjustments/:id/review`; la base impide que solicitante y
revisor sean la misma persona. Rechazar no mueve dinero. Aprobar crea una
transacción `tip_adjustment` balanceada que debita la Wallet del conductor y
acredita la del cliente, conserva referencias a la propina y notifica a ambos.
La Wallet del conductor puede quedar deudora para que un reintegro confirmado no
dependa de sus retiros previos y se compense con ganancias futuras.

Flash Admin muestra la cola, el saldo corregible, solicitante, fundamento,
decisión y revisor. RLS reserva el workflow a administradores; las credenciales
de auditoría pueden inspeccionar el resultado pero no la clave de idempotencia ni
mutar registros. `npm run test:tip-adjustments` prueba aislamiento, idempotencia,
doble aprobación, concurrencia, importe exacto y balance contable.
