# Viajes programados

El cliente puede solicitar un viaje inmediato o reservarlo entre 30 minutos y
30 días hacia adelante. `scheduledFor` usa ISO-8601 con zona explícita y se
persiste en `jobs.scheduled_for`; el servidor vuelve a validar los límites y no
confía en la hora presentada por el cliente.

## Flujo operativo

1. `/api/rides/options` firma por cinco minutos tarifa, servicio, direcciones y
   coordenadas exactas. Cambiar cualquier elemento invalida el token.
2. `POST /api/rides` guarda la reserva y su captura Wallet de forma idempotente.
3. Se crea confirmación inmediata y un recordatorio para 30 minutos antes.
4. No se crean ofertas mientras falten más de 15 minutos.
5. El worker de dispatch incorpora automáticamente la reserva al entrar en esa
   ventana y mantiene las garantías de capacidad y aceptación atómica.
6. Cancelar retira todas las ofertas y reintegra una captura Wallet, si existía.

La app móvil ofrece Ahora, En 1 hora y Mañana, muestra fecha/hora en actividad y
mantiene la reserva como dato del backend. Un selector calendario más granular y
políticas de cancelación por ciudad siguen pendientes.
