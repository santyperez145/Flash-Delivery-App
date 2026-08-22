# Observabilidad y SLO

La API conserva métricas Prometheus protegidas y ahora emite trazas OpenTelemetry OTLP protobuf. La instrumentación se carga antes de Express, HTTP y PostgreSQL para mantener la relación entre petición y consultas. Está deshabilitada por defecto en local y no convierte la indisponibilidad del colector en una indisponibilidad de la API.

## Configuración

- `OTEL_ENABLED=true`
- `OTEL_SERVICE_NAME=flash-api`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://collector.example/v1/traces`

Cada petición incorpora ruta de baja cardinalidad, estado, duración y `flash.request.id`. No se exportan cuerpos, tokens, direcciones ni coordenadas. `npm run test:telemetry` levanta un receptor efímero y exige recibir un lote OTLP real.

## SLO iniciales de beta cerrada

Ventana móvil de 28 días:

- Disponibilidad API crítica: 99,9 % para login, cotización, creación, aceptación y transición de jobs.
- Cotización: 95 % menor a 800 ms y 99 % menor a 2 s, excluyendo fallas declaradas del proveedor de rutas.
- Creación idempotente: 99 % menor a 1,5 s y duplicados económicos igual a cero.
- Dispatch: 95 % de jobs elegibles con primera oferta en menos de 30 s.
- Tracking: 99 % de eventos persistidos disponibles para reanudación antes de 5 s.
- Pagos: cero desbalance de ledger; conciliaciones pendientes por más de 15 minutos generan incidente.

El presupuesto de error de disponibilidad es 0,1 % mensual. Al consumir 50 % antes de la mitad de la ventana se congelan cambios no esenciales; al consumir 100 % sólo se permiten correcciones de confiabilidad. `observability/prometheus-rules.yml` implementa burn rate rápido/sostenido, latencia, pool PostgreSQL y dead-letter; cada alerta tiene severidad, espera y runbook versionado. Falta conectar Prometheus/Alertmanager y paging a un entorno administrado para considerar `OBS-001` completo.
