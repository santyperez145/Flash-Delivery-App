# Finanzas de comercios

Al completar un pedido pagado y capturado, la misma transacción que cambia el job a `completed` crea un asiento `merchant_settlement`. El débito total contra `cash_clearing` se distribuye exactamente entre:

- cuenta `merchant/payable`: venta neta de descuento menos comisión configurada en basis points;
- wallet del conductor: tarifa de entrega;
- cuenta `platform/revenue`: comisión, service fee y cualquier remanente.

La vista `ledger_transaction_balances` exige suma cero y las pruebas verifican al menos tres entradas por liquidación. Reintentar el cambio de estado no duplica el asiento porque usa `settlement-<jobId>` como idempotency key.

## API

- `GET /api/merchant/finance?merchantId=...`: saldo, movimientos y retiros del comercio propietario.
- `POST /api/merchant/payouts`: reserva fondos mediante `Idempotency-Key`, debitando `payable` y acreditando `payout_pending`.
- `POST /api/merchant/payouts/authorize`: revalida la contraseña y crea una autorización de cinco minutos ligada a actor, comercio e importe. El JWT y su `jti` PostgreSQL se consumen una sola vez al reservar.

El retiro permanece `pending`; no se declara transferencia bancaria hasta recibir confirmación de un PSP. RLS oculta payouts a clientes y a otros comercios. El portal desktop muestra el saldo real, movimientos y formulario de retiro.

La interfaz muestra explícitamente el importe firmado y solicita la contraseña
actual en el momento de retirar. Cambiar importe o comercio invalida el token;
la comprobación y el consumo ocurren dentro de la misma transacción del ledger.
Un retry con el mismo `Idempotency-Key` recupera el resultado sin duplicar la
reserva, pero el token no autoriza otra operación.

Este diseño sigue la verificación de identidad que Uber aplica antes de modificar
datos bancarios y el patrón de step-up de Stripe. OWASP Transaction Authorization
aporta el requisito WYSIWYS, credencial corta, única y ligada a datos significativos.

## Pendiente productivo

- Completar alta comercial/KYC, credenciales y ensayo sandbox del onboarding OAuth
  y Split Payments 1:1 ya implementado según `docs/payment-provider-decision.md`;
  no construir una transferencia bancaria propia ni presentar la reserva del
  ledger como dinero enviado.
- Webhooks de payout con reintentos, estados fallidos y liberación de reservas.
- KYC/KYB, retenciones impositivas, CBU/CVU tokenizado y aprobación dual para ajustes.
