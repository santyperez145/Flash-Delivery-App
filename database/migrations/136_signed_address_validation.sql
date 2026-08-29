-- Procedencia verificable de direcciones guardadas (GEO-001).
--
-- Las coordenadas sin origen son sólo otra forma de texto confiado por el
-- cliente. Estas columnas distinguen una dirección elegida de un resultado
-- firmado por el backend de un registro legacy que todavía debe revalidarse.
-- No se hace backfill: declarar que una dirección antigua fue verificada sería
-- fabricar evidencia. Los fixtures reproducibles lo declaran en su propio seed.

ALTER TABLE addresses
  ADD COLUMN geocoding_provider text,
  ADD COLUMN provider_place_id text,
  ADD COLUMN geocode_type text,
  ADD COLUMN geocoded_at timestamptz;

ALTER TABLE addresses
  ADD CONSTRAINT addresses_geocoding_provider_length
    CHECK(geocoding_provider IS NULL OR char_length(geocoding_provider) BETWEEN 2 AND 40),
  ADD CONSTRAINT addresses_provider_place_id_length
    CHECK(provider_place_id IS NULL OR char_length(provider_place_id) BETWEEN 1 AND 512),
  ADD CONSTRAINT addresses_geocode_type_length
    CHECK(geocode_type IS NULL OR char_length(geocode_type) BETWEEN 1 AND 80),
  ADD CONSTRAINT addresses_validation_complete
    CHECK(
      (geocoded_at IS NULL AND geocoding_provider IS NULL AND provider_place_id IS NULL AND geocode_type IS NULL)
      OR (geocoded_at IS NOT NULL AND geocoding_provider IS NOT NULL AND geocode_type IS NOT NULL)
    );

CREATE INDEX addresses_provider_place_id_idx
  ON addresses(geocoding_provider, provider_place_id)
  WHERE provider_place_id IS NOT NULL;

COMMENT ON COLUMN addresses.provider_place_id IS
  'Stable provider identity selected by the user; nullable only for non-production geocoders.';
COMMENT ON COLUMN addresses.geocoded_at IS
  'Time at which Flash signed the provider result; NULL marks an address that must be revalidated.';
