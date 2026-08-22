# Revisión de payouts

Solicitar un retiro no equivale a transferir dinero. Flash reserva el importe desde la cuenta `merchant/payable` hacia `merchant/payout_pending` mediante una transacción balanceada y crea un payout `pending`.

Un administrador diferente de quien solicitó debe revisar el caso:

- `approved`: pasa a `processing`, preparado para enviar a un proveedor bancario real. No se completa ni genera un identificador externo ficticio.
- `rejected`: pasa a `cancelled` y una transacción idempotente `payout_release` devuelve exactamente la reserva a `merchant/payable`.

Ambas decisiones exigen fundamento y conservan revisor y timestamp. Repetir la misma decisión es idempotente; una decisión contraria posterior se rechaza.

La cola administrativa está restringida a `admin`. El comercio puede consultar el estado y fundamento de sus propios retiros, pero no aprobarlos. El auditor restringido accede a la postura de revisión sin `metadata` ni claves de idempotencia.

La transición desde `processing` hacia `paid` o `failed` continúa dependiendo de un proveedor bancario contratado y su confirmación firmada.
