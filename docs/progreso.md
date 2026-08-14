# Progreso de desarrollo

Fecha: 14 de agosto de 2026.

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

- Producto e infraestructura:
  - PWA con manifest y service worker.
  - Dockerfile y Docker Compose.
  - Docker healthcheck.
  - GitHub Actions CI.
  - Documentacion competitiva, arquitectura, infraestructura y roadmap.
  - Smoke test de seguridad con `npm run test:security`.

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
- Realtime con WebSocket/SSE.
- Integracion real de mapas/geocoding/rutas.
- Integracion real de pagos y ledger.
- Expo/React Native para apps mobile publicables.
- Push notifications.
- Observabilidad y CI/CD.
