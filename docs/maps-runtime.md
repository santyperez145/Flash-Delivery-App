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

## Render cartográfico web

La PWA usa MapLibre GL JS `6.5.0` como motor interactivo. Es TypeScript, BSD-3-Clause, community-governed, compatible con el estándar abierto MapLibre Style Specification y se mantiene en un chunk asíncrono: la pantalla inicial no descarga WebGL hasta abrir una superficie con mapa. La ruta normalizada del backend se agrega como GeoJSON con casing y color Flash; origen, destino y última ubicación real del conductor son marcadores separados. El usuario puede desplazar, hacer zoom y reencuadrar el recorrido. La accesibilidad conserva etiqueta, estado de carga y degradación textual.

`VITE_MAP_STYLE_URL` acepta una URL **pública** HTTPS a un estilo vectorial MapLibre. Nunca debe contener una credencial secreta porque Vite la incorpora al bundle. `WEB_MAP_ORIGINS` enumera, sin comodines, los orígenes HTTPS del estilo, tiles, glyphs y sprites autorizados por CSP. El fallback local usa raster OpenStreetMap con atribución visible; no se considera un proveedor productivo ni permite recolorear calles o POI individualmente. Para staging/producción se debe contratar o autohospedar un servicio vectorial con SLA, cuota, términos de uso y token público restringido por dominio.

Si el estilo, una tesela o WebGL fallan, la interfaz no dibuja una línea directa falsa: mantiene estado, ETA/cotización y explica que la cartografía no está disponible. Geocodificación y routing continúan pasando por el backend, su circuit breaker, presupuesto, cache y observabilidad; los assets visuales quedan limitados por CSP al proveedor declarado.

Referencias técnicas primarias:

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [MapLibre Style Specification](https://maplibre.org/maplibre-gl-js/docs/style-spec/)
- [Raster sources del Style Spec](https://maplibre.org/maplibre-style-spec/sources/)
