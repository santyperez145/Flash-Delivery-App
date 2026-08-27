-- Un saldo en negativo por reintegro deja de ser invisible (ticket PAY-001).
--
-- El pago al comercio verifica saldo: `requestMerchantPayout` refusa con 409 si
-- la cuenta `payable` no alcanza. La reversion de un reintegro debita esa misma
-- cuenta **sin mirar el saldo**, asi que esta secuencia es posible y hasta ahora
-- no dejaba rastro:
--
--   1. el comercio vende y se le acredita en `payable`;
--   2. pide su pago y se le liquida, `payable` queda en cero;
--   3. un cliente reporta un item faltante y operaciones aprueba el reintegro;
--   4. la reversion debita `payable` a numeros rojos.
--
-- Que quede en negativo es la decision tomada, y es la correcta: el reintegro al
-- cliente no puede depender del saldo de un tercero. La deuda se netea contra
-- liquidaciones futuras. Lo que no puede pasar es que nadie se entere, porque un
-- comercio que deja de vender con saldo negativo se lleva la deuda puesta.
--
-- Por eso hace falta un tipo de caso nuevo. El patron de ampliar el CHECK por
-- DROP + ADD es el que ya usan las migraciones 020, 025, 083 y 091 sobre
-- `ledger_transactions.kind`.
ALTER TABLE payment_reconciliation_cases DROP CONSTRAINT payment_reconciliation_cases_case_type_check;
ALTER TABLE payment_reconciliation_cases ADD CONSTRAINT payment_reconciliation_cases_case_type_check
  CHECK(case_type IN('stale_intent','capture_mismatch','refund_mismatch','orphan_webhook','webhook_failure','negative_balance'));

ALTER TABLE payment_reconciliation_cases DROP CONSTRAINT payment_reconciliation_cases_entity_type_check;
ALTER TABLE payment_reconciliation_cases ADD CONSTRAINT payment_reconciliation_cases_entity_type_check
  CHECK(entity_type IN('payment_intent','refund','webhook_event','ledger_account'));
