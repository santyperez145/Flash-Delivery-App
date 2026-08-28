# Propinas

Se dejan en dos momentos, y son mecanismos distintos.

## En el checkout, antes de que haya conductor

La competencia la pide antes de asignar repartidor porque así se deja más
seguido, y la propina es la ganancia por viaje de quien reparte — la variable con
la que se compite por oferta de reparto.

**El problema no es la pantalla: en el checkout todavía no hay a quién pagarle.**
Así que no se transfiere. `tipCents` viaja en `POST /api/orders`, se cobra junto
con el pedido —**un solo cargo**— y queda retenida hasta que hay conductor y el
servicio se completa. Eso obliga a que una propina pueda existir sin
destinatario, que es lo que habilita la migración 126: `driver_id` y
`ledger_transaction_id` pasan a ser opcionales y `status` distingue `held` de
`released` y `refunded`.

**La propina retenida no se reparte.** La liquidación la saca de lo cobrado antes
de dividir entre comercio, conductor y plataforma, y la acredita aparte; con
split de Mercado Pago hace falta además sumarla a la comisión de aplicación, o el
proveedor se la deposita al comercio. El trigger de balance de la migración 003
lo vuelve auto-verificable: hacerlo mal rechaza la transacción al commit.

Si el pedido se reintegra, la propina vuelve con él y la fila deja de decir
«retenida». Un reintegro parcial no la anula: el pedido puede completarse igual y
el repartidor la ganó.

**Los porcentajes se calculan sobre el subtotal, no sobre el total**, para que no
suba cuando sube el envío o la tarifa de servicio.

## Después de entregar

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
