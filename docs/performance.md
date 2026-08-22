# Rendimiento y capacidad

La puerta local reproducible se ejecuta con:

```bash
npm run test:performance
```

Realiza login, calienta cada escenario y envía 30 solicitudes por ruta con
concurrencia 10. Mide `ready`, catálogo PostgreSQL, agregado autenticado de
cliente, cotización PostGIS de viaje y cotización PostGIS de envío. Falla ante
cualquier respuesta no 2xx o si un p95 supera 500 ms. Los parámetros pueden
ajustarse con `PERFORMANCE_ITERATIONS`, `PERFORMANCE_CONCURRENCY` y
`PERFORMANCE_MAX_P95_MS`.

Medición local del 14 de agosto de 2026 sobre PostgreSQL 17/PostGIS 3.6:

| Escenario | p50 | p95 | Errores |
| --- | ---: | ---: | ---: |
| Ready con chequeo PostGIS | 27.50 ms | 33.41 ms | 0 |
| Catálogo | 4.31 ms | 6.31 ms | 0 |
| Estado autenticado de cliente | 49.19 ms | 71.35 ms | 0 |
| Cotización de viaje | 14.07 ms | 18.51 ms | 0 |
| Cotización de envío | 14.98 ms | 17.55 ms | 0 |

Es evidencia de presupuesto en el entorno local, no una afirmación de capacidad
productiva. Antes de beta deben repetirse pruebas sostenidas con datos de volumen,
red real, réplica de la infraestructura objetivo y perfiles de lectura/escritura.

La API publica histogramas Prometheus estándar en
`flash_http_request_duration_seconds_bucket`, normalizando identificadores de
ruta para evitar cardinalidad descontrolada. Esto permite calcular p50/p95/p99 y
alertar por flujo en el entorno desplegado.
