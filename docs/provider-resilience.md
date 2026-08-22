# Resiliencia de mapas

Geocoding y routing pasan por un circuit breaker común con timeout, umbral de fallas, estado half-open y presupuesto diario por instancia. Una respuesta HTTP fallida cuenta contra el circuito. Al abrirse, nuevas llamadas fallan inmediatamente hasta la ventana de prueba y evitan saturar el proveedor.

La caché PostgreSQL sigue siendo la primera capa. Durante una falla puede servirse una entrada vencida dentro de `MAP_STALE_CACHE_SECONDS`, marcada `cache: stale` y `degraded: true`. Sin caché confiable la API responde 503: precios, distancias y ETA nunca se inventan.

Los contadores Prometheus usan únicamente proveedor, operación y resultado; direcciones y coordenadas no son labels. El presupuesto en memoria protege cada réplica; Redis/distributed quota sigue siendo requisito antes de escalar horizontalmente.
