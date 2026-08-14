# Investor readiness

Fecha base: 14 de agosto de 2026.

Objetivo: preparar Flash Delivery App para conversaciones de pre-seed/seed con una historia clara, KPIs correctos y un plan tecnico creible.

## Senales del mercado

Fuentes revisadas:

- Uber FY 2025 results: https://investor.uber.com/news-events/news/press-release-details/2026/Uber-Announces-Results-for-Fourth-Quarter-and-Full-Year-2025/default.aspx
- Uber investor relations overview: https://investor.uber.com/home/default.aspx
- DoorDash FY 2025 results: https://ir.doordash.com/news/news-details/2026/DoorDash-Releases-Fourth-Quarter-and-Full-Year-2025-Financial-Results/default.aspx
- DoorDash quarterly results: https://ir.doordash.com/financials/quarterly-results/default.aspx
- DoorDash Live Order Management: https://merchants.doordash.com/en-us/learning-center/live-order-management
- Uber Eats tracking help: https://help.uber.com/ubereats/restaurants/article/check-the-status-of-my-order-?nodeId=4148ea8b-c9d8-409d-b7bf-b2fcb019a498
- Expo SDK 57: https://expo.dev/changelog/sdk-57

Lectura:

- Uber y DoorDash reportan crecimiento alrededor de gross bookings/GOV, volumen de trips/orders, usuarios activos, rentabilidad ajustada y eficiencia operativa.
- El comercio ya no es un panel secundario: DoorDash empuja live order management para ajustar prep times, refund/substitution y disponibilidad.
- Cliente espera tracking en mapa, ETA y notificaciones claras.
- Mobile nativo importa para driver: background location, push, seguridad, documentos y flujo de aceptacion rapido.

## Narrativa de ronda

Flash es una plataforma multi-servicio para mercados urbanos donde la misma red de supply puede operar comida, delivery y taxi. El diferencial inicial:

- Una sola cuenta de cliente para comida y movilidad.
- Un solo driver puede alternar delivery/taxi.
- Comercio con herramientas live.
- Superadmin web con metricas, dispatch, riesgos, finanzas y auditoria.
- Base tecnica lista para migrar a Postgres/PostGIS, Redis GEO, realtime, pagos y mobile nativo.

## KPIs que deben medirse

- GMV/Gross bookings.
- Net revenue y take rate.
- Orders/trips por usuario activo.
- Fill rate delivery.
- Fill rate ride.
- ETA promedio.
- Tiempo hasta asignacion.
- Cancelation rate.
- Refund/credit rate.
- Supply online por zona.
- Driver utilization.
- Merchant active rate.
- AOV comida y fare promedio taxi.
- Contribution margin por job.
- CAC, LTV y payback.
- Retention por cohorte D7/D30/M3.
- NPS o CSAT cliente/driver/comercio.

## Lo que ya existe en el producto

- MVP fullstack.
- Superadmin desktop.
- Apps mobile/PWA por rol.
- Base Expo/React Native en `apps/mobile`.
- JWT, RBAC, ownership y audit events.
- Smoke test de seguridad.
- Health/readiness.
- Docker y CI.
- Investor Command Center en la consola admin.

## Gaps antes de una ronda fuerte

- Datos reales de usuarios y comercios piloto.
- Pagos sandbox/productivo y ledger.
- Tracking realtime con WebSocket/SSE.
- Geocoding/routing real.
- Mobile nativo instalable con push y ubicacion.
- Dashboard de cohortes y unit economics historico.
- Evidencia comercial: LOIs de comercios, pilotos, demanda local, costo de adquisicion.

## Plan de 90 dias

- Semana 1-2: cerrar mobile Expo base, auth segura, mapas y push.
- Semana 3-4: Postgres/PostGIS, migraciones y deploy staging.
- Semana 5-6: realtime dispatch y tracking.
- Semana 7-8: pagos sandbox, ledger y conciliacion.
- Semana 9-10: pilotos con comercios y drivers.
- Semana 11-12: tablero de cohortes, pitch deck, data room y demo investor-ready.

## Data room inicial

- `README.md`
- `ROADMAP.MD`
- `docs/arquitectura-producto.md`
- `docs/infraestructura-escalable.md`
- `docs/investigacion-competitiva.md`
- `docs/investor-readiness.md`
- `docs/deployment-checklist.md`
- CI verde en GitHub.
- Video demo corto de cliente/comercio/driver/admin.
