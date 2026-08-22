# Contrato OpenAPI

`GET /api/openapi.json` publica el contrato OpenAPI 3.1 versionado de Flash. Es
consumible desde el mismo origen por generadores de clientes, QA y herramientas
de documentación; no contiene tokens, credenciales ni ejemplos personales.

## Cobertura actual

- Liveness y readiness de PostgreSQL/Redis.
- Ciudades y zonas públicas.
- Registro, login, rotación y revocación de sesión.
- Inventario y cierre remoto de sesiones propias.
- Bearer JWT, respuestas de error, límites básicos y códigos HTTP relevantes.

La cobertura es incremental. Una ruta ausente todavía no tiene contrato público
y no debe integrarse por inferencia. Comida, viajes, envíos, dispatch, pagos,
comercios, soporte y operaciones se incorporarán por dominios junto con pruebas
de respuestas reales.

`npm run test:openapi-contract` inicia la API, comprueba referencias y
`operationId`, y enfrenta el documento con respuestas reales de health,
ciudades, validación de login y autorización de sesiones. CI bloquea cambios que
rompan este núcleo.
