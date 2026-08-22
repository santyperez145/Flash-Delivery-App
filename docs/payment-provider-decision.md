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
3. [~] Adaptador idempotente con `application_fee` y token del seller implementado y probado sin PAN/CVV; falta conectarlo a la saga pedido/pago y al token generado por Bricks/Core Methods.
4. Webhooks firmados, inbox deduplicado y reconciliación contra ledger.
5. Refund proporcional, saldos insuficientes y runbook de discrepancias.
6. Pruebas con cuentas de test y luego transacción física controlada.

## Implementación disponible

El backend ya crea 256 bits de `state`, persiste sólo SHA-256 con diez minutos de
vigencia y lo consume exactamente una vez antes de intercambiar el `code`. El
intercambio ocurre server-to-server con timeout de cinco segundos. Access y
refresh tokens se guardan como envelopes AES-256-GCM con clave independiente;
RLS y privilegios de columna impiden que el rol auditor los lea. El callback no
se cachea, no refleja códigos en la redirección y el logger elimina todo query
string para que `code` y `state` no terminen en logs.

El portal de negocios sólo recibe estado, modo test/live, últimos cuatro del ID
externo y vencimiento. Las credenciales nunca se serializan. Con el proveedor
deshabilitado, la UI muestra el gate real en lugar de simular una conexión.

El comercio también puede desvincularse desde el portal, pero debe reingresar su
contraseña actual. La revocación es transaccional y reemplaza inmediatamente
access/refresh ciphertexts por `NULL`; sólo conserva proveedor, cuenta externa,
fechas y auditoría. Reconectar requiere un OAuth completo con un `state` nuevo.

El webhook productivo implementa el manifest oficial
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, normaliza IDs alfanuméricos,
calcula HMAC-SHA256 y compara en tiempo constante. Firma, recurso del query y
payload deben coincidir; firmas fuera de diez minutos se rechazan. Después de
validar, el request sólo inserta un evento normalizado en un inbox PostgreSQL con
`notification_id` único y responde 200/201. No consulta al proveedor ni muta
órdenes dentro de los 22 segundos del callback; un worker posterior hará fetch,
conciliación e idempotencia de dominio. Ese worker ya reclama lotes con
`FOR UPDATE SKIP LOCKED`, recupera el recurso autoritativo usando el token seller,
normaliza sólo importes/estado/referencia/comisión y descarta payer/tarjeta. Tiene
cinco intentos, recuperación de locks abandonados y dead-letter explícito. Todavía
no muta el ledger: eso se habilita junto con la creación real de pagos y matching
de `external_reference`.

## Fuentes primarias

- Mercado Pago Split 1:1, disponibilidad Argentina y alcance marketplace:
  https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/overview
- Prerrequisitos KYC 6, OAuth y restricción 1:N:
  https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/prerequisites
- Flujo OAuth y credenciales seller:
  https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration
- Stripe Connect como alternativa de cuentas conectadas:
  https://docs.stripe.com/connect/how-connect-works
- Firma, ACK y política de reintentos de webhooks Mercado Pago:
  https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
