# Go/no-go por zona

Operaciones evalúa cada zona con cinco gates: conductores online con GPS reciente/preciso, sucursales activas, trabajos completados en siete días, cancelación máxima y tickets urgentes abiertos. Todos deben aprobar; falta de volumen produce `no_go`.

`GET /api/operations/zones/:zoneId/readiness` calcula una vista actual. `POST .../readiness-assessments` persiste un snapshot inmutable con política, hechos, decisión y operador, además del audit event. El resultado no activa la zona automáticamente: habilitar cobertura continúa siendo un cambio operativo separado.

Los umbrales viven en `zone_readiness_policies`. Antes de modificarlos debe existir revisión operacional; reducirlos para obtener artificialmente `go` invalida el piloto.
