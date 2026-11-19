-- Efectivo en pedidos de comida (PAG-01), como PedidosYa, Rappi y DiDi Food.
--
-- Quien pide paga en mano: al repartidor si se lo llevan, o en el mostrador si lo
-- retira. Flash no cobra nada al crear el pedido. Al completarlo liquida como un
-- pedido pagado con Wallet (comercio, comisión y repartidor) y además asienta que
-- quien cobró el efectivo lo tiene en la mano (`cash_collection`, migración 143):
--
-- - el repartidor queda debiendo lo que no es suyo (la parte del comercio y la
--   comisión), que se netea con sus próximas ganancias o que rinde en efectivo;
-- - en un retiro, el comercio queda debiendo la comisión, que se descuenta de sus
--   próximas liquidaciones (como el saldo negativo de la migración 119).
--
-- **Lo decide cada sucursal, y no viene encendido.** Aceptar efectivo es una
-- decisión del comercio, como en DiDi Food: un local que no lo quiere no debería
-- recibir pedidos que después tiene que cobrar.
ALTER TABLE merchant_branches
  ADD COLUMN cash_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN merchant_branches.cash_enabled IS
  'PAG-01: la sucursal acepta pedidos pagados en efectivo (al repartidor o en el mostrador).';

-- La rendición de efectivo: un repartidor que entrega a la operación el efectivo
-- que cobró baja su deuda. Sin esto, la deuda de un pedido en efectivo (casi todo
-- su valor) sólo se netea con ganancias, y el repartidor queda trabado en el tope
-- después de dos o tres pedidos. El asiento acredita su Wallet y debita la caja de
-- efectivo recibido de la plataforma.
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
  CHECK (kind IN ('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement',
    'payout_reserve','payout_release','tip','tip_adjustment','referral_reward','cash_collection','fare_split',
    'gift_card','cash_deposit'));
