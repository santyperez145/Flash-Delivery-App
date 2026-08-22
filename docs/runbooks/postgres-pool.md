# PostgreSQL pool

Revisar conexiones total/idle/waiting, consultas lentas y transacciones abiertas. No aumentar el pool sin comprobar el límite del servidor. Detener workers no esenciales si compiten con operaciones de cliente y validar `/api/ready` tras mitigar.
