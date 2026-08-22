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

Vite excluye `maplibre-gl` del prebundle de desarrollo porque el paquete resuelve su propio Web Worker. Esto evita que HMR conserve una referencia a `maplibre-gl-worker.mjs` ya reemplazada dentro de `.vite/deps`; producción sigue generando el chunk versionado normal.

`VITE_MAP_STYLE_URL` acepta una URL **pública** HTTPS a un estilo vectorial MapLibre. Nunca debe contener una credencial secreta porque Vite la incorpora al bundle. `WEB_MAP_ORIGINS` enumera, sin comodines, los orígenes HTTPS del estilo, tiles, glyphs y sprites autorizados por CSP. El fallback local usa raster OpenStreetMap con atribución visible; no se considera un proveedor productivo ni permite recolorear calles o POI individualmente. Para staging/producción se debe contratar o autohospedar un servicio vectorial con SLA, cuota, términos de uso y token público restringido por dominio.

Si el estilo, una tesela o WebGL fallan, la interfaz no dibuja una línea directa falsa: mantiene estado, ETA/cotización y explica que la cartografía no está disponible. Geocodificación y routing continúan pasando por el backend, su circuit breaker, presupuesto, cache y observabilidad; los assets visuales quedan limitados por CSP al proveedor declarado.

## Render cartográfico mobile

Las tres variantes Expo usan `react-native-maps` `1.27.2`, versión instalada por `expo install` para SDK 57. Android renderiza Google Maps con una paleta Flash neutral; iOS usa Apple MapKit en modo `mutedStandard`. El componente compartido calcula el viewport de origen, destino, ruta y ubicación vigente del conductor, permite pan/zoom y ofrece un control de reencuadre. La polyline se dibuja con casing sólo cuando `/api/maps/route` devuelve al menos dos puntos: una caída del proveedor no se reemplaza por una diagonal inventada.

En viajes y envíos, la primera dirección de origen se toma de la libreta persistida únicamente si pertenece al usuario y ya tiene latitud/longitud. Así, elegir un destino guardado puede abrir el mapa inmediatamente sin repetir geocoding; una dirección editada manualmente nunca hereda esas coordenadas y debe validarse por GPS o por el backend.

La importación se resuelve por plataforma: `FlashNativeMap.native.tsx` es el único archivo que carga `react-native-maps`, mientras `FlashNativeMap.web.tsx` conserva la composición y explica que el mapa interactivo requiere la app instalada o la PWA MapLibre. Este límite es necesario porque el SDK nativo no implementa sus componentes Fabric sobre React Native Web; un `Platform.OS === "web"` después de importarlo llega demasiado tarde. El smoke test y la ejecución de Expo web protegen esta frontera.

`GOOGLE_MAPS_ANDROID_API_KEY` se lee únicamente durante el build y el config plugin la escribe en el manifest nativo. No se incluye el valor en `extra` ni debe guardarse en Git; en Google Cloud se debe restringir a Maps SDK for Android, a los packages `app.flash.customer`, `app.flash.driver` y `app.flash.merchant`, y a las huellas SHA-1/SHA-256 de cada credencial de firma. Sin esa configuración, Android muestra un estado de indisponibilidad explícito. MapKit no requiere una clave Google en iOS.

El mapa visual y el proveedor de geocoding/routing son límites distintos. Las direcciones y rutas continúan pasando por el backend y pueden migrar a un proveedor con SLA sin cambiar el renderer nativo. Un build firmado y una prueba física prolongada siguen siendo condición de lanzamiento; el bundle local no se presenta como validación de tiles, GPS ni cuotas productivas.

Flash Driver usa el mismo renderer con un marcador de vehículo en su última posición foreground/background autorizada y el próximo hito real del job asignado. Cada cambio de fase invalida la ruta anterior antes de recalcularla. La tarjeta muestra la primera maniobra normalizada, distancia y duración; el botón **Navegar** entrega el destino a Apple Maps (`daddr`, `dirflg=d`) en iOS conducción o a la URL universal de Google Maps (`api=1`, `destination`, `travelmode`, `dir_action=navigate`) en Android/bicicleta. Omitir el origen hace que el proveedor use la posición actual y evita pasar una coordenada ya envejecida como inicio de navegación.

La guía ya no aparece en la superficie del cliente. Flash Driver abre un cockpit modal de pantalla completa que prioriza la próxima maniobra, metros, ETA, tres pasos, etapa y destino sobre el mapa nativo; desde allí se accede al chat autorizado o a la navegación completa del sistema. La pantalla de cliente conserva seguimiento, ETA y controles de seguridad sin distraer con instrucciones viales que no debe ejecutar.

Referencias técnicas primarias:

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [MapLibre Style Specification](https://maplibre.org/maplibre-gl-js/docs/style-spec/)
- [Raster sources del Style Spec](https://maplibre.org/maplibre-style-spec/sources/)
- [react-native-maps: instalación y compatibilidad](https://github.com/react-native-maps/react-native-maps)
- [Expo Maps](https://docs.expo.dev/versions/latest/sdk/maps/)
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)
- [Apple Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html)
