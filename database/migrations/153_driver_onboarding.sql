-- Alta real de repartidores y conductores (FE-06).
--
-- Hasta acá un conductor existía sólo si lo creaba una semilla: no había camino de
-- producto para sumarse. La postulación crea el conductor, su legajo y su vehículo en
-- revisión (`server/driver-application-repository.js`), y operaciones revisa cada
-- documento y el vehículo. Nada de eso necesita tablas nuevas.
--
-- Lo único que cambia en el esquema: una bicicleta no tiene patente. El registro de
-- vehículos (migración 087) exigía patente a todos, así que quien reparte en bici
-- —como en Uber Eats o PedidosYa— no podía declarar su vehículo sin inventar una.
-- Para moto, auto y van la patente sigue siendo obligatoria.
ALTER TABLE vehicles ALTER COLUMN plate DROP NOT NULL;
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_plate_required_check CHECK(kind = 'bicycle' OR plate IS NOT NULL);

-- La cola de legajos de operaciones lista conductores con algo para revisar, del más
-- viejo al más nuevo. Los dos índices parciales que ya existen (documentos y vehículos
-- pendientes) resuelven el «algo para revisar»; este ordena y pagina sin recorrer
-- todos los conductores.
CREATE INDEX IF NOT EXISTS drivers_onboarding_queue_idx ON drivers(created_at, id);
