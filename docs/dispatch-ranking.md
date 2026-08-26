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

## Selección en dos etapas (DSP-001, 26 de agosto de 2026)

La versión anterior calculaba, **para cada conductor online del sistema**, `ST_Distance` tres veces, el conteo de trabajos activos y los agregados de aceptación y respuesta de 30 días. No había `ST_DWithin` ni orden KNN `<->` en todo el repositorio.

Con decenas de conductores da igual. Con cientos o miles por ciudad, cada oleada recorre el padrón entero: **el costo crece justo cuando la plataforma empieza a funcionar.**

### Etapa 1 — lista corta por cercanía

```sql
WHERE ST_DWithin(d.current_location, $1::geography, $3)
ORDER BY d.current_location <-> $1::geography
LIMIT $4
```

El punto de pickup entra **como parámetro, no como columna de un join**: el planificador sólo usa el índice para KNN cuando uno de los operandos es constante en la consulta. Si viniera de un join, el recorte existiría en el texto y no en el plan.

El filtro por `d.online` no es decorativo: el índice `drivers_available_location_gix` es parcial `WHERE online`, y sin esa condición no aplica.

Esta etapa **no** toca `dispatch_offers` ni historial. Para eso está la segunda.

### Etapa 2 — puntuación explicable sobre la lista corta

Los componentes del score son exactamente los de antes. **La optimización cambia a cuántos conductores se evalúa, no a quién se le ofrece el trabajo.**

### Radio dinámico y protección contra inanición

Un radio fijo deja trabajos sin ofrecer en zonas de baja densidad: el conductor más cercano existe, pero cae fuera del corte. La escalera parte de `DISPATCH_SEARCH_RADIUS_M` (8 km por defecto) y duplica hasta `DISPATCH_MAX_RADIUS_M` (25 km), **sólo si la lista corta no alcanza para llenar las ofertas pedidas**.

El radio usado y si hubo expansión quedan en `score_breakdown`, así que una zona que necesita expandir siempre es visible en lugar de degradar en silencio.

### Qué verifica cada puerta

`npm run test:dispatch-candidates` comprueba la forma de las consultas sin base de datos: que el recorte y el KNN existan, que el operando sea constante, que la etapa 1 no arrastre agregados y que la etapa 2 quede acotada a la lista corta. Incluye una regresión sobre el hallazgo original, cuya evidencia fue exactamente que no había ninguna ocurrencia de `ST_DWithin` ni de `<->`.

`npm run test:postgres` prueba el comportamiento de runtime contra PostgreSQL y bloquea el merge.

## Pendientes

- [x] Recorte `ST_DWithin` + KNN sobre el índice GiST parcial.
- [x] Radio dinámico con protección contra inanición, visible en el desglose.
- [ ] **`EXPLAIN ANALYZE` con un padrón sintético de al menos 1.000 conductores.** El contrato prueba la forma de la consulta; el plan hay que medirlo.
- [ ] **Stats precomputadas** (`driver_dispatch_stats`). La lista corta ya acota el historial a 30 conductores, así que dejó de ser urgente; pasa a ser optimización, no corrección.
- [ ] **ETA vial por Route Matrix.** `computeRouteMatrix()` existe y está verificado en el adapter de mapas; falta conectarlo al scoring y **requiere una API key habilitada**.
- [ ] Prep time del comercio y dispatch manual desde backoffice.
- Antes de producción multiciudad deben incorporarse SLA comercial por comercio, tráfico vial actual, límites de equidad y monitoreo de sesgo por zona. Esos factores deben agregarse como componentes versionados, nunca como constantes opacas.

### SLO asociado

Primera oferta de dispatch: **p95 < 5 s**. El plan de consulta debe usar índice GiST, verificado con `EXPLAIN ANALYZE`, y sostenerse en una prueba de carga con un padrón sintético de al menos 1.000 conductores.
