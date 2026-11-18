-- Viajes en efectivo (PAG-01), como Uber en Argentina.
--
-- El pasajero paga en mano al conductor. Flash no cobra nada en el momento: al
-- terminar el viaje liquida la ganancia del conductor y la comisión como en un viaje
-- con Wallet, y además asienta que el conductor cobró el total (`cash_collection`),
-- que le debe a la plataforma. Neto, el saldo del conductor baja exactamente la
-- comisión, y puede quedar negativo: es deuda que se netea contra sus próximas
-- ganancias, como ya pasa con el saldo de un comercio (migración 119).
ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
  CHECK (kind IN ('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement',
    'payout_reserve','payout_release','tip','tip_adjustment','referral_reward','cash_collection'));
