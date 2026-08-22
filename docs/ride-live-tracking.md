# Seguimiento mobile de Viajes

El viaje activo tiene una superficie dedicada y compartida entre Inicio y Actividad. La pantalla representa estados persistidos; no ejecuta una animación ficticia del conductor.

## Fuentes

- Job y transición de estado: PostgreSQL.
- Pickup y destino: columnas PostGIS del job.
- Conductor, vehículo, rating y GPS: driver asignado y su última ubicación autorizada.
- Ruta, distancia, duración y maniobras: endpoint de Routes con caché PostgreSQL.
- Seguridad: tracking link temporal, contactos cifrados e incidente SOS.

Mientras la hoja está abierta, mobile actualiza el estado cada cinco segundos. Cada cambio de posición vuelve a proyectar el conductor sobre el mapa; los cambios operativos publicados por la API reemplazan inmediatamente la etapa visible.

Estados presentados: `requested`, `driver_assigned`, `arriving`, `in_progress` y `completed`. La cancelación sigue el endpoint transaccional existente, exige motivo normalizado y conserva el resultado de reintegro.

## Degradación controlada

Si Routes no responde, la app conserva el estado operativo, los textos del viaje y las acciones de seguridad, y muestra explícitamente que la ruta no está disponible. Nunca inventa distancia ni movimiento para ocultar el error.
