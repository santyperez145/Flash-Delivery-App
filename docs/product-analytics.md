# Analytics first-party

`product_events` registra un vocabulario cerrado para medir home → checkout → job creado, con IDs idempotentes, usuario/ciudad internos y retención predeterminada de 90 días. No guarda IP, dirección, coordenadas, búsquedas, texto libre, email, teléfono ni tokens; el servidor rechaza claves sensibles y payloads mayores a 2 KB.

El ingreso acepta lotes autenticados de hasta veinte eventos y sólo 24 horas de atraso. Operaciones consulta agregados y usuarios únicos, nunca eventos desde el cliente. `analytics:prune` aplica retención y `test:product-analytics` prueba deduplicación, privacidad, RBAC y embudo sobre PostgreSQL. `test:product-analytics-local` cubre el mismo contrato sobre el fallback SQLite que se usa sin `DATABASE_URL`.

Web y las tres variantes nativas usan una cola first-party de memoria, con lotes de hasta veinte, límite de cien eventos y reintento espaciado ante una falla de transporte. La cola no bloquea pedidos, viajes ni envíos: si el endpoint está caído, la capacidad principal sigue funcionando y el evento se descarta al superar el límite de memoria.

La instrumentación inicial debe limitarse a decisiones de producto. No se integran SDK publicitarios ni fingerprinting. Antes de una beta externa se requiere consentimiento/aviso legal según jurisdicción y un job programado de retención.
