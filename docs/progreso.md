# Progreso de desarrollo

Fecha: 22 de agosto de 2026.

## Resumen actual

Flash Delivery Mobility ya es una app fullstack local con cuatro superficies: cliente, comercio, conductor/repartidor y superadmin. La experiencia mobile funciona como PWA para validacion; la experiencia desktop queda reservada para gestion de plataforma.

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
- Actividad web/PWA incorpora tracking dedicado de pedidos: ruta vial OSRM sobre mosaicos OSM, repartidor y posición cuando existen, ETA/timeline persistidos, compartir estado y fallback explícito ante coordenadas o mapas no disponibles.
- Actividad web/PWA incorpora tracking dedicado de viajes: ruta OSRM, vehículo/placa/rating, PIN de retiro, enlace temporal con vista pública móvil y reporte de incidentes conectado a la API autenticada.
- Actividad web/PWA incorpora tracking dedicado de envíos: ruta OSRM, destinatario, repartidor, ETA/timeline, PIN de entrega y metadatos de prueba de entrega desde endpoints autenticados.

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

## Pendiente critico

- Suite completa de tests unitarios/integracion/e2e.
- Migracion a Postgres/PostGIS.
- Filtrado realtime por audiencia, Redis Pub/Sub y WebSocket para presencia/chat.
- Integracion real de mapas/geocoding/rutas.
- Geocoding y rutas viales con proveedor externo; hoy existe distancia geodesica por coordenadas y fallback por texto.
- Integracion real de pagos y ledger.
- Expo/React Native para apps mobile publicables.
- Push notifications.
- Observabilidad y CI/CD.
