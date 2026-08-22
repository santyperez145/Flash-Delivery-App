CREATE TABLE service_chat_quick_replies(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  service_scope text NOT NULL CHECK(service_scope IN('all','food','ride','shipment')),
  audience user_role NOT NULL CHECK(audience IN('customer','driver','merchant')),
  locale text NOT NULL DEFAULT 'es-AR' CHECK(locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 160),
  position smallint NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 1000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_scope,audience,locale,body)
);

INSERT INTO service_chat_quick_replies(public_id,service_scope,audience,body,position) VALUES
 ('QRP-CUS-POINT','all','customer','Ya estoy en el punto',10),
 ('QRP-CUS-LOCATION','all','customer','¿Podés confirmar la ubicación?',20),
 ('QRP-CUS-HELP','all','customer','Necesito ayuda con el servicio',30),
 ('QRP-DRV-ARRIVING','all','driver','Estoy llegando',10),
 ('QRP-DRV-POINT','all','driver','Ya estoy en el punto indicado',20),
 ('QRP-DRV-TRAFFIC','ride','driver','Hay tránsito; la ruta se actualizó',30),
 ('QRP-DRV-PICKUP','food','driver','Estoy esperando el pedido en el comercio',30),
 ('QRP-DRV-PACKAGE','shipment','driver','Estoy listo para retirar el paquete',30),
 ('QRP-MER-PREPARING','food','merchant','Estamos preparando tu pedido',10),
 ('QRP-MER-READY','food','merchant','El pedido está listo para retirar',20),
 ('QRP-MER-CHANGE','food','merchant','Necesitamos confirmar un cambio del pedido',30);

ALTER TABLE service_chat_quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_chat_quick_replies_read ON service_chat_quick_replies FOR SELECT USING(active OR app.has_role('admin'));
CREATE POLICY service_chat_quick_replies_admin ON service_chat_quick_replies FOR ALL USING(app.has_role('admin')) WITH CHECK(app.has_role('admin'));

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  GRANT SELECT,INSERT,UPDATE ON service_chat_quick_replies TO flash_runtime;
  CREATE POLICY service_chat_quick_replies_runtime_service ON service_chat_quick_replies TO flash_runtime USING(true) WITH CHECK(true);
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN GRANT SELECT ON service_chat_quick_replies TO flash_rls_audit; END IF;
END $$;
