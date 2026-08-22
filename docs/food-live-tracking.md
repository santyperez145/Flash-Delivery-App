# Seguimiento de pedidos de comida

Los pedidos activos de Actividad abren una hoja de seguimiento independiente tanto en la PWA web como en la app nativa. El mapa usa las coordenadas PostGIS persistidas en el job y solicita la ruta vial comercio→cliente al adaptador de mapas existente. En web, la geometría se dibuja como capa GeoJSON naranja sobre el viewport MapLibre interactivo con pan, zoom y reencuadre; distancia y duración siguen viniendo del proveedor de rutas.

La progresión visual corresponde a los estados reales: confirmado, preparando, listo, repartidor asignado, retirado, en camino y entregado. Si existe `courierId`, la posición proviene del conductor cargado desde PostgreSQL; antes de la asignación se informa que Flash sigue buscando disponibilidad.

La ruta es una ayuda visual y puede fallar independientemente del pedido. En ese caso la interfaz conserva ID, estado, ETA y timeline, evitando que una caída del proveedor cartográfico haga desaparecer el servicio operativo.

## Decisión competitiva

El flujo sigue el patrón observable de Uber Eats: el tracking debe concentrar progreso, ETA, ubicación del repartidor cuando existe y acceso a ayuda durante un pedido activo; la ubicación no se presenta como disponible si el repartidor aún no la comparte o si el proveedor cartográfico está degradado. Esta decisión se contrasta con la documentación oficial de [Live Order Tracking de Uber Eats](https://help.uber.com/en/merchants-and-restaurants/article/live-order-tracking---faq?nodeId=d006582e-113f-4423-9d33-e938de34b3a2) y [Support de Uber Eats](https://help.uber.com/merchants-and-restaurants/article/support?nodeId=a467254f-b6b2-4e11-a88b-d96653ca1f81).

En Flash, el botón de seguimiento y cancelación actúan sobre endpoints autenticados existentes; compartir estado usa la capacidad nativa del navegador o copia texto al portapapeles. No se simulan posiciones, links públicos ni chats: esas capacidades requieren una sesión, un job y un proveedor habilitado.
