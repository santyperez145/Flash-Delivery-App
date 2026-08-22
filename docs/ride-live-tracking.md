# Seguimiento de Viajes

El viaje activo tiene una superficie dedicada y compartida entre Inicio y Actividad, tanto en mobile nativo como en la PWA web. La pantalla representa estados persistidos; no ejecuta una animación ficticia del conductor.

## Fuentes

- Job y transición de estado: PostgreSQL.
- Pickup y destino: columnas PostGIS del job.
- Conductor, vehículo, rating y GPS: driver asignado y su última ubicación autorizada.
- Ruta, distancia, duración y maniobras: endpoint de Routes con caché PostgreSQL.
- Seguridad: tracking link temporal, contactos cifrados, PIN de retiro e incidente SOS.

Mientras la hoja nativa está abierta, mobile actualiza el estado cada cinco segundos. En web, SSE actualiza la actividad autenticada y la hoja vuelve a consultar la ruta cuando cambian las coordenadas persistidas. Cada cambio de posición vuelve a proyectar el conductor sobre el mapa; los cambios operativos publicados por la API reemplazan inmediatamente la etapa visible.

La PWA también permite consultar el PIN de retiro mientras el viaje está `driver_assigned` o `arriving`, crear un enlace temporal de seguimiento de 180 minutos y registrar un incidente tipificado con ubicación vigente. El enlace sólo se crea para el propietario autenticado y la API registra la acción; no se exponen teléfonos ni se afirma que se haya enviado un SMS.

El enlace abre `/track/:token`, una vista web pública móvil que consulta el snapshot mínimo de `/api/public/rides/track/:token` cada diez segundos. Esa vista muestra estado, ETA, origen/destino, conductor y posición sólo cuando existe; nunca recibe sesión, pago, email, teléfono ni el PIN de retiro.

Estados presentados: `requested`, `driver_assigned`, `arriving`, `in_progress` y `completed`. La cancelación sigue el endpoint transaccional existente, exige motivo normalizado y conserva el resultado de reintegro.

## Degradación controlada

Si Routes no responde, la app conserva el estado operativo, los textos del viaje y las acciones de seguridad, y muestra explícitamente que la ruta no está disponible. Nunca inventa distancia ni movimiento para ocultar el error.

## Benchmark y decisión de producto

El patrón se contrastó con la [guía oficial de seguridad para pasajeros de Uber](https://www.uber.com/us/en/ride/safety/tips/) y la [Safety Toolkit oficial](https://www.uber.com/us/en/newsroom/ubers-new-safety-toolkit/): compartir viaje, PIN, ayuda contextual y reporte durante el trayecto deben estar dentro de la vista activa. Flash replica la capacidad funcional con proveedores propios y deja fuera integraciones no habilitadas, como llamadas automáticas a servicios de emergencia o SMS de terceros.
