# Contrato OpenAPI

`GET /api/openapi.json` publica el contrato OpenAPI 3.1 versionado de Flash. Es
consumible desde el mismo origen por generadores de clientes, QA y herramientas
de documentación; no contiene tokens, credenciales ni ejemplos personales.

## Cobertura actual

- Liveness y readiness de PostgreSQL/Redis.
- Ciudades y zonas públicas.
- Registro, login, rotación y revocación de sesión.
- Inventario y cierre remoto de sesiones propias.
- Cotización firmada y creación idempotente de pedidos de comida.
- Opciones firmadas y creación idempotente de viajes.
- Cotización con protección y creación idempotente de envíos.
- Configuración pública de tokenización, conexión OAuth seller y webhook firmado.
- Comprobantes no fiscales de servicios propios finalizados.
- Creación, revocación y consulta pública minimizada de enlaces temporales de viaje.
- Ofertas privadas de dispatch y rechazo antes del TTL.
- Tickets de soporte, conversación visible y actualización exclusiva de agentes.
- Bearer JWT, respuestas de error, límites básicos y códigos HTTP relevantes.

La cobertura es incremental. Una ruta ausente todavía no tiene contrato público
y no debe integrarse por inferencia. Operaciones se incorporará por dominios
junto con pruebas de
respuestas reales.

`npm run test:openapi-contract` inicia la API, comprueba referencias y
`operationId`, y enfrenta el documento con respuestas reales de health,
ciudades, validación de login, autorización de sesiones, cotizaciones firmadas
de viajes/envíos y protección de creación de pedidos. CI bloquea cambios que
rompan este núcleo.

Las mutaciones con cuerpo aceptan exclusivamente `application/json` (incluidos
subtipos `application/*+json`). Cualquier cuerpo con otro `Content-Type` se
rechaza con `415` antes de autenticación, validación de dominio o escritura.

Crear un ticket exige `Idempotency-Key`. La clave queda ligada durante 24 horas al
usuario y al hash del payload: repetirla devuelve el mismo ticket; reutilizarla
con otro contenido responde `409`. Esto evita casos duplicados por doble toque,
refresh de sesión o pérdida de la respuesta móvil.

Los mensajes usan el mismo patrón: el retry devuelve la conversación vigente sin
duplicar mensaje, notificación, auditoría ni evento realtime. Una nota interna
continúa exigiendo rol `support` o `admin` antes de reclamar la clave.
