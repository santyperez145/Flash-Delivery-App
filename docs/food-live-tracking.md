# Seguimiento de pedidos de comida

Los pedidos activos de Actividad abren una hoja de seguimiento independiente. El mapa usa las coordenadas PostGIS persistidas en el job y solicita la ruta vial comercio→cliente al adaptador de mapas existente. La geometría se dibuja sobre mosaicos OSM personalizados y muestra distancia y duración devueltas por el proveedor.

La progresión visual corresponde a los estados reales: confirmado, preparando, listo, repartidor asignado, retirado, en camino y entregado. Si existe `courierId`, la posición proviene del conductor cargado desde PostgreSQL; antes de la asignación se informa que Flash sigue buscando disponibilidad.

La ruta es una ayuda visual y puede fallar independientemente del pedido. En ese caso la interfaz conserva ID, estado, ETA y timeline, evitando que una caída del proveedor cartográfico haga desaparecer el servicio operativo.
