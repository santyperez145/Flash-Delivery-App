# Sesiones y dispositivos

La cuenta puede enumerar sesiones activas mediante identificadores opacos, nombre del dispositivo, creación y vencimiento. Hashes y refresh tokens nunca se serializan. El usuario puede cerrar una sesión específica o conservar la actual y revocar todas las demás.

La revocación modifica el registro real usado por la rotación de refresh tokens: el dispositivo remoto pierde la capacidad de obtener nuevos access tokens. Cada acción queda auditada y aplica ownership por el usuario autenticado.

El endpoint “cerrar las demás” exige además el refresh token vigente de la sesión actual; un access token robado por sí solo no puede decidir cuál conservar. Mobile muestra el inventario en Cuenta, confirma operaciones destructivas y obtiene el refresh token únicamente desde Keychain/Keystore mediante la capa API, sin serializarlo en la interfaz.

Web no persiste access ni refresh tokens nuevos en `localStorage`. El refresh se
entrega como cookie HttpOnly `SameSite=Strict`; en producción usa el prefijo
`__Host-`, `Secure` y `Path=/`. Las llamadas de rotación/logout requieren además
`X-Flash-Client: web`, por lo que una petición cross-site simple no puede usar la
cookie. El cliente migra una credencial antigua una sola vez y elimina ambas
claves de almacenamiento al recibir la cookie. Las apps nativas mantienen el
contrato JSON porque una cookie HttpOnly no ofrece el mismo aislamiento dentro
de React Native; allí SecureStore protege la credencial.

Todas las respuestas de autenticación y toda ruta que valida un bearer token se
entregan con `Cache-Control: no-store, private` y `Pragma: no-cache`. Esto evita
que credenciales, datos de cuenta o sesiones terminen en la caché del navegador,
un proxy compartido o un CDN; los catálogos públicos conservan su caché explícita.
