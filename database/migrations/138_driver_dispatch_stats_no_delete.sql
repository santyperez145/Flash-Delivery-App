-- Recorta DELETE de driver_dispatch_stats en flash_runtime (ARC/DSP).
--
-- La 137 otorgó DELETE por inercia; el runtime sólo hace upsert de stats.
-- test:runtime-write-scope exige que el grant coincida con el uso observado.

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='flash_runtime') THEN
  REVOKE DELETE ON driver_dispatch_stats FROM flash_runtime;
 END IF;
END $$;
