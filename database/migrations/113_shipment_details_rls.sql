-- Política RLS sobre `shipment_details` (ticket DAT-001).
--
-- Es la más limpia de las cinco tablas de la deuda declarada, y la que más
-- incomoda que no la tuviera: guarda `recipient_name`, `recipient_phone` y
-- `delivery_pin_hash`. Es decir, el nombre y el teléfono de una persona que
-- **no es usuaria de la plataforma** —recibe un paquete, nada más— y el hash
-- del PIN con el que se prueba la entrega.
--
-- Hasta acá la tabla no tenía `ENABLE ROW LEVEL SECURITY`, así que cualquier rol
-- con un `GRANT SELECT` leía los datos de contacto de todos los destinatarios
-- del sistema. El `GRANT ... ON ALL TABLES` que este mismo ticket debe
-- restringir se lo da al runtime de entrada.
--
-- La forma es la de `job_items_via_job` y no una nueva: la visibilidad cae en
-- cascada por la política de `jobs`, que ya decide quién participa de un
-- trabajo —cliente, conductor asignado, comercio, admin o soporte—. Copiar esa
-- decisión acá la duplicaría, y dos copias de una regla de acceso son dos
-- copias que en algún momento dejan de coincidir.
--
-- La política de servicio para `flash_runtime` acompaña a las otras 66 y es
-- deliberada: la aplicación resuelve la pertenencia en sus propias consultas, y
-- someterla además a la política de fila rompería toda lectura hecha fuera de
-- `withDatabaseContext`. Lo que se gana no es constreñir al runtime sino
-- **default-deny para todo lo demás**: sin `ENABLE`, un rol nuevo con un grant
-- amplio ve la tabla entera; con `ENABLE` y sin política propia, no ve nada.
--
-- El `GRANT SELECT` al rol auditor se agrega a propósito. Sin él, la prueba
-- negativa demostraría que falta el grant, no que la política funciona: con el
-- grant puesto, que el auditor siga viendo cero filas sólo puede explicarlo
-- RLS.

ALTER TABLE shipment_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY shipment_details_via_job ON shipment_details
  USING (EXISTS (SELECT 1 FROM jobs WHERE jobs.id = shipment_details.job_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    CREATE POLICY shipment_details_runtime_service ON shipment_details
      TO flash_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT ON shipment_details TO flash_rls_audit;
  END IF;
END $$;
