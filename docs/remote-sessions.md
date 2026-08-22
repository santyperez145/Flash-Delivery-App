# Sesiones y dispositivos

La cuenta puede enumerar sesiones activas mediante identificadores opacos, nombre del dispositivo, creación y vencimiento. Hashes y refresh tokens nunca se serializan. El usuario puede cerrar una sesión específica o conservar la actual y revocar todas las demás.

La revocación modifica el registro real usado por la rotación de refresh tokens: el dispositivo remoto pierde la capacidad de obtener nuevos access tokens. Cada acción queda auditada y aplica ownership por el usuario autenticado.

El endpoint “cerrar las demás” exige además el refresh token vigente de la sesión actual; un access token robado por sí solo no puede decidir cuál conservar. Mobile muestra el inventario en Cuenta, confirma operaciones destructivas y obtiene el refresh token únicamente desde Keychain/Keystore mediante la capa API, sin serializarlo en la interfaz.

Web no persiste access ni refresh tokens nuevos en `localStorage`. El refresh se
entrega como cookie HttpOnly `SameSite=Strict`; en producción usa el prefijo
`__Host-`, `Secure` y `Path=/`. Las llamadas de rotación/logout requieren además
`X-Flash-Client: web`, por lo que una petición cross-site simple no puede usar la
cookie. La API también valida `Origin` y `Sec-Fetch-Site` antes de leer o rotar
una cookie, y rechaza explícitamente contexto `cross-site`. El cliente migra una
credencial antigua una sola vez y elimina ambas
claves de almacenamiento al recibir la cookie. Las apps nativas mantienen el
contrato JSON porque una cookie HttpOnly no ofrece el mismo aislamiento dentro
de React Native; allí SecureStore protege la credencial.

Todas las respuestas de autenticación y toda ruta que valida un bearer token se
entregan con `Cache-Control: no-store, private` y `Pragma: no-cache`. Esto evita
que credenciales, datos de cuenta o sesiones terminen en la caché del navegador,
un proxy compartido o un CDN; los catálogos públicos conservan su caché explícita.

## Coordinación del refresh web

El cliente serializa la rotación: si varios recursos reciben `401` con el mismo access token, todos esperan una única llamada a `/auth/refresh`. Si esa rotación ya terminó cuando llega otra respuesta del token anterior, la petición se reintenta con el token actual sin rotar nuevamente. Esto protege el token rotativo contra carreras y evita consumir innecesariamente el rate limit de autenticación.

La pantalla de acceso no inicia bootstrap privado, polling ni SSE. Cuando una rotación deja de ser válida, la capa API borra credenciales, emite `flash:auth-required` y React desmonta las tareas autenticadas. React Strict Mode tampoco duplica el bootstrap inicial. `npm run test:web-auth-session` verifica concurrencia y gates; además se observó el runtime aislado durante más de un intervalo completo sin tráfico privado después de mostrar login.
