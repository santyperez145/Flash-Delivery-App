# Libreta de direcciones

Las direcciones de cliente se persisten en PostgreSQL/PostGIS y se comparten entre comidas, viajes y envíos. Cada registro validado conserva etiqueta, texto normalizado, coordenadas `geography(Point,4326)`, proveedor, identidad estable (`place_id` cuando el proveedor la ofrece), tipo, fecha de geocodificación y estado predeterminado.

## Contrato

- `GET /api/addresses`: lista únicamente las direcciones del JWT actual.
- `POST /api/addresses`: exige `validationToken`, crea la coincidencia firmada y deja la primera como principal.
- `PUT /api/addresses/:id`: exige una validación nueva; editar texto invalida la coincidencia anterior.
- `PATCH /api/addresses/:id/default`: cambia la principal atómicamente.
- `DELETE /api/addresses/:id`: elimina y promueve otra dirección si era la principal.

El proxy de mapas firma cada resultado durante 15 minutos con issuer y audiencia propios y lo liga al usuario autenticado. Al guardar, PostgreSQL usa el texto, coordenadas, proveedor y `place_id` del token; ignora las copias manipulables del cliente. Producción además rechaza un proveedor comunitario o una coincidencia sin `place_id`. Los registros anteriores a la migración 136 permanecen honestamente sin validar y no entran al checkout de comida.

El servidor limita cada cuenta a diez direcciones, impone una sola principal mediante índice parcial único y sincroniza `profile.defaultAddress` dentro de la misma transacción. Los endpoints ignoran cualquier `userId` del cliente y derivan ownership exclusivamente del JWT. RLS protege lecturas directas y las mutaciones generan auditoría sin guardar texto, token ni `place_id` completo.

Web y mobile muestran hasta cinco coincidencias del proveedor configurado y obligan a elegir una antes de guardar. El smoke PostgreSQL prueba ausencia de token, reutilización cross-user, sustitución de texto/coordenadas manipulados por los datos firmados, cambio atómico de principal, edición y eliminación. `test:maps` verifica la firma y `test:rls` el aislamiento físico de las filas.
