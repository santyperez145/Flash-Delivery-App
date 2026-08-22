# Libreta de direcciones

Las direcciones de cliente se persisten en PostgreSQL/PostGIS y se comparten entre comidas, viajes y envíos. Cada registro conserva etiqueta, texto normalizado, coordenadas `geography(Point,4326)` y estado predeterminado.

## Contrato

- `GET /api/addresses`: lista únicamente las direcciones del JWT actual.
- `POST /api/addresses`: crea una dirección geocodificada; la primera queda como principal.
- `PUT /api/addresses/:id`: actualiza etiqueta, dirección y coordenadas.
- `PATCH /api/addresses/:id/default`: cambia la principal atómicamente.
- `DELETE /api/addresses/:id`: elimina y promueve otra dirección si era la principal.

El servidor limita cada cuenta a diez direcciones, impone una sola principal mediante índice parcial único y sincroniza `profile.defaultAddress` dentro de la misma transacción. Los endpoints ignoran cualquier `userId` del cliente y derivan ownership exclusivamente del JWT. RLS protege lecturas directas y las mutaciones generan auditoría sin guardar el texto de la dirección.

Mobile geocodifica mediante el proxy autenticado OpenStreetMap antes de persistir, permite seleccionar la dirección para los tres servicios y evita operar sobre el registro textual legacy hasta convertirlo en una dirección con coordenadas.

El smoke PostgreSQL prueba alta, dos coordenadas, cambio atómico de principal, sincronización de cuenta, edición, eliminación y rechazo cross-user. `test:rls` verifica aislamiento físico de las filas.
