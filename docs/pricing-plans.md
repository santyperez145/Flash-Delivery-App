# Planes de precios

Las tarifas activas de viajes y envíos viven en `pricing_plans`. Cada plan tiene servicio, versión, moneda, vigencia y configuración JSON validada como objeto. Un índice parcial garantiza una sola versión activa por servicio.

## Viajes

El plan define bajada de bandera, precio por kilómetro y minuto, cargo de servicio, peajes, factor vial, límites de distancia, cálculo de ETA y multiplicadores por modalidad. El multiplicador PostGIS de la zona se aplica después sobre el subtotal.

Las opciones retornan `pricingVersion`; el token JWT firmado bloquea versión, importe, desglose, modalidad, direcciones y coordenadas durante cinco minutos.

## Envíos

El plan define base, distancia, peso, factor vial, ETA y multiplicadores de tamaño. La zona de entrega se aplica como multiplicador adicional y la versión se persiste en metadata del job.

La cotización de envío también entrega un JWT de cinco minutos. La creación exige ese token y compara origen, destino, coordenadas, tamaño y peso; cualquier alteración o expiración obliga a volver a cotizar.

La prueba integral modifica temporalmente la tarifa PostgreSQL, confirma que el endpoint cambia el importe y restaura la configuración. Esto evita que una prueba superficial pase mientras el runtime continúa usando constantes del código.

El fallback embebido existe únicamente para la suite SQLite aislada. Cuando `DATABASE_URL` está configurado, la ausencia de un plan activo produce indisponibilidad en lugar de cotizar con valores silenciosos.

## Gobierno y vigencia

`POST /api/admin/pricing/:service` ya no publica directamente: crea una fila `pending` en `pricing_change_requests`, con configuración validada, solicitante y fecha de vigencia. Otro administrador debe aprobarla mediante `PATCH /api/admin/pricing-changes/:requestId/review`; la base y el servidor impiden que solicitante y revisor sean la misma persona.

Una aprobación inmediata cierra la versión activa e inserta la nueva dentro de una transacción con advisory lock por servicio. Una aprobación futura permanece `approved` hasta su fecha. `npm run worker:pricing` activa la cola sin depender de tráfico y la lectura del cotizador ejecuta el mismo procedimiento como respaldo. Las versiones históricas nunca se sobrescriben.

La sección **Tarifas** de Flash Admin permite partir del plan activo, editar parámetros numéricos, programar vigencia y revisar la cola. Estados, actor, revisor, fundamento y activación quedan persistidos y auditados.

## Riesgo y rollback

Cada solicitud se compara en servidor contra el plan activo recorriendo todos sus coeficientes numéricos, incluidos multiplicadores anidados. Se persiste el máximo cambio porcentual y hasta doce advertencias con campo, valor anterior, valor nuevo y dirección:

- `low`: variación máxima menor a 20%.
- `medium`: desde 20% y menor a 50%.
- `high`: 50% o más.

Las solicitudes de riesgo alto se destacan en Flash Admin y el servidor exige al revisor un fundamento reforzado de al menos 20 caracteres. El cliente no puede rebajar esta clasificación.

Un rollback no modifica una fila histórica. `POST /api/admin/pricing/:service/rollback` copia la configuración inmutable de una versión anterior a una nueva solicitud `rollback`; vuelve a calcular riesgo y requiere el mismo segundo administrador. Sólo después de aprobarse genera una nueva versión activa, preservando trazabilidad completa.

Endpoints:

- `GET /api/admin/pricing-changes`
- `POST /api/admin/pricing/:service`
- `POST /api/admin/pricing/:service/rollback`
- `PATCH /api/admin/pricing-changes/:requestId/review`

La regresión PostgreSQL prueba autoaprobación rechazada, segundo administrador real, activación inmediata, vigencia futura y cambio efectivo de la cotización firmada.
