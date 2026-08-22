# Chat operacional por servicio

El chat conecta únicamente a los participantes reales de un job activo: cliente, conductor asignado y, en pedidos de comida, propietario del comercio. Está disponible en mobile desde Actividad, cocina del comercio y trabajos del conductor.

## Persistencia y privacidad

- `service_messages` relaciona cada mensaje con `jobs` y su remitente PostgreSQL.
- `service_message_reads` conserva una confirmación idempotente por mensaje y participante, sin duplicar contenido.
- `service_message_attachments` conserva nombre/MIME/tamaño y bytes cifrados en un sobre separado por dominio.
- `service_chat_quick_replies` reemplaza frases embebidas en la app por configuración PostgreSQL segmentada por vertical, audiencia e idioma.
- El cuerpo se cifra con AES-256-GCM, IV aleatorio y AAD versionado; la base nunca guarda texto plano.
- Un SHA-256 separado permite comprobar integridad operativa, pero el rol auditor no puede consultar ni el cifrado ni el digest.
- RLS limita filas a cliente, conductor asignado o comercio propietario. La API repite esa autorización antes de descifrar.
- Auditoría, realtime y notificaciones contienen sólo IDs; nunca copian el mensaje.
- Servicios finalizados o cancelados conservan lectura histórica pero rechazan nuevos mensajes.
- Adjuntos limitados a 750 KB y JPEG, PNG o PDF; la firma binaria debe coincidir con el MIME declarado.

## Contrato

- `GET /api/jobs/:jobId/messages`: últimos 200 mensajes, lectores y contador de no leídos.
- `POST /api/jobs/:jobId/messages`: texto normalizado de 1 a 1000 caracteres, limitado a 60 envíos por ventana.
- El mismo `POST` acepta un adjunto opcional y permite mensajes de sólo archivo.
- `POST /api/jobs/:jobId/messages/read`: confirma todos los mensajes ajenos pendientes y marca sus notificaciones in-app como leídas.
- `GET /api/service-message-attachments/:attachmentId/content`: descifra sólo después de revalidar participación actual.
- El cliente mobile refresca cada tres segundos mientras el modal está abierto y muestra estados de carga/error reales.
- Mobile muestra `Enviado`/`Leído` y ofrece respuestas rápidas sin fabricar entregas ni confirmaciones.
- Mobile selecciona archivos reales mediante el picker del sistema y los abre mediante la hoja nativa del dispositivo.
- Mobile solicita el catálogo contextual al abrir cada job; una respuesta desactivada deja de aparecer sin publicar un bundle nuevo.

## Operaciones

Flash Admin incluye la sección `Mensajes`. Un administrador puede crear, ordenar, editar, activar y desactivar respuestas para `food`, `ride`, `shipment` o todas las verticales, separadas para cliente, conductor y comercio. Las mutaciones quedan en la cadena de auditoría y los demás roles no acceden al CRUD.

La suite PostgreSQL verifica cifrado en reposo, conversación bidireccional, cierre por estado, bloqueo de clientes/comercios ajenos y ausencia de contenido en auditoría/realtime. `test:service-chat` comprueba no leídos, confirmaciones idempotentes, MIME real, digest exacto, cifrado de archivos, descarga autorizada, configuración contextual y CRUD exclusivo de administración. La suite RLS verifica además privilegios de columna y aislamiento directo en base.
