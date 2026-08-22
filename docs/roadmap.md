# Roadmap de producto

El roadmap rector actualizado está en `ROADMAP.MD` y adopta `C:\Users\santiago\Desktop\FlashAPP.txt`, recalibrado contra el runtime PostgreSQL actual. Este archivo conserva detalle histórico; ante diferencias prevalece “Roadmap rector adoptado — 21 de agosto de 2026”.

Fecha base: 14 de agosto de 2026.

Objetivo: llevar Flash Delivery Mobility desde MVP fullstack local hasta plataforma competitiva con apps mobile, dispatch en tiempo real, pagos, soporte y operacion escalable.

## Norte de producto

Flash debe operar cuatro superficies reales:

- Cliente mobile: pedir comida, pedir taxi, pagar, seguir estados y resolver problemas.
- Comercio mobile/tablet: aceptar y preparar pedidos, manejar stock, tiempos, menu y soporte.
- Driver mobile: alternar delivery/taxi, recibir ofertas, navegar, cobrar y liquidar ganancias.
- Superadmin web desktop: gobernar la plataforma, usuarios, comercios, drivers, zonas, pagos, soporte, auditoria y salud operativa.

## Estado actual

- [x] Frontend React/Vite responsive con modo mobile para apps y desktop para superadmin.
- [x] Backend Express con API real.
- [x] Fallback local SQLite aislado para demo y pruebas sin `DATABASE_URL`.
- [x] Runtime principal PostgreSQL/PostGIS sin lecturas ni escrituras SQLite, verificado de punta a punta.
- [x] Destinos de viaje guardados y recientes persistidos con coordenadas PostGIS, deduplicación, retención, ownership y RLS.
- [x] Login con bcrypt y JWT.
- [x] RBAC inicial por roles `customer`, `merchant`, `driver`, `admin`.
- [x] Ownership en servidor para pedidos, viajes, restaurantes y drivers.
- [x] Auditoria de mutaciones relevantes.
- [x] Tarifas versionadas con doble aprobación, vigencia programada, worker, riesgo porcentual, rollback histórico y trazabilidad de solicitante/revisor.
- [x] Propinas post-servicio y correcciones parciales/totales con doble aprobación, concurrencia segura y ledger balanceado.
- [x] Smoke test de seguridad para JWT/RBAC/ownership.
- [x] Configuracion validada por entorno.
- [x] Headers de seguridad, CORS allowlist y rate limiting inicial.
- [x] Request IDs, logs estructurados y readiness.
- [x] CI en GitHub Actions.
- [x] PWA instalable para pruebas internas.
- [x] Docker para ejecucion reproducible.
- [x] Documentacion de investigacion, arquitectura e infraestructura.

## Fase 1: MVP serio local

Meta: que el producto sea usable de punta a punta sin servicios externos.

Ya incluido:
- Cliente crea pedidos con carrito, extras, notas y checkout.
- Cliente cotiza y crea viajes.
- Comercio abre/pausa local, avanza cocina, administra stock y crea productos.
- Driver cambia disponibilidad, acepta delivery/viaje y avanza estados.
- Superadmin ve metricas, actividad, zonas, tickets y puede intervenir.
- Backend valida payloads, usuarios, roles y propiedad.

Criterios de salida:
- `npm run build` pasa sin errores.
- `npm run test:security` pasa sin errores.
- Crear pedido, aceptar delivery, avanzar hasta entregado y auditar evento.
- Crear viaje, asignar conductor, avanzar hasta completado y auditar evento.
- Un usuario no puede modificar recursos ajenos por API.
- Reset demo solo funciona con rol admin.

## Fase 2: Datos productivos

Meta: reemplazar la persistencia demo por una base preparada para produccion.

Trabajo:
- [x] Migrar los dominios operativos y de identidad a PostgreSQL/PostGIS.
- Agregar migraciones versionadas con Prisma, Drizzle o Knex.
- Usar PostGIS para zonas, conductores cercanos y busqueda geoespacial.
- Separar `users`, `roles`, `permissions`, `sessions`, `orders`, `rides`, `payments`, `ledger`, `audit_events`.
- Crear seeds por ambiente y fixtures de prueba.
- Backups automaticos y restore probado.

