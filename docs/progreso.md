# Progreso de desarrollo

Fecha de la última revisión: **25 de agosto de 2026**.

> Este documento es un **registro histórico acumulativo**. Las entradas de «Entregado» conservan la fecha en que se escribieron y varias describen un estado ya superado (por ejemplo, SQLite como base principal). Para el estado real y verificado de cada capacidad, la fuente es [`docs/matriz-madurez.md`](matriz-madurez.md).

## Resumen actual

Flash es una **plataforma de preproducción avanzada** con cuatro superficies: cliente, comercio, conductor/repartidor y operaciones. El runtime principal es PostgreSQL/PostGIS con 130 migraciones versionadas; SQLite quedó reducido a fallback aislado de tests.

La [auditoría del 25 de agosto de 2026](auditoria-2026-08-25.md) la evalúa en 6,2/10 y define nueve bloqueadores P0. De 91 capacidades inventariadas, el 81% de las existentes no está protegido por una puerta CI y ninguna fue probada contra un proveedor real.

**Congelamiento de funcionalidades activo** hasta el 20 de septiembre de 2026. Ver [`docs/plan-de-accion.md`](plan-de-accion.md).

## Entregado

- Frontend de cliente:
  - Busqueda de restaurantes y productos.
  - Carrito con extras, notas y cantidades.
  - Checkout de comida.
  - Cotizacion y solicitud de taxi.
  - Actividad, tracking, wallet y perfil.

- Frontend de comercio:
  - Pedidos activos por estado.
  - Avance de cocina.
  - Apertura/pausa del local.
  - Stock de productos.
  - Alta rapida de platos.

- Frontend de conductor/repartidor:
  - Online/offline.
  - Cambio de modo delivery/taxi.
  - Aceptacion de pedidos y viajes.
  - Avance de estados.
  - Vista de ganancias, vehiculo y zona.

- Superadmin web:
  - Dashboard operativo en escritorio.
  - Metricas de pedidos, viajes, drivers, restaurantes, tickets y GMV.
  - Investor Command Center con readiness, unit economics, milestones, funnel y riesgos.
  - Vista de actividad activa.
  - Zonas operativas.
  - Tickets y auditoria reciente.
  - Reset demo protegido por rol admin.

- Backend:
  - Express API.
  - SQLite persistente.
  - Passwords hasheadas con bcrypt.
  - JWT para sesiones.
  - Validacion con zod.
  - RBAC por rol.
  - Ownership por cliente, comercio y driver.
  - Auditoria de acciones relevantes.
  - Configuracion por entorno validada.
  - Headers de seguridad, CORS allowlist y rate limiting.
  - Request IDs y logs estructurados.
  - Health/readiness para operacion.
  - Stream SSE autenticado en `/api/events` con heartbeat, cleanup y eventos de mutacion.

- Producto e infraestructura:
  - PWA con manifest y service worker.
  - Base Expo/React Native para apps nativas en `apps/mobile`.
  - Dockerfile y Docker Compose.
  - Docker healthcheck.
  - GitHub Actions CI.
  - Documentacion competitiva, arquitectura, infraestructura, roadmap e investor readiness.
  - Smoke test de seguridad con `npm run test:security`.
- Geolocalizacion foreground: origen de taxi, cotizacion por coordenadas y tracking de drivers online.
- Migracion SQLite version 4 para posiciones de drivers y coordenadas de viajes.
- Cliente mobile crea pedidos, cotiza y solicita taxi, cancela operaciones propias y visualiza seguimiento.
- Comercio mobile gestiona cocina, ETA, stock y alta de productos con persistencia.
- Wallet sandbox registra cargas auditables y Perfil actualiza nombre, telefono y direccion principal.
- Perfil web/PWA incorpora la libreta de direcciones persistente: destinos Casa/Trabajo/Otro con alta, edición, selección de principal, eliminación y captura GPS para que checkout reutilice coordenadas reales.
- Actividad web/PWA incorpora tracking dedicado de pedidos: ruta vial OSRM como capa GeoJSON interactiva MapLibre, repartidor y posición cuando existen, ETA/timeline persistidos, compartir estado y fallback explícito ante coordenadas o mapas no disponibles.
- Actividad web/PWA incorpora tracking dedicado de viajes: ruta OSRM, vehículo/placa/rating, PIN de retiro, enlace temporal con vista pública móvil y reporte de incidentes conectado a la API autenticada.
- Actividad web/PWA incorpora tracking dedicado de envíos: ruta OSRM, destinatario, repartidor, ETA/timeline, PIN de entrega y metadatos de prueba de entrega desde endpoints autenticados.
- Viajes previo, tracking público y Actividad de comida/viajes/envíos comparten el mismo renderer web GPU con pan, zoom, reencuadre, atribución, colores por vertical y carga asíncrona.
- Mobile reemplazó mapas estáticos por Google Maps/Apple MapKit interactivos en cotización y tracking de comida, viajes y envíos; conserva rutas reales, estado de proveedor explícito y conductor sólo con GPS persistido.
- Viajes y envíos mobile reutilizan la coordenada persistida de la dirección predeterminada para mostrar contexto cartográfico desde el primer destino, sin asociar coordenadas antiguas a texto editado.
- Flash Driver suma mapa del próximo tramo, descarte de rutas obsoletas y traspaso seguro a Apple/Google para navegación giro a giro según plataforma y vehículo.
- Flash Driver dejó el dashboard monolítico: Home/Mapa, Ganancias, Inbox y Cuenta usan barra fija; el cockpit exclusivo de ruta concentra maniobra, ETA, próximos pasos, chat y guía externa, mientras el cliente ya no ve instrucciones de conducción.
- Flash Driver obtiene hoy, semana, servicios, propinas, ajustes, saldo Wallet y movimientos desde un endpoint propio ligado a la sesión y al ledger PostgreSQL; Home ya no muestra el `earningsToday` seed y el retiro externo queda explícitamente bloqueado.
- Cuenta Driver guarda en PostgreSQL el navegador externo preferido y el cockpit respeta esa decisión con URLs oficiales; ownership/RLS impide que otra identidad la lea o cambie.
- Expo mobile web separa el renderer `.native` de su fallback `.web`, por lo que 8081 sigue operativo sin intentar ejecutar componentes Fabric de mapas nativos.
- Web coordina la rotación de refresh entre recursos concurrentes y detiene polling/SSE al perder sesión; el login anónimo ya no agota el rate limit de autenticación.
- Cliente web/PWA incorpora solicitud de envíos: geocodificación de origen/destino, categorías y SLA desde backend, protección, firma, destinatario, términos, cotización firmada e idempotencia; el pago está limitado a Flash Wallet.

