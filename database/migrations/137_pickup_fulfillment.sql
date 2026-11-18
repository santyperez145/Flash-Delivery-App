-- Retiro en el local (ticket GTM-002).
--
-- El hueco de producto mas grande que quedaba frente a PedidosYa y Uber Eats, y
-- esta listado como requisito derivado en `docs/investigacion-competitiva.md`
-- desde el 14 de agosto: «hacer pickup». Hasta hoy **todo pedido de comida
-- exigia repartidor**: no existia ningun concepto de modo de entrega.
--
-- Importa por margen, no solo por paridad. Un pedido retirado no tiene costo de
-- reparto, asi que su contribucion por pedido es estructuralmente mejor — y el
-- contribution margin por job es la puerta economica de la Fase 2 segun
-- `docs/investor-readiness.md`.
--
-- **El modo vive en `metadata.fulfillment`, no en una columna.** `jobs` es una
-- tabla compartida por comida, viajes y envios, y la distincion comida/no-comida
-- ya viaja en `metadata.subtype`: el despacho la lee desde ahi en cuatro
-- consultas. Una columna para una semantica exclusiva de comida seria la unica
-- de su clase en la tabla. El indice parcial de abajo le da al barrido del
-- despacho el mismo rendimiento que tendria con columna.

-- El local opta por ofrecerlo. **No se habilita por omision**: entregar en mano
-- a alguien que entra al local exige mostrador, alguien que atienda y espacio
-- para esperar, y darlo por supuesto manda clientes a locales que no pueden
-- recibirlos.
ALTER TABLE merchant_branches
  ADD COLUMN pickup_enabled boolean NOT NULL DEFAULT false;

-- **Sin codigo de retiro, y es una decision.** La primera version de esta
-- migracion agregaba `pickup_code_hash`: un codigo aleatorio, guardado hasheado,
-- devuelto una sola vez y limpiado del registro de idempotencia, igual que el PIN
-- de envios de la migracion 024.
--
-- Se saco porque el modelo de amenaza no lo justifica. El PIN de envios y el de
-- viajes existen porque el intento ocurre sin testigos: alguien solo en una
-- puerta, alguien solo en un auto. El retiro ocurre en un mostrador, con el
-- ticket a la vista y alguien del local mirando, y ahi el numero de pedido da la
-- misma garantia que un codigo aleatorio. Es lo que usan PedidosYa y Uber Eats.
--
-- Agregar un secreto que no hace falta cuesta el lugar donde guardarlo, el camino
-- para devolverlo y el riesgo de filtrarlo. Si la operacion real muestra que hace
-- falta, es una migracion.

-- El despacho barre por este predicado cada pocos segundos. Sin el indice, el
-- barrido recorre la tabla entera de trabajos para descartar los retirados.
CREATE INDEX jobs_pickup_fulfillment_idx
  ON jobs((metadata->>'fulfillment'))
  WHERE metadata->>'fulfillment' = 'pickup';

COMMENT ON COLUMN merchant_branches.pickup_enabled IS
  'La sucursal acepta que el cliente retire en el local. Apagado por omision: exige mostrador y alguien que atienda.';
