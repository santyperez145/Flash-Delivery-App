# Sesiones y dispositivos

La cuenta puede enumerar sesiones activas mediante identificadores opacos, nombre del dispositivo, creación y vencimiento. Hashes y refresh tokens nunca se serializan. El usuario puede cerrar una sesión específica o conservar la actual y revocar todas las demás.

La revocación modifica el registro real usado por la rotación de refresh tokens: el dispositivo remoto pierde la capacidad de obtener nuevos access tokens. Cada acción queda auditada y aplica ownership por el usuario autenticado.

El endpoint “cerrar las demás” exige además el refresh token vigente de la sesión actual; un access token robado por sí solo no puede decidir cuál conservar. Mobile muestra el inventario en Cuenta, confirma operaciones destructivas y obtiene el refresh token únicamente desde Keychain/Keystore mediante la capa API, sin serializarlo en la interfaz.
