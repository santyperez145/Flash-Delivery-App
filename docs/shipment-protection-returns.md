# Protección y devoluciones de envíos

La migración `062_shipment_protection_returns.sql` incorpora planes de protección configurables, valor declarado y solicitudes de devolución en PostgreSQL. El plan inicial `standard` aplica una prima de 1,5 %, un mínimo de $200, un valor declarado máximo de $1.000.000 y un deducible de $5.000. Estos importes son datos operativos administrables en base de datos, no constantes confiadas al cliente.

## Precio protegido

`POST /api/shipments/quote` recibe `declaredValue` y `protection`. La API valida el límite del plan, calcula prima y transporte, y firma ambos atributos junto con la ruta y las características del paquete. `POST /api/shipments` vuelve a calcular y compara la cotización; cambiar el valor declarado o la protección invalida el token y evita crear o cobrar el envío.

La app mobile geocodifica origen y destino mediante la API de mapas, muestra transporte, prima, deducible y total, y sólo permite confirmar con coordenadas y cotización vigentes.

## Devolución

- `POST /api/shipments/:shipmentId/returns`: sólo el cliente propietario, para un envío entregado durante los últimos siete días.
- `GET /api/shipment-returns`: el cliente sólo ve sus solicitudes; soporte y administración pueden operar la cola completa.
- `PATCH /api/shipment-returns/:returnId`: restringido a soporte/administración y a transiciones válidas.

La base impone una solicitud por envío. La API evita revelar la existencia de envíos ajenos, registra auditoría y la app muestra el avance en Actividad.

## Límites explícitos

La protección actual es un cálculo contractual y operativo de la plataforma. No representa todavía una póliza emitida ni liquida siniestros: para producción se necesita integrar un proveedor habilitado, requisitos documentales, evaluación antifraude, conciliación y reglas regulatorias de la jurisdicción.

## Verificación

`npm run test:postgres` cubre prima y deducible server-side, manipulación del token, ownership, unicidad y estados. `npm run test:rls`, `npm run test:security`, `npm run build` y `npm run mobile:typecheck` completan las puertas del bloque.
