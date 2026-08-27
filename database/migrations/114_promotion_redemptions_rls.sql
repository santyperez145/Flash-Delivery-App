-- Política RLS sobre `promotion_redemptions` (ticket DAT-001).
--
-- La tabla dice qué promoción usó cada persona, cuándo y por cuánto dinero. Sin
-- `ENABLE ROW LEVEL SECURITY` —que es como estaba— cualquier rol con un
-- `GRANT SELECT` reconstruye el historial de descuentos de todos los usuarios.
--
-- El vínculo es directo (`user_id`), así que la política es la de
-- `addresses_owner` y no una en cascada como la de `shipment_details`.
--
-- **Lo delicado de esta tabla no es la forma de la política sino a quién debe
-- alcanzar.** Tres consultas del runtime cuentan filas de todos los usuarios a
-- propósito:
--
--   * `order-repository.js` resuelve el cupo global de la promoción con
--     `count(*) total, count(*) FILTER(WHERE user_id=$2) user_total`. El primero
--     tiene que ver todas las redenciones o el tope no significa nada.
--   * `configuration-repository.js` publica `usage_count` por promoción, y lo
--     hace con `postgresPool.query` directo, sin contexto de usuario.
--
-- Si la política por usuario alcanzara al runtime, `app.current_user_id()`
-- devolvería nulo en el segundo caso y sólo la propia fila en el primero. El
-- efecto no sería un error visible sino algo peor: **una promoción con tope de
-- 100 no se agotaría nunca**, porque cada persona contaría únicamente sus
-- propias redenciones. Un descuento sin tope efectivo es dinero.
--
-- Por eso la política de servicio para `flash_runtime` no es una concesión sino
-- la condición para que esta tabla pueda tener RLS. Lo que se gana es
-- default-deny para todo lo demás: sin `ENABLE`, un rol nuevo con un grant
-- amplio ve la tabla entera.
--
-- El `GRANT SELECT` al rol auditor va en la misma migración por el mismo motivo
-- que en la 113: sin él, la prueba negativa demostraría que falta el permiso y
-- no que la política funciona.

ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY promotion_redemptions_owner ON promotion_redemptions
  USING (user_id = app.current_user_id() OR app.has_role('admin'))
  WITH CHECK (user_id = app.current_user_id() OR app.has_role('admin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_runtime') THEN
    CREATE POLICY promotion_redemptions_runtime_service ON promotion_redemptions
      TO flash_runtime USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flash_rls_audit') THEN
    GRANT SELECT ON promotion_redemptions TO flash_rls_audit;
  END IF;
END $$;