## Reglas estrictas implementadas

- `GET /api/state` requiere JWT valido.
- `GET /api/metrics` y `GET /api/admin/dashboard` requieren rol admin.
- Un cliente solo puede crear pedidos/viajes para si mismo, salvo admin.
- Un comercio solo puede modificar su restaurante/menu, salvo admin.
- Un driver solo puede cambiar su disponibilidad y aceptar trabajos propios, salvo admin.
- Un pedido solo puede avanzar si actua admin, el comercio responsable o el driver asignado.
- Un viaje solo puede avanzar si actua admin o el driver asignado.
- Cambios manuales de estado por usuarios no admin quedan limitados a cancelacion propia.
- Todas las mutaciones principales escriben eventos en `auditEvents`.
- Produccion no arranca con `JWT_SECRET` demo.
- Cada respuesta de API incluye `requestId`.
- `/api/ready` valida lectura basica de base.
- `/api/me` limita la cuenta a los datos del usuario autenticado.
- `/api/wallet/topup` valida montos y escribe transacciones de wallet.

## Como verificar

1. Ejecutar `npm run dev`.
2. Abrir `http://127.0.0.1:5173/`.
3. En escritorio, verificar que aparece solo `Flash Command`.
4. En viewport mobile, cambiar entre cliente, comercio, conductor y operaciones.
5. Crear un pedido como cliente.
6. Aceptarlo como conductor/repartidor y avanzarlo hasta entregado.
7. Crear un viaje como cliente y avanzarlo como conductor.
8. Entrar a operaciones y revisar metricas y auditoria.
9. Probar que `/api/reset` solo responde con token admin.
10. Ejecutar `npm run test:security`.

## Pendiente crítico

Reemplaza la lista anterior, cuyos ítems de PostgreSQL/PostGIS, ledger y realtime ya están implementados. Los bloqueadores vigentes son los P0 de la auditoría del 25 de agosto:

| Hallazgo | Ticket | Bloqueador |
| --- | --- | --- |
| H-01 | CI-001 | CI ejecuta 15 de 104 scripts y no levanta PostgreSQL: pagos, RLS, ledger, dispatch, KYC y safety no bloquean ningún merge |
| H-02 | NOT-001 | Push productivo imposible: `NOTIFICATION_PROVIDER` sólo admite `disabled` y `sandbox`, y producción prohíbe `sandbox` |
| H-03 | SEC-001 | Realtime hace broadcast a todos los roles ante `entityType` desconocido |
| H-04 | DAT-001 | 20 de 106 tablas sin política RLS y cero `FORCE ROW LEVEL SECURITY` |
| H-05 | INF-001 | La imagen Docker corre como root y arranca `server/index.js` en lugar de `server/start.js` |
| H-06 | DSP-001 | Dispatch sin `ST_DWithin` ni KNN: recalcula historial de 30 días de todo el padrón por oleada |
| H-07 | GEO-001 | Nominatim y OSRM públicos como valores por defecto |
| H-08 | ARC-001 | Cinco archivos concentran más de 1,3 MB, con líneas de hasta 4.061 caracteres |
| H-09 | PAY-001 | Mercado Pago integrado pero nunca validado contra el proveedor |

Además, sin ticket P0 asignado pero bloqueantes para las fases posteriores: framework estándar de pruebas (Vitest/Testcontainers/Playwright/k6), builds EAS firmados, crash reporting, error tracking, colector y dashboards administrados, Safety Operating System, y seguros y habilitación para movilidad.
