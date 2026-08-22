# ADR — PSP de marketplace para el piloto argentino

Estado: **aceptado para implementación condicionada**. Fecha: 22 de agosto de 2026.

## Decisión

El piloto argentino priorizará **Mercado Pago Split Payments 1:1** para cobros de
comercios. El proveedor está disponible en Argentina, reparte automáticamente el
pago entre seller y marketplace, y ofrece Checkout API/Bricks sin sacar al usuario
del flujo. Cada comercio debe completar KYC 6 y autorizar a Flash mediante OAuth;
su access token se usa exclusivamente en backend.

El ledger PostgreSQL seguirá siendo el registro operativo y de conciliación, pero
no moverá dinero ni ejecutará transferencias por sí mismo. Los payouts internos
actuales son reservas contables auditables para pruebas y backoffice; producción
no puede habilitarlos hasta que el proveedor, webhooks firmados, conciliación y
procedimiento de incidentes estén conectados y ensayados.

## Alternativas

- **Stripe Connect:** arquitectura sólida para connected accounts y payouts, pero
  la disponibilidad concreta depende del país de la plataforma, elegibilidad y
  aprobación de cross-border. Se conserva como adaptador futuro, no como supuesto.
- **Transferencias bancarias propias:** rechazadas para el MVP. Aumentan alcance
  regulatorio, KYC/AML, custodia, conciliación y riesgo operativo sin ventaja sobre
  un PSP marketplace local.
- **Mercado Pago Split 1:N:** no se asume disponible; la documentación lo limita
  a vendedores de cartera asesorada con contacto comercial.

## Secuencia obligatoria

1. Alta comercial de la aplicación Marketplace y confirmación contractual.
2. OAuth seller con `state` de un solo uso, callback exacto y tokens cifrados.
3. Payment intent idempotente con `application_fee` y token del seller.
4. Webhooks firmados, inbox deduplicado y reconciliación contra ledger.
5. Refund proporcional, saldos insuficientes y runbook de discrepancias.
6. Pruebas con cuentas de test y luego transacción física controlada.

## Fuentes primarias

- Mercado Pago Split 1:1, disponibilidad Argentina y alcance marketplace:
  https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/overview
- Prerrequisitos KYC 6, OAuth y restricción 1:N:
  https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/prerequisites
- Flujo OAuth y credenciales seller:
  https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration
- Stripe Connect como alternativa de cuentas conectadas:
  https://docs.stripe.com/connect/how-connect-works
