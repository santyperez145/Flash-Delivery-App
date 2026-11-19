-- Catálogo sin datos inventados (FE-04, «nada falso»).
--
-- Hasta ahora, dar de alta un producto desde la consola del comercio guardaba en
-- `catalog_items.metadata` valores que nadie declaró: 4,5 estrellas, 500 kcal, la
-- etiqueta «Nuevo» y, como foto del plato, la foto del local. El cliente los veía
-- como datos del producto: una calificación que ningún pedido produjo, unas calorías
-- que el comercio nunca informó y una foto que no era del plato.
--
-- La API dejó de escribirlos y de leer la calificación por plato (Flash califica el
-- pedido y el local, no cada producto). Esta migración limpia los que ya quedaron
-- guardados, y sólo esos:
--
-- - `rating`, siempre: no hay calificación por plato de la que pueda salir.
-- - `kcal` cuando vale exactamente 500, el relleno fijo del alta.
-- - `tags` cuando es exactamente ["Nuevo"], la etiqueta fija del alta.
-- - `image` cuando es la misma foto del local, que se copiaba al plato.
--
-- Es idempotente: cada paso filtra por la marca que deja el relleno, así que
-- correrla dos veces no cambia nada. `scripts/db-seed-derived.mjs` repite la misma
-- limpieza para que una base creada desde cero quede igual que una migrada.
UPDATE catalog_items
SET metadata = metadata - 'rating'
WHERE metadata ? 'rating';

UPDATE catalog_items
SET metadata = metadata - 'kcal'
WHERE metadata -> 'kcal' = '500'::jsonb;

UPDATE catalog_items
SET metadata = metadata - 'tags'
WHERE metadata -> 'tags' = '["Nuevo"]'::jsonb;

UPDATE catalog_items ci
SET metadata = ci.metadata - 'image'
FROM merchants m
WHERE m.id = ci.merchant_id
  AND ci.metadata ? 'image'
  AND ci.metadata ->> 'image' = m.metadata ->> 'image';
