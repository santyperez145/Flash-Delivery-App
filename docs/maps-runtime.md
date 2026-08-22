# Mapas, geocodificación y rutas

Los clientes autenticados usan `GET /api/maps/geocode` como proxy de Nominatim y `GET /api/maps/route` como proxy de OSRM. Las credenciales o políticas del proveedor quedan del lado servidor y mobile recibe puntos, polilínea y pasos normalizados.

La migración `042_map_provider_cache.sql` agrega una caché PostgreSQL compartida entre instancias:

- geocodificación: TTL predeterminado de 7 días;
- rutas: TTL predeterminado de 15 minutos;
- claves SHA-256 derivadas del proveedor y la consulta normalizada;
- ninguna dirección consultada se almacena en claro como clave;
- coordenadas de rutas redondeadas a cinco decimales para reutilización estable;
- RLS y privilegios limitados al rol de runtime.

Los TTL se configuran con `GEOCODING_CACHE_TTL_SECONDS` y `ROUTING_CACHE_TTL_SECONDS`. Una respuesta incluye `cache: hit|miss` para diagnóstico sin exponer la clave. Coordenadas fuera de los rangos WGS84 se rechazan antes de contactar al proveedor.

`npm run test:maps` precarga respuestas sintéticas, prueba ambos hits sin acceso externo, verifica límites geográficos y elimina los fixtures al terminar.
