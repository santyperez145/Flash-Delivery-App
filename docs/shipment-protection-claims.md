# Siniestros de envíos protegidos

Flash gestiona internamente el ciclo verificable de un siniestro sin simular que es una aseguradora ni que realizó una transferencia externa.

- Sólo el propietario puede reclamar un envío con plan de protección, finalizado o cancelado durante los últimos siete días.
- Existe un único siniestro por envío.
- El monto elegible es el menor entre lo solicitado y el valor declarado menos la franquicia contratada.
- Estados: `submitted → under_review → approved → settlement_pending → settled`, con rechazo permitido antes de aprobar.
- Operaciones no puede aprobar por encima del monto elegible.
- El cliente puede adjuntar JPEG, PNG o PDF de hasta 750 KB mientras el caso está abierto; se validan los bytes reales, se cifra el contenido con AES-256-GCM y se registra SHA-256 para integridad.
- La descarga exige ownership del reclamo o rol de soporte/administración. El auditor sólo recibe metadatos y nunca el contenido cifrado ni su digest.
- `settlement_pending` representa honestamente que falta confirmación del proveedor habilitado.
- La narrativa del cliente está excluida de los privilegios del auditor y de los payloads de auditoría.

Mobile permite abrir, seguir y adjuntar/abrir evidencia desde Actividad. Flash Admin incorpora una cola de Siniestros con evidencia descargable, fundamento obligatorio, importe aprobado y transiciones controladas.

La integración futura con aseguradora debe mover un caso de `settlement_pending` a `settled` únicamente a partir de un webhook firmado e idempotente del proveedor.
