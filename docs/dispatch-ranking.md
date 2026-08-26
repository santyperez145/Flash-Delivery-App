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

## Defecto abierto — sin recorte espacial previo

La consulta de candidatos calcula, **para cada conductor online del sistema**, `ST_Distance` (tres veces en la misma fila), el `count(*)` de trabajos activos vía `CROSS JOIN LATERAL`, y la tasa de aceptación de 30 días más el tiempo medio de respuesta vía `LEFT JOIN LATERAL` sobre `dispatch_offers`.

**No hay `ST_DWithin` para recortar el conjunto ni orden KNN `<->` para aprovechar el índice GiST.** Verificado: cero ocurrencias de ambos en todo el repositorio.

```bash
grep -rn "ST_DWithin\|<->" server/ database/ | wc -l   # → 0
```

Con decenas de conductores es irrelevante. Con cientos o miles por ciudad, cada oleada recalcula historial de 30 días para todo el padrón online, y el costo crece justo cuando la plataforma empieza a funcionar. El índice parcial por conductor y fecha sobre ofertas con resultado ayuda, pero no evita recorrer todos los candidatos.

Hallazgo [H-06](auditoria-2026-08-25.md#h-06--dispatch-sin-recorte-espacial-previo), ticket [DSP-001](backlog-tecnico.md#dsp-001--dispatch-v2). Prioridad P0.

## Arquitectura objetivo — dos etapas

### Etapa 1: generación rápida de candidatos

```sql
WHERE ST_DWithin(
  driver.current_location,
  job.pickup_location,
  :search_radius_m
)
ORDER BY driver.current_location <-> job.pickup_location
LIMIT 30
```

### Etapa 2: scoring avanzado

Sólo sobre esos 20–30 candidatos: ruta vial · ETA al pickup · espera prevista · ganancia neta · acceptance rate · cancelación · capacidad · preferencias · riesgo · SLA. El ETA y la distancia vial provienen de una Route Matrix del proveedor comercial, no de distancia geodésica.

### Estadísticas precomputadas

En lugar de recalcular el historial completo en cada oferta:

```text
driver_dispatch_stats
- driver_id
- service
- acceptance_rate_7d
- acceptance_rate_30d
- cancellation_rate_30d
- median_response_seconds
- completed_jobs_30d
- incident_score
- current_capacity
- updated_at
```

## Pendientes

- **P0 —** Recorte `ST_DWithin` + KNN, stats precomputadas y Route Matrix (ticket DSP-001).
- **P0 —** Oleadas de oferta, radio dinámico, protección contra inanición, prep time del comercio y dispatch manual desde backoffice.
- Antes de producción multiciudad deben incorporarse SLA comercial por comercio, tráfico vial actual, límites de equidad y monitoreo de sesgo por zona. Esos factores deben agregarse como componentes versionados, nunca como constantes opacas.

### SLO asociado

Primera oferta de dispatch: **p95 < 5 s**. El plan de consulta debe usar índice GiST, verificado con `EXPLAIN ANALYZE`, y sostenerse en una prueba de carga con un padrón sintético de al menos 1.000 conductores.
