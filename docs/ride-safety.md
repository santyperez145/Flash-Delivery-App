# Seguridad y seguimiento compartido de viajes

La pantalla de viaje activo permite crear un enlace temporal de seguimiento y activar un SOS. Ya no comparte un texto estático.

## Privacidad del enlace

- El servidor genera 256 bits aleatorios y entrega el bearer token una sola vez.
- PostgreSQL conserva únicamente SHA-256, vencimiento, revocación y contador de vistas.
- Crear otro enlace revoca el anterior. El pasajero también puede revocarlo explícitamente.
- La vista pública no expone teléfono, email, apellido del conductor ni datos de pago. Devuelve estado, ruta, ETA, primer nombre, vehículo y última ubicación disponible.
- Las respuestas públicas usan `Cache-Control: no-store` y están sujetas al rate limit global.

## SOS

Un participante de un viaje activo puede persistir un incidente `sos`, `medical`, `harassment`, `crash`, `unsafe_driving` u `other`. La app pide confirmación y trata de adjuntar ubicación GPS de alta precisión; si el permiso falla, la alerta se envía igualmente. El incidente queda abierto en PostgreSQL, genera notificaciones para roles de operaciones/soporte, evento realtime y auditoría sin guardar el token compartido.

Validación local: `npm run test:ride-safety`.

## Control del viaje (SEG-01)

Como RideCheck de Uber: durante un viaje en curso, Flash detecta cuatro señales y le
pregunta al pasajero si está todo bien.

| Señal | Cuándo |
| --- | --- |
| Parada larga | El auto no se mueve más de 50 m en 5 minutos de viaje y el GPS sigue llegando; la espera en el punto de encuentro no cuenta |
| Señal perdida | No llega ubicación del conductor hace 3 minutos |
| Desvío | El auto se aleja del corredor origen-destino más que el mayor entre 1,5 km y el 35 % del largo del viaje |
| Final lejos del destino | El viaje se cierra a más de 500 m del destino, con una ubicación de los últimos 2 minutos; con una vieja no se afirma |

- **El corredor no es la ruta.** Flash no guarda la geometría vial del viaje, y una calle
  real nunca es la recta: el margen amplio evita avisar por un desvío normal. Por eso la
  pantalla dice «se alejó del recorrido», no «tomó otra ruta».
- **Dónde corre.** La detección vive en la base (`app.detect_ride_trip_checks`, migración
  141) y la llama el worker de despacho en cada vuelta. El final lejos del destino lo
  detecta un trigger al cerrar el viaje, por cualquier camino que se cierre.
- **Aviso.** El pasajero recibe una push esencial (`security_alert`), que sale aunque
  haya apagado las novedades de servicio, y ve el aviso en el seguimiento del viaje y en
  el inicio de Viajes, en web y móvil. Operaciones recibe un aviso interno.
- **Respuesta.** «Estoy bien» cierra el aviso, y esa señal no se vuelve a preguntar antes
  de 10 minutos. «Pedir ayuda» abre un incidente `sos` en la misma cola que el botón SOS,
  con la ubicación del conductor. Sólo contesta quien viaja.
- **Ubicación del incidente.** Si «Pedir ayuda» llega sin coordenadas (el aviso del
  inicio no las tiene), vale la posición del conductor guardada al detectar la señal.
- **Cada aviso se contesta una vez.** La respuesta queda atada al aviso: si después llega
  otro del mismo viaje, se pregunta de nuevo. Un aviso de un viaje que se cerró mientras
  corría el barrido vence antes de avisarse.
- **El móvil relee los viajes.** El seguimiento y el inicio toman los viajes de la
  actividad, que el bootstrap no trae: ahora releen su primera página cada 5 segundos
  siguiendo un viaje y cada 15 en el inicio. Antes el estado quedaba congelado en lo que
  se vio al abrir Actividad, y un aviso nuevo no llegaba a la pantalla.
- **Push con texto.** Al armar esto apareció que todas las push salían sin título ni texto:
  el envío los leía de columnas que la tabla de notificaciones no tiene. Ahora salen del
  `payload`.

Validación: `npm run test:ride-trip-checks` arma un viaje propio y recorre las cuatro
señales, el aviso, quién contesta, el incidente, que una señal contestada no se repita, la
espera en el punto de encuentro, la ayuda sin coordenadas y el cierre con GPS viejo.
`test:rls` prueba que el pasajero ve sus avisos y que otro cliente y el conductor no.
Si falla, el pasajero puede quedar sin aviso en un viaje que se detuvo o se desvió. Corre
en `ci-critical-flows` y borra todo lo que crea.
