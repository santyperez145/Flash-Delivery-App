# Redis y límites distribuidos

Cuando `REDIS_URL` está configurado, los límites API, auth, chat y prueba de entrega usan `rate-limit-redis` con prefijos separados y contadores compartidos. Redis ejecuta la operación atómica; cambiar de réplica no renueva el presupuesto del cliente.

Desarrollo puede usar MemoryStore y `/api/ready` lo declara como `memory-fallback`. Con `REDIS_REQUIRED=true`, la API no inicia sin configuración y readiness falla si Redis deja de responder. Docker Compose incluye Redis con AOF, healthcheck y política `noeviction`; producción debe usar un servicio administrado con TLS, autenticación, réplica y alertas.

CI levanta Redis real y `test:redis-rate-limit` alterna solicitudes entre dos procesos API para comprobar que el cuarto intento queda bloqueado globalmente. No se almacenan tokens ni emails en las claves de rate limiting.
