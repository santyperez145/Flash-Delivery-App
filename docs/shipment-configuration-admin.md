# Configuración operativa de Envíos

Flash Admin incluye una sección **Envíos** para modificar la oferta operativa sin desplegar código ni editar la base manualmente. Las categorías controlan nombre, instrucciones, recargo y peso máximo; los SLA controlan nombre, multiplicador tarifario, multiplicador de ETA y distancia máxima.

## Flujo real

1. La consola carga categorías y SLA activos desde `GET /api/shipment-options`.
2. Un administrador guarda un cambio mediante el endpoint específico de categoría o nivel de servicio.
3. La API valida límites, persiste en PostgreSQL y registra actor, roles, request ID, estado anterior y posterior.
4. Toda cotización posterior vuelve a leer esta configuración y refleja el cambio en precio, ETA o elegibilidad.
5. Los tokens de cotización ya emitidos conservan el importe firmado durante su vigencia, evitando cambios silenciosos entre aceptación y creación.

La consola administrativa carga también las opciones inactivas y permite reactivarlas. El endpoint público conserva únicamente opciones activas, por lo que mobile nunca ofrece una modalidad pausada.

## Límites defensivos

- Recargo: entre $0 y $100.000.
- Peso máximo: mayor que 0 y hasta 20 kg.
- Multiplicador de transporte: 0,5 a 5.
- Multiplicador de ETA: 0,25 a 3.
- Distancia máxima: nula o mayor que 0 y hasta 500 km.
- Sólo el rol `admin` puede mutar estos valores; clientes y conductores reciben `403`.
- `GET /api/admin/shipment-options` incluye inactivas y está protegido; `GET /api/shipment-options` es público pero filtra sólo activas.

## Verificación

`npm run test:postgres` cubre autorización, rechazo de límites inválidos, cambio y restauración por API, impacto en una cotización real y auditoría antes/después. `npm run test:rls` confirma que el rol de auditoría puede inspeccionar postura operativa sin alterar precios.

Antes de producción quedan pendientes aprobación de cuatro ojos, vigencia programada, alertas de desvío y rollback visual. Estas tareas están explícitas en el roadmap y no se presentan como resueltas.
