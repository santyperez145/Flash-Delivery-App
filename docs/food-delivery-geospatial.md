# Destino geoespacial de pedidos de comida

El checkout de comida ya no confía en un texto libre ni reutiliza la ubicación del comercio como destino. Cada pedido PostgreSQL exige `deliveryAddressId`, valida que la dirección pertenezca al cliente autenticado y que tenga procedencia geográfica, y toma de la base el texto canónico, su `geography(Point, 4326)`, proveedor, `place_id` y fecha de validación.

La creación persiste:

- pickup y dropoff PostGIS diferentes;
- distancia geodésica comercio-cliente en metros;
- ETA inicial que combina preparación del comercio y traslado;
- `locationEstimated: false`;
- identificador de la dirección usada dentro del snapshot operacional.
- identidad y fecha de la validación dentro de la cotización firmada.

La dirección participa en el hash de idempotencia. Una dirección ajena, inexistente o legacy sin validación se rechaza antes de reclamar la clave, cobrar Wallet o crear residuos financieros. Si cambia proveedor, `place_id` o fecha después de cotizar, la creación responde que debe recotizar.

Web y mobile buscan mediante el proxy autenticado, muestran coincidencias y guardan únicamente la elegida con un token corto ligado al usuario. El seed local agrega una dirección PostGIS reproducible y declarada como fixture; la migración no marca como verificadas direcciones históricas sin evidencia.

`npm run test:postgres` comprueba ownership, ausencia de residuos, sustitución de campos manipulados, rechazo de una dirección legacy, coordenadas exactas, distancia mayor a cero y que el destino no coincida con el comercio.
