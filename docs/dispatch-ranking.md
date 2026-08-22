# Ranking de dispatch

Cada oleada consulta candidatos elegibles en PostgreSQL/PostGIS y calcula un score explicable. El ranking actual combina:

- rating del conductor;
- distancia vial aproximada al pickup mediante PostGIS;
- carga activa por tipo de servicio;
- frescura de la última ubicación GPS;
- tasa de aceptación de ofertas de los últimos 30 días para la misma vertical;
- velocidad media de respuesta a ofertas aceptadas o rechazadas.

Las ofertas expiradas cuentan como no aceptación; las retiradas por el sistema no penalizan al conductor. Cuando no existe historial se usa un prior neutral de 50% de aceptación y 20 segundos de respuesta, evitando favorecer o castigar cuentas nuevas.

## Explicabilidad

`dispatch_offers.score_breakdown` conserva los componentes usados al crear cada oferta. El contrato del driver devuelve `scoreBreakdown`, y las apps muestran aceptación histórica y tiempo medio de respuesta. La notificación de la oferta utiliza el mismo snapshot, por lo que el score no cambia retrospectivamente.

La suite PostgreSQL crea historial controlado, abre una nueva oleada con el worker real activo y comprueba que la tasa y el tiempo persistidos coincidan con los agregados históricos.
La consulta usa un índice parcial por conductor y fecha sobre ofertas con resultado, incluyendo estado, respuesta y job para evitar escaneos completos a medida que crece el historial.

## Pendientes

Antes de producción multiciudad deben incorporarse SLA comercial por comercio, tráfico vial actual, límites de equidad y monitoreo de sesgo por zona. Esos factores deben agregarse como componentes versionados, nunca como constantes opacas.
