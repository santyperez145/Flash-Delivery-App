-- Pedidos grupales (GTM-001, cuarto y ultimo hueco comercial).
--
-- Uber Eats, DoorDash y Rappi los tienen, y Flash los prometia en la portada
-- —«Grupal · Pedido compartido»— sin que existiera nada detras. Esa promesa se
-- retiro al construir la suscripcion; esta migracion la hace cierta.
--
-- Es la via natural al ticket promedio alto y al pedido de oficina, que es el
-- segmento donde un pedido reemplaza a diez.
--
-- **Cada participante tiene su propia canasta, y no se toca su carrito
-- personal.** Reusar `carts` habria sido menos codigo, pero `carts` tiene un
-- unico activo por (cliente, comercio): sumarse a un grupo del mismo restaurante
-- donde ya tenias algo guardado te lo habria pisado sin avisar.
CREATE TABLE group_orders(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  -- Codigo corto para compartir por chat. Es la unica credencial para sumarse,
  -- asi que se genera al azar y se puede rotar cerrando el grupo: no da acceso a
  -- nada mas que a esta canasta.
  join_code text NOT NULL UNIQUE,
  host_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES merchant_branches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK(status IN('open','locked','placed','cancelled')),
  -- Tope de gasto por persona. `NULL` es sin tope. Es la diferencia entre un
  -- pedido compartido entre amigos y uno de oficina con presupuesto.
  spend_limit_cents bigint CHECK(spend_limit_cents > 0),
  closes_at timestamptz,
  -- Se completa al confirmar. Un grupo confirmado **se convierte en un pedido
  -- normal**: de ahi en adelante propina, suscripcion, horario, despacho y
  -- liquidacion funcionan sin saber que empezo como grupo.
  job_id uuid UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status = 'placed') = (job_id IS NOT NULL))
);
CREATE INDEX group_orders_host_idx ON group_orders(host_id, created_at DESC);

CREATE TABLE group_order_participants(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id uuid NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_host boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_order_id, user_id)
);
-- Un solo anfitrion por grupo. Sin esto, dos filas con `is_host` dejarian dos
-- personas habilitadas a confirmar y cobrar el mismo pedido.
CREATE UNIQUE INDEX group_order_single_host_idx
  ON group_order_participants(group_order_id) WHERE is_host;
CREATE INDEX group_order_participants_user_idx ON group_order_participants(user_id);

CREATE TABLE group_order_items(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES group_order_participants(id) ON DELETE CASCADE,
  catalog_item_id uuid NOT NULL REFERENCES catalog_items(id),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 30),
  -- Precio al momento de elegir. El precio final lo vuelve a calcular la
  -- cotizacion al confirmar, como en cualquier pedido: esto es para mostrar el
  -- avance del grupo y para verificar el tope de gasto, no para cobrar.
  unit_price_snapshot_cents bigint NOT NULL CHECK(unit_price_snapshot_cents >= 0),
  options jsonb NOT NULL DEFAULT '[]',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_order_items_participant_idx ON group_order_items(participant_id);

ALTER TABLE group_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_order_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_orders_runtime_service ON group_orders USING(true);
CREATE POLICY group_order_participants_runtime_service ON group_order_participants USING(true);
CREATE POLICY group_order_items_runtime_service ON group_order_items USING(true);

-- Ver un grupo es ser parte de el. El codigo para sumarse no da lectura por si
-- solo: primero se entra, despues se ve. Al reves, cualquiera con un codigo
-- filtrado leeria quien pidio que en una oficina.
CREATE POLICY group_orders_member ON group_orders USING(
  host_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support')
  OR EXISTS(SELECT 1 FROM group_order_participants p
            WHERE p.group_order_id = group_orders.id AND p.user_id = app.current_user_id())
);
CREATE POLICY group_order_participants_member ON group_order_participants USING(
  user_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support')
  OR EXISTS(SELECT 1 FROM group_orders g
            WHERE g.id = group_order_participants.group_order_id AND g.host_id = app.current_user_id())
);
CREATE POLICY group_order_items_member ON group_order_items USING(
  app.has_role('admin') OR app.has_role('support')
  OR EXISTS(SELECT 1 FROM group_order_participants p
            WHERE p.id = group_order_items.participant_id AND p.user_id = app.current_user_id())
  OR EXISTS(SELECT 1 FROM group_order_participants p JOIN group_orders g ON g.id = p.group_order_id
            WHERE p.id = group_order_items.participant_id AND g.host_id = app.current_user_id())
);

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    -- El grupo se crea, cambia de estado y se cancela; no se borra, porque el
    -- historial es lo que explica un pedido de doce items a nombre de una sola
    -- persona.
    GRANT SELECT, INSERT, UPDATE ON group_orders TO flash_runtime;
    GRANT SELECT, INSERT, UPDATE ON group_order_participants TO flash_runtime;
    -- Los items si se borran: reemplazar la canasta propia es borrar e insertar,
    -- y guardar cada version intermedia de lo que alguien penso pedir no le
    -- sirve a nadie.
    GRANT SELECT, INSERT, UPDATE, DELETE ON group_order_items TO flash_runtime;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT SELECT ON group_orders TO flash_rls_audit;
    GRANT SELECT ON group_order_participants TO flash_rls_audit;
    GRANT SELECT ON group_order_items TO flash_rls_audit;
  END IF;
END $$;

COMMENT ON TABLE group_orders IS
  'Canasta compartida. Al confirmarse se convierte en un pedido normal (`job_id`), asi que propina, suscripcion, horario y liquidacion no necesitan saber que empezo como grupo.';
