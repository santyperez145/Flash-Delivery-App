-- Tarjetas de regalo (PAG-04), como las de Uber.
--
-- Un cliente compra una tarjeta con el saldo de su Flash Wallet y la regala: con el
-- código, que comparte como quiera, o dirigida a otra cuenta Flash por su email,
-- que la ve en su Wallet y la canjea con un toque. Al canjearla, el importe entra
-- a la Wallet de quien la canjea.
--
-- **El dinero no queda en el aire.** Al comprar, sale de la Wallet de quien compra
-- y entra a una cuenta de la plataforma (`gift_card_liability`): es plata que Flash
-- debe hasta que alguien la canjee. Al canjear, sale de esa cuenta hacia la Wallet
-- de quien canjea; al anular, vuelve a quien compró. El saldo de la cuenta es,
-- siempre, la suma de las tarjetas vigentes. Todo con el asiento `gift_card`.
--
-- **El código no se guarda en claro.** Se busca por su HMAC (`code_hash`) y se
-- guarda cifrado (`code_ciphertext`) para que quien compró lo vuelva a ver mientras
-- la tarjeta está vigente. Al canjearse o anularse, el cifrado se borra.
--
-- **Dirigirla no dice quién tiene cuenta.** Un email que no es de un cliente activo
-- se guarda igual, sin destinatario, y la respuesta es la misma.
--
-- No vence: una tarjeta vigente se puede canjear siempre. No se cambia por dinero.
CREATE TABLE gift_cards(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  code_hash text NOT NULL UNIQUE,
  -- `NULL` cuando ya no está vigente: nadie necesita volver a leer un código usado.
  code_ciphertext text,
  code_last4 text NOT NULL CHECK (code_last4 ~ '^[2-9A-Z]{4}$'),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  purchaser_id uuid NOT NULL REFERENCES users(id),
  -- La cuenta a la que se dirigió, si el email era de un cliente activo.
  recipient_id uuid REFERENCES users(id),
  -- Lo que escribió quien compra, en minúsculas. Él ya lo sabe; es lo que ve en su lista.
  recipient_email text,
  message text CHECK (message IS NULL OR char_length(message) <= 140),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'cancelled')),
  redeemed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (recipient_id IS NULL OR recipient_id <> purchaser_id),
  CHECK ((status = 'redeemed') = (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status = 'active' OR code_ciphertext IS NULL),
  CHECK (redeemed_by IS NULL OR redeemed_by <> purchaser_id)
);
CREATE INDEX gift_cards_purchaser_idx ON gift_cards(purchaser_id, created_at DESC);
CREATE INDEX gift_cards_recipient_idx ON gift_cards(recipient_id) WHERE status = 'active';
CREATE INDEX gift_cards_redeemed_by_idx ON gift_cards(redeemed_by) WHERE redeemed_by IS NOT NULL;

ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY gift_cards_participant ON gift_cards
  USING (purchaser_id = app.current_user_id() OR recipient_id = app.current_user_id()
    OR redeemed_by = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'))
  WITH CHECK (app.has_role('admin'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON gift_cards TO flash_runtime;
    CREATE POLICY gift_cards_runtime_service ON gift_cards TO flash_runtime
      USING (true) WITH CHECK (true);
  END IF;
  -- La auditoría no ve el código (ni su HMAC), el email escrito ni el mensaje.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT (id, public_id, code_last4, amount_cents, purchaser_id, recipient_id, status,
      redeemed_by, created_at, redeemed_at, cancelled_at)
      ON gift_cards TO flash_rls_audit;
  END IF;
END $$;

ALTER TABLE ledger_transactions DROP CONSTRAINT ledger_transactions_kind_check;
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_transactions_kind_check
  CHECK (kind IN ('sandbox_topup','driver_earning','payment','refund','adjustment','merchant_settlement',
    'payout_reserve','payout_release','tip','tip_adjustment','referral_reward','cash_collection','fare_split',
    'gift_card'));

-- El email escrito y el mensaje son datos personales: se borran con la cuenta de
-- quien compró, de quien la recibió o de quien tiene ese email. La tarjeta sigue
-- valiendo: es plata que alguien pagó, y el código sigue en manos de quien lo tenga.
CREATE OR REPLACE FUNCTION app.forget_gift_card_personal_data() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status = 'deleted' AND OLD.status <> 'deleted' THEN
    UPDATE gift_cards
       SET recipient_email = NULL, message = NULL
     WHERE purchaser_id = NEW.id OR recipient_id = NEW.id
        OR recipient_email = lower(OLD.email::text);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION app.forget_gift_card_personal_data() FROM PUBLIC;
CREATE TRIGGER users_forget_gift_card_personal_data
  BEFORE UPDATE OF status ON users
  FOR EACH ROW EXECUTE FUNCTION app.forget_gift_card_personal_data();
