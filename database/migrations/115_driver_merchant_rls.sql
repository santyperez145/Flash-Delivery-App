-- Política RLS sobre `drivers` y `merchants` (ticket DAT-001).
--
-- Eran las dos últimas de la deuda declarada además de `user_roles`, y el
-- motivo registrado para no aplicarlas era «39 y 23 archivos las consultan,
-- varios sin contexto de usuario».
--
-- Ese motivo se revisó antes de escribir esto y **no bloquea**. El inventario
-- real da 55 consultas SQL sobre `drivers` en 20 archivos: 26 corren con
-- contexto —`client.query` dentro de `withDatabaseContext`— y 16 usan
-- `postgresPool.query` directo, sin contexto ninguno. Entre esas 16 hay casos
-- que **tienen** que ver filas ajenas: `ownerOfDriver` en
-- `realtime-repository.js` resuelve de quién es una entidad justamente antes de
-- saber a quién mostrarla, y el listado paginado de backoffice cruza inquilinos
-- por definición.
--
-- Pero eso sólo bloquearía si la política tuviera que alcanzar al runtime, y no
-- tiene: `flash_runtime` recibe su política de servicio como en las otras 66
-- tablas, porque la aplicación resuelve pertenencia en sus propias consultas.
-- La objeción heredada asumía una política más estricta de la que este esquema
-- usa en todas partes.
--
-- Lo que sí estaba abierto, y es la razón de esta migración: **`flash_rls_audit`
-- tiene `GRANT SELECT` sobre las dos tablas desde la migración 011 y ninguna de
-- las dos tenía `ENABLE ROW LEVEL SECURITY`.** El rol que existe para demostrar
-- aislamiento leía el nombre, la patente, la posición en vivo y la calificación
-- de todos los conductores, y el dueño y la ubicación de todos los comercios.
--
-- Las dos políticas incluyen `support` además de `admin`, igual que
-- `jobs_participants`: soporte atiende casos sobre conductores y comercios que
-- no son suyos, y es la misma decisión ya tomada para el trabajo en sí.

ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;

CREATE POLICY drivers_owner ON drivers
  USING (
    user_id = app.current_user_id()
    OR app.has_role('admin')
    OR app.has_role('support')
  );

CREATE POLICY merchants_owner ON merchants
  USING (
    owner_id = app.current_user_id()
    OR app.has_role('admin')
    OR app.has_role('support')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    CREATE POLICY drivers_runtime_service ON drivers
      TO flash_runtime USING (true) WITH CHECK (true);
    CREATE POLICY merchants_runtime_service ON merchants
      TO flash_runtime USING (true) WITH CHECK (true);
  END IF;
END $$;
