# Flash Delivery App Roadmap

Fecha base: 14 de agosto de 2026.

Este roadmap organiza Flash Delivery App como plataforma grande: marketplace de comida, movilidad/taxi, app de comercio, app de conductor/repartidor y superadmin web. La meta no es solo tener pantallas, sino construir una base operable, segura, medible y escalable.

## Vision

Flash debe competir con plataformas tipo Uber, Uber Eats y PedidosYa desde cuatro experiencias:

- Cliente mobile: comida, taxi, wallet, promociones, tracking y soporte.
- Comercio mobile/tablet: pedidos, cocina, menu, stock, horarios, promociones y soporte.
- Driver mobile: delivery/taxi, ofertas, navegacion, ganancias, documentos y seguridad.
- Superadmin web: operaciones, usuarios, comercios, drivers, zonas, pagos, soporte, auditoria y salud de plataforma.

## Estado actual

- [x] Frontend React/Vite responsive.
- [x] Mobile/PWA para cliente, comercio, conductor y operaciones.
- [x] Web desktop reservada para superadmin.
- [x] Backend Express con API real.
- [x] SQLite local persistente.
- [x] Login con bcrypt y JWT.
- [x] RBAC por roles: `customer`, `merchant`, `driver`, `admin`.
- [x] Ownership en servidor para pedidos, viajes, restaurantes y drivers.
- [x] Auditoria de mutaciones criticas.
- [x] Docker y Docker Compose.
- [x] Smoke test de seguridad con `npm run test:security`.
- [x] Documentacion de arquitectura, investigacion, infraestructura y progreso.
- [x] Investor Command Center en superadmin desktop.
- [x] Base Expo/React Native en `apps/mobile`.
- [x] Documento investor-ready con KPIs y data room inicial.

## Principios tecnicos

- Mobile primero para usuarios finales; desktop solo para administracion.
- Backend autoritativo: el frontend nunca decide permisos.
- Eventos auditables para cambios de estado, pagos, usuarios y configuracion.
- Separacion progresiva por dominios: identity, marketplace, dispatch, payments, support, notifications y admin.
- Datos transaccionales en Postgres; geoespacial en PostGIS; presencia y locks en Redis.
- Realtime para tracking, dispatch, chat y soporte.
- Observabilidad obligatoria desde beta: logs, metricas, trazas y alertas.
- Seguridad por defecto: JWT/refresh tokens, RBAC, ownership, rate limits, MFA admin y secretos fuera del codigo.

## Fase 1: MVP local serio

Objetivo: tener una app fullstack real que funcione en local y demuestre flujos completos.

Incluido:
- Cliente crea pedidos de comida.
- Cliente cotiza y solicita taxi.
- Comercio gestiona cocina, stock y productos.
- Driver acepta y avanza deliveries/viajes.
- Superadmin ve metricas, zonas, auditoria y actividad.
- API valida payloads, permisos y propiedad.

Criterios de salida:
- `npm run build` pasa.
- `npm run test:security` pasa.
- La app levanta con `npm run dev`.
- Los datos se persisten en SQLite.
- Acciones anonimas y cross-user quedan bloqueadas.

## Fase 2: Backend productivo

Objetivo: preparar el backend para beta cerrada.

Trabajo:
- Configuracion por entorno con validacion estricta.
- Headers de seguridad, CORS controlado y rate limiting.
- Request IDs y logs estructurados.
- Endpoints `/api/health` y `/api/ready`.
- CI en GitHub Actions.
- Tests de integracion por dominio.
- Error handling centralizado.

Criterios de salida:
- CI ejecuta build y smoke security en cada push/PR.
- Produccion falla si falta `JWT_SECRET` fuerte.
- Las respuestas incluyen `requestId`.
- Las rutas sensibles tienen limites de abuso.

## Fase 3: Datos productivos

Objetivo: pasar de demo local a datos de produccion.

