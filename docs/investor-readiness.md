# Investor readiness

Fecha base: 14 de agosto de 2026. Revisado el 25 de agosto de 2026 contra [`docs/auditoria-2026-08-25.md`](auditoria-2026-08-25.md). **Actualizado el 28 de agosto de 2026**: la lista de gaps técnicos de abajo describía bloqueadores ya cerrados, que es exactamente la deriva que persigue [DOC-001](backlog-tecnico.md).

Objetivo: preparar Flash Delivery App para conversaciones de pre-seed/seed con una historia clara, KPIs correctos y un plan tecnico creible.

## Posición honesta

Flash es una **plataforma de preproducción avanzada**, evaluada en 6,2/10. Es apta para demo a inversores, desarrollo interno, staging serio y prueba cerrada de delivery tras resolver los P0.

**Lo que se puede afirmar en una conversación de ronda:**

- Arquitectura considerablemente más seria que la mayoría de proyectos en etapa temprana: PostgreSQL/PostGIS con 134 migraciones, RLS, ledger de doble entrada, auditoría encadenada con SHA-256, idempotencia, dispatch geoespacial con aceptación atómica y realtime durable con replay.
- Cobertura funcional comparable conceptualmente a la suma de marketplace, mobility platform, merchant OS, driver OS y operations command center.
- **Paridad comercial con la categoría cerrada**: suscripción, propina en el checkout, reserva de horario con reprogramación y pedidos grupales, los cuatro cableados en web y móvil. Ver [`docs/investigacion-competitiva.md`](investigacion-competitiva.md).
- Integración con Mercado Pago construida: OAuth PKCE, tokens cifrados, `application_fee`, idempotencia, refund, webhook y conciliación.

**Lo que no debe afirmarse:**

- Que la plataforma esté probada con proveedores reales. De 91 capacidades inventariadas, **ninguna alcanzó ese estado**.
- Que exista operación, usuarios, dinero real o liquidez.
- Que la confiabilidad sea comparable a Uber o PedidosYa.
- Que los viajes públicos estén habilitados: **no hay marco legal confirmado en La Rioja**, y no debe inferirse legalidad por la presencia de competidores.

El estado real por capacidad está en [`docs/matriz-madurez.md`](matriz-madurez.md) y es la fuente para cualquier afirmación en un data room.

### El riesgo que un inversor va a detectar

> Flash tiene más superficie funcional de la que hoy puede validar, mantener y operar de manera confiable.

La respuesta correcta no es minimizarlo, sino mostrar el plan de estabilización: congelamiento de funcionalidades, puertas CI bloqueantes, proveedores reales y una zona operada antes de expandir. Ver [`docs/plan-de-accion.md`](plan-de-accion.md).

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

- Plataforma multiaudiencia: cliente, comercio, conductor, operaciones, soporte y auditoría.
- PostgreSQL/PostGIS con 134 migraciones versionadas.
- RLS, RBAC, ownership, MFA administrativo y sesiones rotativas.
- Ledger de doble entrada, conciliación y revisión de payouts.
- Auditoría append-only encadenada con SHA-256.
- Idempotencia, locks y aceptación atómica de ofertas.
- Dispatch geoespacial con ranking explicable y expiración.
- Realtime durable con secuencia y replay por cursor.
- Integración Mercado Pago con OAuth PKCE, `application_fee`, refund y webhook.
- Apps Expo con variantes customer, driver y merchant, y background location.
- OpenTelemetry OTLP, alertas Prometheus y runbooks.
- Feature flags, analytics first-party y readiness por zona.
- Docker Compose con roles PostgreSQL separados.

## Gaps antes de una ronda fuerte

Los gaps de Postgres/PostGIS, ledger y realtime de la versión anterior están cerrados. Los vigentes son:

**Técnicos (P0, Fase 0).** Al 28 de agosto quedan tres, y los tres esperan algo externo:

- **Push productivo imposible por configuración.** Espera credenciales FCM/APNs y un dispositivo físico.
- **Mapas públicos por defecto.** Espera una clave de proveedor comercial.
- **Sin entorno desplegado.** El destino está decidido —[GCP `southamerica-east1`](despliegue.md)— y espera una cuenta.

Cerrados y verificables por puerta: CI corre PostgreSQL y los flujos críticos y bloquea el merge · realtime default-deny sobre 44 publicaciones (`test:realtime-audience`) · las 69 tablas por-usuario tienen política RLS (`test:rls-matrix`) · imagen Docker sin root y con el entrypoint real, construida en cada PR · dispatch con recorte espacial y orden KNN (`test:dispatch-candidates`) · el monolito pasó a 118 módulos de servidor, con `index.js` en 33 KB.

**De validación (Fase 1):** ninguna capacidad probada contra un proveedor real · Mercado Pago sin sellers de prueba ni conciliación operada · sin builds EAS firmados · sin crash reporting ni error tracking · restore drill sin cronometrar contra el RTO.

**Comerciales:** datos reales de usuarios y comercios piloto · dashboard de cohortes y unit economics histórico · **contribution margin por job**, que es la puerta económica de la Fase 2 · LOIs de comercios · demanda local medida · costo de adquisición.

**Regulatorios:** encuadre legal de movilidad en La Rioja · seguros · tratamiento fiscal del split de pagos.

## Plan hasta la ronda

Alineado con [`docs/plan-de-accion.md`](plan-de-accion.md). El plan de 90 días anterior está superado: sus semanas 3-8 ya se ejecutaron.

- **25 ago – 20 sep 2026 (Fase 0):** estabilización. Puertas CI bloqueantes, realtime default-deny, matriz RLS, imagen endurecida, push real, proveedor de mapas comercial y modularización.
- **21 sep – 22 nov 2026 (Fase 1):** beta técnica. Mercado Pago validado extremo a extremo en sandbox, tres builds mobile internos, dispatch v2, restore drill y prueba de carga.
- **23 nov 2026 – 28 feb 2027 (Fase 2):** piloto controlado en La Rioja con 15–25 comercios, 20–40 repartidores y 300–500 usuarios invitados. **Cierra con contribution margin calculable.**
- **Mar – may 2027 (Fase 3):** Flash Business e integraciones POS. Primeros contratos B2B recurrentes.

La narrativa de ronda más fuerte no es «vamos a competir con Uber», sino **«tenemos una zona operada, con margen medido y contratos B2B recurrentes»**.

## Data room inicial

- `README.md`
- `docs/auditoria-2026-08-25.md` — auditoría integral con evidencia verificable
- `docs/plan-de-accion.md` — plan de ejecución con fechas y criterios de salida
- `docs/matriz-madurez.md` — estado real de cada capacidad
- `docs/backlog-tecnico.md` — bloqueadores P0 y su definición de terminado
- `ROADMAP.MD`
- `docs/arquitectura-producto.md`
- `docs/infraestructura-escalable.md`
- `docs/investigacion-competitiva.md`
- `docs/investor-readiness.md`
- `docs/deployment-checklist.md`
- CI verde en GitHub.
- Video demo corto de cliente/comercio/driver/admin.

Incluir la auditoría y la matriz de madurez en el data room es deliberado: **un inversor técnico va a encontrar estos problemas de todos modos**, y presentarlos medidos, priorizados y con plan es una señal de control, no de debilidad.
