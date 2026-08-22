# Destino geoespacial de pedidos de comida

El checkout de comida ya no confía en un texto libre ni reutiliza la ubicación del comercio como destino. Cada pedido PostgreSQL exige `deliveryAddressId`, valida que la dirección pertenezca al cliente autenticado y toma de la base tanto el texto canónico como su `geography(Point, 4326)`.

La creación persiste:

- pickup y dropoff PostGIS diferentes;
- distancia geodésica comercio-cliente en metros;
- ETA inicial que combina preparación del comercio y traslado;
- `locationEstimated: false`;
- identificador de la dirección usada dentro del snapshot operacional.

La dirección participa en el hash de idempotencia. Una dirección ajena o inexistente se rechaza antes de reclamar la clave, cobrar Wallet o crear residuos financieros.

Mobile permite elegir cualquiera de las direcciones geocodificadas de la libreta. Al crear una dirección mediante Nominatim, queda seleccionada inmediatamente para comida y origen de viaje. El seed local agrega una dirección PostGIS reproducible al cliente fixture y repara pedidos fixture existentes.

`npm run test:postgres` comprueba ownership, ausencia de residuos, coordenadas exactas, distancia mayor a cero y que el destino no coincida con el comercio.
