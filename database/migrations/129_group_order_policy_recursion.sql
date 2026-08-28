-- Corrección de la migración 128: políticas RLS mutuamente recursivas.
--
-- **Las políticas de la 128 se llamaban entre sí.** `group_orders_member`
-- consultaba `group_order_participants` para saber si quien pregunta es parte, y
-- `group_order_participants_member` consultaba `group_orders` para saber si es
-- el anfitrión. Leer cualquiera de las dos evaluaba la política de la otra, que
-- evaluaba la de la primera: PostgreSQL corta con
-- `infinite recursion detected in policy for relation "group_orders"`.
--
-- No es un caso raro ni un detalle de rendimiento: **la primera lectura de un
-- pedido grupal fallaba siempre**. No se veía sin base de datos, y `test:postgres`
-- lo encontró en el primer intento de abrir un grupo.
--
-- La salida es una función `SECURITY DEFINER` que responde la pregunta de
-- pertenencia sin volver a pasar por RLS. Es el mismo recurso que la migración
-- 117 usó para el login —resolver identidad sin depender de la política que la
-- identidad todavía no puede satisfacer—, y por el mismo motivo: una política no
-- puede necesitar el resultado de sí misma.
CREATE FUNCTION app.is_group_order_member(grupo uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
-- `search_path` fijo y sin el esquema temporal: una funcion `SECURITY DEFINER`
-- sin esto puede ser secuestrada creando una tabla homonima en `pg_temp`.
SET search_path = public, pg_catalog AS $$
  SELECT EXISTS(
    SELECT 1 FROM group_order_participants p
    WHERE p.group_order_id = grupo AND p.user_id = app.current_user_id()
  )
$$;

-- La pertenencia del ítem cuelga del participante, y resolverla desde la
-- política obligaría a leer `group_order_participants` con su política puesta.
-- Se resuelve en la misma función privilegiada, de una sola vez.
CREATE FUNCTION app.can_read_group_order_item(participante uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  SELECT EXISTS(
    SELECT 1 FROM group_order_participants mio
    JOIN group_order_participants suyo ON suyo.group_order_id = mio.group_order_id
    WHERE suyo.id = participante AND mio.user_id = app.current_user_id()
  )
$$;

REVOKE EXECUTE ON FUNCTION app.is_group_order_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.can_read_group_order_item(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.is_group_order_member(uuid) TO flash_runtime;
    GRANT EXECUTE ON FUNCTION app.can_read_group_order_item(uuid) TO flash_runtime;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_rls_audit') THEN
    GRANT EXECUTE ON FUNCTION app.is_group_order_member(uuid) TO flash_rls_audit;
    GRANT EXECUTE ON FUNCTION app.can_read_group_order_item(uuid) TO flash_rls_audit;
  END IF;
END $$;

DROP POLICY group_orders_member ON group_orders;
DROP POLICY group_order_participants_member ON group_order_participants;
DROP POLICY group_order_items_member ON group_order_items;

-- El anfitrión se comprueba por su columna y no por la tabla de participantes:
-- es un dato de la misma fila, y no hace falta salir a buscarlo.
CREATE POLICY group_orders_member ON group_orders USING(
  host_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support')
  OR app.is_group_order_member(id)
);
CREATE POLICY group_order_participants_member ON group_order_participants USING(
  user_id = app.current_user_id() OR app.has_role('admin') OR app.has_role('support')
  OR app.is_group_order_member(group_order_id)
);
CREATE POLICY group_order_items_member ON group_order_items USING(
  app.has_role('admin') OR app.has_role('support')
  OR app.can_read_group_order_item(participant_id)
);

-- ---------------------------------------------------------------------------
-- Permisos que el código no usa, y que la 128 otorgó de más.
--
-- Lo encontró `test:runtime-write-scope`, que cuenta pares (tabla, operación)
-- concedidos y no ejercidos. Ninguna ruta actualiza un participante ni un ítem
-- de grupo: sumarse es un INSERT, y reemplazar la canasta propia es borrar e
-- insertar. Un permiso que nadie usa no se nota hasta que alguien lo usa mal.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
    REVOKE UPDATE ON group_order_participants FROM flash_runtime;
    REVOKE UPDATE ON group_order_items FROM flash_runtime;
  END IF;
END $$;

COMMENT ON FUNCTION app.is_group_order_member(uuid) IS
  'Pertenencia a un pedido grupal sin volver a pasar por RLS. Existe porque las politicas de la migracion 128 se llamaban entre si y toda lectura terminaba en recursion infinita.';
