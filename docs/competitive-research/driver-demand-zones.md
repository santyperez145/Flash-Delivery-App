# Demanda por zonas en Flash Driver

Investigación verificada el 22 de agosto de 2026. Se comparan patrones funcionales; Flash no copia activos, texto ni identidad de las plataformas citadas.

## Referencias oficiales

- [Uber Driver App](https://www.uber.com/us/en/drive/driver-app/): Home concentra disponibilidad, mapa, zonas ocupadas, preferencias y Safety; la navegación giro a giro comienza después de aceptar un servicio.
- [Uber: offline delivery heatmap](https://www.uber.com/us/en/blog/offline-delivery-heatmap/): las zonas delimitadas comunican intensidad de demanda y se actualizan periódicamente. La propia fuente evita garantizar pedidos.
- [DoorDash Dasher App Overview](https://help.doordash.com/en-us/dashers/article/dasher-app-overview): Home muestra Hotspots de alto volumen para orientar dónde esperar; Ganancias, agenda y cuenta viven en secciones separadas.
- [DoorDash: offer matching](https://help.doordash.com/en-us/dashers/article/how-do-i-get-matched-with-offers): una oferta depende de disponibilidad, ubicación, ETA y otros factores, por lo que un hotspot no equivale a una asignación.

## Decisión Flash

- La primera versión muestra actividad **observada**, agregada por polígonos `service_zones` de PostGIS.
- La demanda usa trabajos despachables del modo activo, sin conductor y disponibles dentro de los próximos 15 minutos. En comida, un pedido pagado sólo se vuelve despachable cuando el comercio lo marca `ready_for_pickup`; preparación no se presenta al conductor como oferta disponible.
- La oferta usa sólo conductores online del mismo modo, GPS de hasta 5 minutos y 100 metros de precisión, compliance aprobado, vehículo aprobado y capacidad operativa libre.
- `high` requiere al menos tres trabajos y más trabajos que conductores elegibles; `medium` requiere al menos uno; `low` significa que no hay trabajos abiertos observados.
- Se devuelven conteos zonales y polígonos, nunca direcciones ni coordenadas de trabajos o de otros conductores.
- El snapshot no es forecast, no garantiza ofertas o ganancias y no altera precio. Surge, predicción y recomendaciones de posicionamiento quedan fuera hasta tener modelos, operación, monitoreo de sesgos y validación real.

## Contrato y degradación

- `GET /api/driver/demand-zones` deriva conductor, ciudad y modo desde la sesión.
- La respuesta es privada, `no-store` y exige rol Driver.
- Sin PostgreSQL/PostGIS responde `503`; no existe fallback simulado.
- `observedAt` y `methodology` permiten a la app explicar vigencia y limitaciones.
