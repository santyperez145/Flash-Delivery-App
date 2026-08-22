# Contactos de confianza para Viajes

El cliente puede mantener hasta cinco contactos y elegir uno al compartir el seguimiento temporal de un viaje activo.

## Protección de datos

- El teléfono se valida en formato E.164.
- PostgreSQL almacena un sobre AES-256-GCM, un HMAC para deduplicación y únicamente los últimos cuatro dígitos para presentación.
- El nombre y el teléfono completo no se incorporan a eventos de auditoría.
- El rol auditor sólo puede consultar postura, relación, últimos cuatro dígitos y fechas; no posee privilegio sobre identidad, ciphertext ni HMAC.
- RLS y ownership de API impiden leer o borrar contactos de otra cuenta.

## API

- `GET /api/ride-trusted-contacts`
- `POST /api/ride-trusted-contacts`
- `DELETE /api/ride-trusted-contacts/:contactId`

La app mobile permite crear, listar y eliminar contactos. Durante un viaje activo crea primero un enlace de seguimiento revocable y con vencimiento, y luego abre el selector nativo para enviárselo a la persona elegida. Flash no afirma haber enviado un SMS si el usuario no completó la acción en el dispositivo.

Las garantías de cifrado, deduplicación, aislamiento cross-user y privilegios restringidos se cubren en `test:postgres` y `test:rls`.