Criterios de salida:
- Migraciones reproducibles en local, staging y produccion.
- Indices para estados activos, geolocacion y consultas de backoffice.
- Auditoria append-only.
- Tests de integridad para pedidos, viajes y liquidaciones.

## Fase 3: Realtime y dispatch

Meta: que la app deje de depender de polling y tenga asignacion operativa real.

Trabajo:
- WebSockets o SSE para pedido, viaje, chat, driver location y notificaciones internas.
- Redis para presencia de drivers, ubicacion viva, locks y cache.
- Worker de dispatch separado de la API.
- Algoritmo inicial de asignacion por distancia, modo, disponibilidad, rating, aceptacion y SLA.
- Reintentos, expiracion de ofertas y reasignacion automatica.
- Simulador de demanda/oferta para probar zonas.

Criterios de salida:
- Un pedido/viaje genera ofertas a drivers elegibles.
- Una oferta expira y se reasigna.
- El cliente ve tracking sin recargar.
- Operaciones ve backlog y drivers online en tiempo real.

## Fase 4: Apps mobile nativas

Meta: entregar apps reales para stores y uso diario.

Trabajo:
- Crear monorepo mobile con Expo/React Native.
- Apps separadas o builds con sabores: cliente, comercio, driver.
- Login seguro, refresh tokens, biometria opcional.
- Geolocalizacion foreground/background para driver.
- Push notifications con Firebase Cloud Messaging/APNs.
- Deep links para pagos, soporte, invitaciones y tracking.
- Onboarding de driver con documentos, vehiculo y validaciones.

Criterios de salida:
- Builds Android/iOS con EAS.
- Driver puede compartir ubicacion en background con permisos correctos.
- Push llega para nueva oferta, cambio de estado y soporte.
- Flujo mobile usable sin navegador desktop.

## Fase 5: Pagos, wallet y liquidaciones

Meta: cobrar, conciliar y pagar ganancias sin depender de datos simulados.

Trabajo:
- Integrar Mercado Pago, Stripe u otro PSP local.
- Crear ledger inmutable para cargos, comisiones, propinas, reintegros y ajustes.
- Wallet de usuario y driver.
- Liquidaciones por comercio y conductor.
- Reembolsos parciales/totales.
- Reglas antifraude basicas por usuario, tarjeta, dispositivo, zona y promocion.

Criterios de salida:
- Pedido/viaje puede cobrarse con proveedor real en sandbox.
- Cada movimiento financiero queda en ledger.
- Superadmin puede ver conciliacion y resolver excepciones.

## Fase 6: Operacion competitiva

Meta: convertir la plataforma en negocio operable.

Trabajo:
- Soporte multiagente con SLA, macros, historial y escalamiento.
- [~] Promociones, cupones y referidos operativos; falta consola de campañas de referidos con aprobación dual y antifraude por dispositivo/hogar.
- Ratings y calidad por comercio/driver/cliente.
- Moderacion, suspensiones y documentos vencidos.
- Panel de demanda por zona, heatmaps y forecast.
- Herramientas para onboarding de comercios.

Criterios de salida:
- Operaciones puede resolver incidentes sin tocar base de datos.
- Existen reglas de calidad y riesgo visibles.
- Marketing puede lanzar promos con limites y medicion.

## Fase 7: Escala e infraestructura

Meta: preparar el sistema para crecimiento regional.

Trabajo:
- API Gateway y servicios por dominio.
- Event bus con Kafka, Redpanda o Pub/Sub.
- Kubernetes o plataforma gestionada con autoscaling.
- Observabilidad con OpenTelemetry, Prometheus/Grafana, Sentry y logs estructurados.
- CI/CD con pruebas, migraciones, escaneo de seguridad y despliegues canary.
- Rate limiting, WAF, secret manager, rotacion de claves y MFA para admin.

Criterios de salida:
- SLOs por flujo critico.
- Alertas accionables y runbooks.
- Deploy seguro con rollback.
- Prueba de carga para cotizacion, dispatch y tracking.

## Proximo sprint recomendado

- Migrar schema local a migraciones SQL.
- Crear tests automatizados de autorizacion y ownership.
- Implementar WebSocket/SSE para actualizaciones de pedidos y viajes.
- Agregar modulo `payments` con proveedor sandbox.
- Crear estructura `apps/mobile` con Expo para cliente, comercio y driver.
