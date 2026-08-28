-- Suscripcion de Flash (ticket GTM-001).
--
-- El hueco comercial mas grande medido contra la competencia: Uber One,
-- DashPass y PedidosYa Plus son el motor de retencion y de margen de la
-- categoria, y Flash no tenia tabla, ruta ni concepto.
--
-- El dueño eligio tres beneficios: envio sin cargo desde un monto, comision
-- reducida en viajes, y prioridad de dispatch. Los tres viven en el plan y no en
-- el codigo, para que cambiar la oferta sea una fila y no un despliegue.
--
-- **Lo que esta migracion no hace: cobrar.** El cobro recurrente depende de
-- PAY-001, que espera credenciales del proveedor. El modelo separa la
-- suscripcion de su cobro a proposito, asi que cuando el cobro exista se engancha
-- sin tocar los beneficios. Hasta entonces una suscripcion se puede otorgar y no
-- facturar, y eso esta dicho en vez de disimulado.
CREATE TABLE subscription_plans(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  key text NOT NULL UNIQUE,
  name text NOT NULL CHECK(length(name) BETWEEN 3 AND 80),
  description text NOT NULL DEFAULT '',
  price_cents bigint NOT NULL CHECK(price_cents > 0),
  currency char(3) NOT NULL DEFAULT 'ARS',
  billing_period_days int NOT NULL CHECK(billing_period_days BETWEEN 7 AND 366),

  -- Beneficios. `NULL` en el umbral significa que el plan no da envio sin cargo,
  -- que no es lo mismo que darlo desde cero: la diferencia importa para no
  -- regalar el envio por un plan mal cargado.
  free_delivery_min_subtotal_cents bigint CHECK(free_delivery_min_subtotal_cents >= 0),
  ride_discount_bps int NOT NULL DEFAULT 0 CHECK(ride_discount_bps BETWEEN 0 AND 5000),
  dispatch_priority_boost int NOT NULL DEFAULT 0 CHECK(dispatch_priority_boost BETWEEN 0 AND 100),

  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_subscriptions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  -- Solo dos estados. **Cancelar no es un estado**, es `cancelled_at`: quien
  -- cancela pago un periodo y lo termina de usar, asi que la suscripcion sigue
  -- vigente hasta `current_period_end` y lo unico que cambia es que no renueva.
  -- Un tercer estado 'cancelled' obligaria a que toda lectura de beneficios
  -- aceptara dos estados, y la primera que se olvidara le cortaria los
  -- beneficios a alguien que ya los pago.
  status text NOT NULL DEFAULT 'active' CHECK(status IN('active','expired')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL,
  -- No nulo significa "no renueva". No significa "sin beneficios".
  cancelled_at timestamptz,
  -- Queda escrito si el periodo se cobro o se otorgo. Sin esto, el dia que el
  -- cobro exista no habria forma de distinguir un suscriptor que pago de uno que
  -- entro mientras el cobro no estaba disponible.
  billed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(current_period_end > current_period_start)
);

-- Una sola suscripcion vigente por persona, y el historial completo al lado. Es
-- un indice parcial y no una restriccion sobre `user_id` porque los periodos
-- vencidos tienen que quedar: son lo que permite auditar un beneficio aplicado
-- el mes pasado.
--
-- Ademas evita cobrar dos veces el mismo tramo. Sin el, alguien que cancela y se
-- vuelve a suscribir el mismo dia terminaria con dos periodos superpuestos y
-- pagando los dos.
CREATE UNIQUE INDEX user_subscriptions_active_unique
  ON user_subscriptions(user_id) WHERE status = 'active';
CREATE INDEX user_subscriptions_user_idx ON user_subscriptions(user_id, created_at DESC);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_subscriptions_runtime_service ON user_subscriptions USING(true);
CREATE POLICY user_subscriptions_owner ON user_subscriptions
  USING(user_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support'));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    -- El plan es catalogo: el runtime lo lee y no lo escribe.
    GRANT SELECT ON subscription_plans TO flash_runtime;
    -- La suscripcion se crea y se actualiza de estado, y no se borra: cancelar
    -- es un cambio de estado, y borrar la fila destruiria el historial que
    -- justifica un beneficio ya aplicado.
    GRANT SELECT, INSERT, UPDATE ON user_subscriptions TO flash_runtime;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT ON subscription_plans TO flash_rls_audit;
    GRANT SELECT ON user_subscriptions TO flash_rls_audit;
  END IF;
END $$;

-- Plan inicial. Los valores son de arranque y se cambian por fila, no por
-- despliegue: envio sin cargo desde $15.000, 10% menos en viajes y una prioridad
-- moderada de dispatch.
INSERT INTO subscription_plans(
  public_id, key, name, description, price_cents, billing_period_days,
  free_delivery_min_subtotal_cents, ride_discount_bps, dispatch_priority_boost
) VALUES (
  'PLAN-FLASH-MAS', 'flash_mas', 'Flash Más',
  'Envio sin cargo desde $15.000, 10% menos en viajes y prioridad al asignar conductor',
  499900, 30, 1500000, 1000, 10
) ON CONFLICT(key) DO NOTHING;

COMMENT ON TABLE user_subscriptions IS
  'Estado de suscripcion por persona. `billed` distingue un periodo cobrado de uno otorgado mientras PAY-001 no tenga credenciales.';
