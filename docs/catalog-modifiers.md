# Opciones y modificadores de catálogo

Los agregados dejaron de ser nombres y precios confiados al frontend. La migración `057_catalog_modifiers.sql` incorpora grupos por producto y modificadores versionables en PostgreSQL.

Cada grupo define nombre, orden, mínimo y máximo de selecciones. Cada opción conserva identificador, nombre, precio en centavos y disponibilidad. Los extras de los datos iniciales se migran a este modelo para evitar una ruptura visual.

## Flujo autoritativo

1. Catálogo entrega los grupos aplicables a cada producto.
2. Mobile impide superar el máximo y no habilita “Agregar” hasta cumplir mínimos.
3. `PUT /api/cart` valida nuevamente IDs, disponibilidad, duplicados y reglas; guarda sólo IDs y un precio unitario resuelto por servidor.
4. La cotización vuelve a resolver todo desde PostgreSQL e incluye base, modificadores, nota y precio unitario final en el token firmado.
5. Confirmar recalcula bajo transacción. Cualquier cambio de precio, disponibilidad o selección invalida el consentimiento anterior antes del cobro.
6. `job_items` conserva precio final y snapshot de nombres/precios para cocina, soporte y recibo histórico.

## Operación del comercio

Flash Negocios incluye un editor por producto para crear o quitar grupos y opciones, definir mínimos y máximos, publicar precios adicionales y pausar opciones agotadas. `PUT /api/restaurants/:restaurantId/menu/:itemId/modifiers` requiere rol de comercio propietario o administrador, valida IDs únicos en todo el producto, reemplaza el conjunto dentro de una transacción y emite auditoría y actualización en tiempo real.

El cliente nunca puede crear un extra gratuito enviando un texto arbitrario. La suite prueba opciones inexistentes, repetidas, persistencia del carrito, alteración posterior a la cotización, permisos de gestión y persistencia administrativa real.
