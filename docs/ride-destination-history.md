# Destinos guardados y recientes de Viajes

La búsqueda de destino mobile ya no depende de lugares de demostración. Combina dos fuentes privadas del cliente:

- direcciones guardadas (`Casa`, `Trabajo` u otras) con coordenadas PostGIS;
- destinos utilizados recientemente, ordenados por último uso y frecuencia.

## Flujo real

1. El cliente elige una dirección guardada o escribe un destino.
2. La app reutiliza coordenadas conocidas o geocodifica el texto mediante la API de mapas.
3. La cotización usa esas coordenadas, zona PostGIS y el plan tarifario activo.
4. Tras cotizar correctamente, `POST /api/ride-destinations` registra el destino canónico.
5. Una búsqueda equivalente incrementa `use_count` en vez de duplicar la fila.
6. El cliente puede eliminar un reciente con `DELETE /api/ride-destinations/:id`.

`GET /api/ride-destinations` devuelve como máximo ocho resultados para la interfaz. La base conserva los veinte más recientes por cuenta y elimina automáticamente el excedente.

## Privacidad y seguridad

- La tabla `ride_destination_history` usa FK al usuario, índice geoespacial GIST y unicidad por usuario/dirección normalizada.
- RLS limita lectura y escritura al propietario; administradores conservan acceso operativo explícito.
- La API vuelve a verificar ownership y responde 404 ante identificadores ajenos.
- El borrado genera auditoría sin copiar la dirección privada al evento.
- El rol auditor puede validar postura y cadena de auditoría, pero no recibe acceso transversal a historiales privados.

## Verificación

`npm run test:postgres` prueba autenticación, deduplicación, contador de uso, aislamiento entre clientes y borrado. `npm run test:rls` verifica el aislamiento directamente con un rol PostgreSQL sin bypass.
