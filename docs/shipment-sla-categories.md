# Categorías y SLA de envíos

La migración `065_shipment_sla_categories.sql` elimina decisiones de precio y manipulación del cliente. Las categorías y niveles de servicio viven en PostgreSQL, se consultan durante cada cotización y se persisten en `shipment_details`.

## Categorías

- `documents`: hasta 5 kg, sin recargo, mantener seco y entregar en mano.
- `standard`: hasta 20 kg, sin recargo.
- `fragile`: hasta 12 kg, recargo de $350 e instrucciones de no apilar.
- `electronics`: hasta 10 kg, recargo de $500 y protección contra calor/humedad.

## Niveles de servicio

- `economy`: transporte ×0,90 y ETA ×1,35.
- `standard`: transporte y ETA base.
- `priority`: transporte ×1,35, ETA ×0,75 y máximo 30 km.
- `express`: transporte ×1,65, ETA ×0,55 y máximo 15 km.

Los valores son configuración inicial auditable, no constantes del cálculo. Cambiar un recargo en PostgreSQL modifica la siguiente cotización y está cubierto por una prueba automática.

## Integridad del precio

El token de cinco minutos vincula categoría, SLA, peso, tamaño, ruta, valor declarado, protección y requisito de firma. La creación recalcula límites y configuración activa antes de comparar el token; una categoría o velocidad alterada se rechaza sin crear un job ni capturar Wallet.

El desglose separa transporte base, multiplicador SLA, recargo de categoría, zona y protección. La app mobile invalida la cotización al cambiar cualquier selector y muestra instrucciones al cliente y al conductor.

## Seguridad y pruebas

Las tablas permiten lectura de configuración activa, pero sólo administración/runtime puede mutarlas. `npm run test:postgres` prueba límites, distancia, manipulación y reacción a configuración; `npm run test:rls` verifica privilegio mínimo.

## Operación desde Flash Admin

La sección **Envíos** de la consola desktop consume `GET /api/shipment-options` y permite actualizar la configuración sin editar SQL:

- `PATCH /api/admin/shipment-item-categories/:code`
- `PATCH /api/admin/shipment-service-levels/:code`

Ambos endpoints exigen sesión con rol `admin`, validan rangos y escriben `before_data` y `after_data` en `audit_events`. La cotización siguiente lee los valores nuevos directamente desde PostgreSQL. El detalle de operación y límites está en `docs/shipment-configuration-admin.md`.
