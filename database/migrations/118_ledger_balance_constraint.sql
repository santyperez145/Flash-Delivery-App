-- La partida doble deja de depender de que 18 rutas la escriban bien (PAY-001).
--
-- `ledger_entries` guarda debitos y creditos agrupados por `transaction_id`, y
-- hasta acá nada obligaba a que una transaccion cuadrara: el esquema aceptaba
-- un debito sin su credito. La propiedad que hace que un ledger sea un ledger
-- estaba sostenida por nueve modulos de repositorio acertando cada uno por su
-- cuenta, sin red.
--
-- El chequeo tiene que ser **diferido** y no por sentencia. La reversion
-- proporcional de `order-issue-repository.js` inserta N debitos en un bucle y
-- despues un solo credito por el total: contra un constraint inmediato fallaria
-- en el primer debito, que es correcto individualmente. `DEFERRABLE INITIALLY
-- DEFERRED` mira el estado al commit, que es cuando la pregunta tiene sentido.
--
-- Es seguro porque ninguna transaccion se arma entre commits: nada escribe
-- `ledger_transactions` con estado `pending` ni actualiza el estado despues, asi
-- que cada transaccion nace completa. Si algun dia hiciera falta armar una en
-- etapas, este trigger es lo que hay que revisar primero.
CREATE OR REPLACE FUNCTION app.enforce_ledger_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_transaction uuid;
  v_debits bigint;
  v_credits bigint;
BEGIN
  -- Se elige por TG_OP y no con COALESCE(NEW.., OLD..) para no depender de si
  -- el registro ausente es legible en el inicializador de un DECLARE.
  IF TG_OP = 'DELETE' THEN
    v_transaction := OLD.transaction_id;
  ELSE
    v_transaction := NEW.transaction_id;
  END IF;

  SELECT
    COALESCE(sum(amount_cents) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(sum(amount_cents) FILTER (WHERE direction = 'credit'), 0)
  INTO v_debits, v_credits
  FROM ledger_entries
  WHERE transaction_id = v_transaction;

  -- Una transaccion sin asientos cuadra en cero y se acepta: borrar todos los
  -- asientos de una transaccion es una operacion legitima, y negarla acá seria
  -- inventar una regla que nadie pidio.
  IF v_debits <> v_credits THEN
    RAISE EXCEPTION
      'La transaccion contable % no cuadra: debitos %, creditos %',
      v_transaction, v_debits, v_credits
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balance
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.enforce_ledger_balance();
