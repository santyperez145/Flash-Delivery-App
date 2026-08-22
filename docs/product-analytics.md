# Analytics first-party

`product_events` registra un vocabulario cerrado para medir home → checkout → job creado, con IDs idempotentes, usuario/ciudad internos y retención predeterminada de 90 días. No guarda IP, dirección, coordenadas, búsquedas, texto libre, email, teléfono ni tokens; el servidor rechaza claves sensibles y payloads mayores a 2 KB.

El ingreso acepta lotes autenticados de hasta veinte eventos y sólo 24 horas de atraso. Operaciones consulta agregados y usuarios únicos, nunca eventos desde el cliente. `analytics:prune` aplica retención y `test:product-analytics` prueba deduplicación, privacidad, RBAC y embudo sobre PostgreSQL.

La instrumentación inicial debe limitarse a decisiones de producto. No se integran SDK publicitarios ni fingerprinting. Antes de una beta externa se requiere consentimiento/aviso legal según jurisdicción y un job programado de retención.
