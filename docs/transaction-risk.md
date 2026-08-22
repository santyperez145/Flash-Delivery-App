# Riesgo transaccional

Antes de crear o cobrar una compra, viaje o envío, Flash registra una evaluación idempotente basada en hechos actuales de PostgreSQL.

Señales iniciales:

- importe elevado o crítico;
- cuenta creada hace menos de 24 horas;
- velocidad de servicios durante los últimos 10 minutos;
- gasto acumulado durante la última hora;
- intentos de pago fallidos durante las últimas 24 horas.

Cada señal aporta puntos explicables. Menos de 50 permite la operación, entre 50 y 79 la permite pero la envía a revisión, y desde 80 la bloquea antes de crear el servicio o mover dinero. Reintentar con la misma clave de idempotencia reutiliza exactamente la misma evaluación.

La cola de Flash Admin permite clasificar evaluaciones `review` y `block` como fraude confirmado, falso positivo o verificada. La decisión conserva actor, fundamento y timestamp. Clientes no acceden al scoring ni a sus reglas; el auditor restringido ve resultados pero no las señales internas para reducir manipulación del motor.

Este motor es una primera defensa transaccional explicable. Para producción debe complementarse con señales del PSP, device intelligence, listas de sanciones, contracargos y un proveedor especializado cuando corresponda.
