# Conciliación de pagos

Flash Admin dispone de una cola persistente de excepciones financieras basada en hechos de PostgreSQL. No reemplaza ni simula la conciliación del PSP contratado.

El escaneo detecta:

- intentos `requires_confirmation` o `authorized` estancados más de 30 minutos;
- capturas cuyo estado o importe no coincide;
- reintegros confirmados cuya suma supera el importe capturado;
- webhooks firmados con una referencia de intento desconocida;
- webhooks con firma inválida o error de procesamiento.

A esos cinco se suma un sexto que **no nace del escaneo**: `negative_balance`. Lo abre la reversión de un reintegro, en la misma transacción que escribe el asiento, cuando deja el saldo de una parte en números rojos. Aparece en el momento del hecho y no en el barrido siguiente, porque el hecho es el asiento. Ver [Finanzas de comercios](merchant-finance.md#saldo-en-negativo-por-reintegro).

Cada hallazgo tiene fingerprint idempotente, severidad, primera y última detección, referencia externa y hechos mínimos sin payload del proveedor. Resolver o ignorar exige fundamento, actor y timestamp; si una discrepancia resuelta reaparece, vuelve a abrirse. Los casos ignorados permanecen ignorados durante escaneos posteriores.

La ruta de consulta y las mutaciones requieren rol `support` o `admin`. El auditor restringido puede revisar postura y resolución, pero no la columna `details`. Tokens de pago y payloads del proveedor nunca se copian a la cola ni a eventos de auditoría.

La conexión productiva con Mercado Pago, Stripe u otro PSP sigue requiriendo credenciales, contratos y webhooks específicos del proveedor.
