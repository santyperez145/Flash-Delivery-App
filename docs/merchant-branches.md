# Sucursales e inventario localizado

La migración `041_merchant_branches.sql` separa la marca comercial de sus puntos operativos. Cada sucursal tiene dirección y coordenadas PostGIS, estado, apertura, ETA, radio de servicio e indicador de sede principal.

`catalog_branch_inventory` reutiliza el catálogo del comercio pero mantiene disponibilidad, cantidad y versión por sucursal. Esto evita que agotar un producto en Palermo cierre el mismo producto en otra sede.

La cotización firmada identifica la sucursal, calcula desde su ubicación y deja de cotizar cuando está pausada o cerrada. Al confirmar, el checkout vuelve a validar la sucursal y bloquea el inventario correspondiente; el job persiste `branch_id` y el pickup real.

Los comercios administran apertura/ETA/estado con `PATCH /api/restaurants/:restaurantId/branches/:branchId` e inventario con `PATCH /api/restaurants/:restaurantId/branches/:branchId/inventory/:itemId`. RBAC, ownership y auditoría protegen ambas operaciones.

El portal desktop **Flash Negocios → Sucursales** consume estas rutas: muestra estado operativo, coordenadas, ETA, disponibilidad agregada y switches independientes por producto. Las acciones actualizan PostgreSQL y refrescan la consola; se verificó además el cambio real de ETA desde la interfaz.
