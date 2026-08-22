# Recuperación segura de contraseña

El login mobile incluye solicitud y confirmación de recuperación. La API responde el mismo mensaje exista o no el email, evitando enumeración de cuentas.

- Token aleatorio de 256 bits, válido durante 20 minutos y de un solo uso.
- PostgreSQL conserva únicamente SHA-256; el rol auditor tampoco puede leer ese digest.
- Solicitar otro token invalida el anterior.
- El cambio rechaza reutilizar la contraseña vigente, limpia bloqueos y revoca todas las sesiones refresh.
- Solicitud y consumo quedan auditados sin registrar email, contraseña ni token.
- El outbox cifra el token con AES-256-GCM en una columna inaccesible para inbox y auditoría. El worker usa entrega sandbox verificable localmente o SMTP autenticado en producción, con reintentos y registro de cada intento.
- En desarrollo la respuesta también incluye `developmentToken` para facilitar QA. Producción nunca lo expone y exige SMTP más una clave de cifrado independiente.

Validación: `npm run test:password-recovery`.