Trabajo:
- Migrar SQLite a Postgres.
- Agregar PostGIS para zonas y distancia.
- Migraciones versionadas con Prisma, Drizzle o Knex.
- Indices para estados activos, usuarios, comercios, drivers, zonas y auditoria.
- Ledger financiero append-only.
- Backups automaticos y restore probado.

Criterios de salida:
- Migraciones reproducibles.
- Seeds por ambiente.
- Consultas principales indexadas.
- Auditoria y ledger no se editan destructivamente.

## Fase 4: Dispatch y realtime

Objetivo: asignar trabajos y tracking sin polling.

Trabajo:
- WebSockets o SSE para estado en vivo.
- Redis GEO para ubicacion de drivers.
- Worker de dispatch separado.
- Ofertas con expiracion y reasignacion.
- Algoritmo inicial por distancia, ETA, rating, aceptacion, modo y SLA.
- Simulador de demanda/oferta.

Criterios de salida:
- Pedido/viaje emite ofertas a drivers elegibles.
- Oferta expira y se reasigna.
- Cliente, comercio, driver y admin reciben eventos en vivo.
- Operaciones ve backlog en tiempo real.

## Fase 5: Apps mobile nativas

Objetivo: publicar apps reales para Android/iOS.

Trabajo:
- Monorepo `apps/mobile` con Expo/React Native.
- Builds separados para cliente, comercio y driver.
- Push notifications.
- Geolocalizacion foreground/background para driver.
- Onboarding con documentos, vehiculos y validaciones.
- Biometria opcional, deep links y crash reporting.

Criterios de salida:
- Builds EAS para Android/iOS.
- Driver comparte ubicacion en background con permisos correctos.
- Push llega para ofertas, cambios de estado y soporte.
- App mobile usable sin navegador.

## Fase 6: Pagos y finanzas

Objetivo: operar dinero real con conciliacion.

Trabajo:
- Integracion Mercado Pago, Stripe u otro PSP local.
- Wallet de cliente y driver.
- Ledger inmutable.
- Propinas, comisiones, reembolsos y ajustes.
- Liquidaciones de comercios y conductores.
- Antifraude inicial por usuario, dispositivo, tarjeta, zona y promo.

Criterios de salida:
- Cobros sandbox reales.
- Cada movimiento financiero tiene asiento en ledger.
- Superadmin puede conciliar pagos y resolver excepciones.

## Fase 7: Operacion y crecimiento

Objetivo: administrar una ciudad completa.

Trabajo:
- Soporte multiagente con SLA.
- Promociones, cupones, referidos y pricing dinamico.
- Ratings, calidad y suspensiones.
- Heatmaps de demanda.
- Forecast de oferta/demanda.
- Panel de onboarding de comercios y drivers.

Criterios de salida:
- Operaciones resuelve incidentes sin tocar base de datos.
- Marketing lanza promos con limites y medicion.
- Calidad puede suspender o revisar cuentas.

## Fase 8: Escala regional

Objetivo: soportar crecimiento multi-ciudad.

Trabajo:
- API Gateway.
- Servicios por dominio.
- Event bus con Kafka, Redpanda o Pub/Sub.
- Kubernetes/autoscaling o plataforma gestionada equivalente.
- OpenTelemetry, Prometheus/Grafana, Sentry y logs centralizados.
- Deploy canary/blue-green.
- WAF, rate limits por usuario/IP, secret manager y MFA admin.

Criterios de salida:
- SLOs por flujo critico.
- Runbooks operativos.
- Rollback probado.
- Pruebas de carga para cotizacion, dispatch, tracking y checkout.

## Proximo sprint

- Instalar y verificar `apps/mobile` con Expo Go/dev build.
- Diseñar migracion a Postgres/PostGIS.
- Implementar primer realtime con SSE para pedidos y viajes.
- Agregar pagos sandbox y ledger financiero.
- Crear pitch demo mode con datos de crecimiento historico.
