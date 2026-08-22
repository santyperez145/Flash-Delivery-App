# Cancelaciones de servicio

Las cancelaciones de pedidos, viajes y envíos son operaciones transaccionales PostgreSQL. El cambio de estado, retiro de ofertas de dispatch, reintegro Wallet, ledger, refund y registro del motivo se confirman o revierten juntos.

## Datos persistidos

`job_cancellations` conserva un registro único por job con actor, motivo normalizado, detalle opcional, importe reintegrado, cargo de cancelación, moneda y fecha. No almacena credenciales ni payloads del PSP.

Motivos aceptados: `changed_mind`, `wrong_address`, `long_wait`, `price`, `driver_issue`, `merchant_issue`, `recipient_unavailable` y `other`. Para `other` se exige una explicación.

## Acceso y experiencia

RLS hereda la visibilidad de participantes del job. La app móvil pide un motivo antes de cancelar y muestra en Actividad el motivo y el reintegro confirmado. El resultado forma parte del objeto del servicio retornado por `/api/me/activity`.

Actualmente el cargo es cero y la captura Wallet se reintegra por completo. Las ventanas tarifarias por etapa, excepciones operativas y cargos reales requieren una política comercial aprobada antes de activarse.
