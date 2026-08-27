-- Política RLS sobre `user_roles` (ticket DAT-001).
--
-- Es la última de la deuda declarada. El motivo registrado era «se lee antes de
-- autenticar; necesita `SECURITY DEFINER` para el login primero», y como pasó
-- con `drivers` y `merchants`, ese motivo confunde dos cosas distintas.
--
-- Es cierto que el camino de login resuelve la identidad con un `LEFT JOIN
-- user_roles` **antes de que exista contexto de usuario**: en ese momento no se
-- sabe quién pregunta, que es justamente lo que la consulta va a averiguar. Una
-- política por usuario que alcanzara al runtime devolvería cero filas y nadie
-- entraría a la plataforma.
--
-- Pero el runtime queda exento, como en las otras 67 tablas. Mover la
-- resolución de identidad a una función `SECURITY DEFINER` es lo que haría
-- falta para **constreñir al runtime**, y eso es un objetivo distinto y más
-- grande —cambia el camino de autenticación— que no es requisito para que la
-- tabla tenga política.
--
-- Lo que se gana acá es lo mismo que en las anteriores y sobre la tabla que más
-- lo justifica: `user_roles` es el mapa de personas a privilegios. Sin `ENABLE`,
-- cualquier rol futuro con un grant amplio lee quién es administrador, quién es
-- soporte y quién conduce. Con `ENABLE` y sin política propia, no ve nada.
--
-- No hay riesgo de recursión, que es la trampa clásica al poner RLS sobre una
-- tabla de roles: `app.has_role()` lee `current_setting('app.roles')`, una
-- variable de sesión, no esta tabla. Si algún día leyera de acá, la política se
-- invocaría a sí misma para evaluarse.
--
-- El `GRANT SELECT` al rol auditor va con la política, no antes: hoy el auditor
-- no tiene permiso sobre esta tabla, así que sin el grant la prueba negativa
-- demostraría eso y no la política. Con `ENABLE` puesto en la misma migración,
-- el acceso neto del auditor sigue siendo cero filas.

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_owner ON user_roles
  USING (
    user_id = app.current_user_id()
    OR app.has_role('admin')
    OR app.has_role('support')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    CREATE POLICY user_roles_runtime_service ON user_roles
      TO flash_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT ON user_roles TO flash_rls_audit;
  END IF;
END $$;
