-- El rol de trafico queda acotado a las operaciones que el producto ejecuta
-- de verdad (DAT-001).
--
-- Este lote cierra el inventario iniciado por la migracion 116. Cruza las
-- sentencias de `server/`, los upserts, los candados `FOR UPDATE` y las
-- escrituras indirectas de triggers. Por eso no confunde «la tabla se escribe»
-- con «necesita INSERT, UPDATE y DELETE»: conserva cada operacion observada y
-- revoca solamente las otras.
--
-- Las migraciones, seeds y limpiezas de suites usan `flash_app`; no justifican
-- autoridad en `flash_runtime`. Una operacion futura debera entrar con su ruta,
-- autorizacion, auditoria y prueba en el mismo cambio que vuelva a otorgarla.

REVOKE UPDATE ON
  branch_operating_hours,
  cart_items,
  catalog_item_allergens,
  catalog_item_dietary_labels,
  catalog_modifier_groups,
  favorites,
  ratings,
  user_avoided_allergens,
  user_dietary_preferences
FROM flash_runtime;

REVOKE DELETE ON
  branch_schedule_exceptions,
  carts,
  catalog_branch_inventory,
  catalog_items,
  driver_availability_sessions,
  driver_compliance,
  driver_documents,
  driver_job_sessions,
  driver_preferences,
  map_provider_cache,
  notification_dead_letters,
  pricing_change_requests,
  pricing_plans,
  referral_attributions,
  referral_codes,
  service_chat_quick_replies,
  service_tip_adjustments,
  user_dietary_profiles
FROM flash_runtime;

REVOKE DELETE, UPDATE ON catalog_modifiers FROM flash_runtime;

REVOKE INSERT, DELETE ON
  merchant_branches,
  shipment_item_categories,
  shipment_service_levels
FROM flash_runtime;
