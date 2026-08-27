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

## Saldo en negativo por reintegro

El pago al comercio verifica saldo: `requestMerchantPayout` refusa con 409 «Saldo comercial insuficiente» si la cuenta `payable` no alcanza. La reversión de un reintegro debita esa misma cuenta **sin mirar el saldo**, así que esta secuencia es posible:

1. el comercio vende y se le acredita en `payable`;
2. pide su pago y se le liquida — `payable` queda en cero;
3. un cliente reporta un ítem faltante y operaciones aprueba el reintegro;
4. la reversión debita `payable` a números rojos.

**Que quede en negativo es la decisión tomada, y es deliberada:** el reintegro al cliente no puede depender del saldo de un tercero. Un pedido mal entregado es un problema entre la plataforma y el cliente; que el comercio ya haya cobrado es un problema entre la plataforma y el comercio, y mezclarlos hace que el cliente pague por una cuenta que no es suya.

La deuda se netea contra liquidaciones futuras: la próxima venta acredita sobre un saldo negativo y lo va cerrando sola. No hay tope ni bloqueo.

Lo que **no** puede pasar es que nadie se entere. Un comercio que deja de vender con saldo negativo se lleva la deuda puesta, y sin registro eso se descubre auditando a mano. Por eso cada vez que una reversión deja una cuenta en rojo se abre un caso `negative_balance` en la bandeja de operaciones, con el saldo real en `details.balanceCents` — no sólo el aviso de que hubo un reintegro. Se abre en la misma transacción que escribe el asiento: si el reintegro se confirma, el caso existe.

Antes de esto el comportamiento era el mismo, sólo que **no era una decisión sino una consecuencia**, y no dejaba rastro.

## Pendiente productivo

- Completar alta comercial/KYC, credenciales y ensayo sandbox del onboarding OAuth
  y Split Payments 1:1 ya implementado según `docs/payment-provider-decision.md`;
  no construir una transferencia bancaria propia ni presentar la reserva del
  ledger como dinero enviado.
- Webhooks de payout con reintentos, estados fallidos y liberación de reservas.
- KYC/KYB, retenciones impositivas, CBU/CVU tokenizado y aprobación dual para ajustes.
