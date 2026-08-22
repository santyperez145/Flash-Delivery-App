# Registro operativo de vehículos

La app de conductor administra hasta cinco vehículos propios en PostgreSQL. Cada
registro conserva tipo, marca/modelo, patente normalizada, color, asientos y los
servicios compatibles. El alta nace `pending`: no habilita ofertas hasta una
revisión independiente de Operaciones.

## Reglas de suministro

- Existe como máximo un vehículo activo por conductor.
- Viajes de pasajeros exige `car` o `van`, asientos declarados y compatibilidad
  explícita con `ride`.
- Un conductor sólo puede conectarse si su legajo y su vehículo activo están
  aprobados, vigentes y son compatibles con el modo elegido.
- Dispatch repite esa verificación al seleccionar candidatos; no confía sólo en
  el estado `online`.
- Editar datos materiales devuelve el vehículo a revisión y desconecta al
  conductor.
- Retirar un vehículo es un soft delete: deja evidencia histórica, lo desactiva
  y lo saca de supply.

Mobile permite registrar, listar, activar y retirar. Flash Admin muestra la cola
por conductor y permite aprobar o rechazar con motivo. Las mutaciones tienen
ownership, RBAC y eventos de auditoría. RLS limita la lista a su conductor y
staff; el rol auditor observa estado y fechas, pero no patente, modelo ni color.

Rutas principales:

- `GET/POST /api/drivers/:driverId/vehicles`
- `PATCH/DELETE /api/driver-vehicles/:vehicleId`
- `POST /api/driver-vehicles/:vehicleId/activate`
- `PATCH /api/admin/driver-vehicles/:vehicleId/review`

`npm run test:driver-vehicles` cubre registro vacío, bloqueo de conexión,
ownership, aprobación independiente, proyección pública, revalidación tras
edición, rechazo, activación y retiro no destructivo.
