import { postgresPool } from "./postgres.js";

const mapCity = (row) => ({
  id: row.public_id,
  slug: row.slug,
  name: row.name,
  countryCode: row.country_code,
  currency: row.currency,
  timezone: row.timezone,
  status: row.status,
  enabledServices: row.enabled_services,
  center: { lat: Number(row.center_lat), lng: Number(row.center_lng) },
});

export async function getPublicCities() {
  const result = await postgresPool.query(`SELECT public_id,slug,name,country_code,currency,timezone,status,enabled_services,
    ST_Y(center::geometry) center_lat,ST_X(center::geometry) center_lng
    FROM cities WHERE status IN('beta','active') ORDER BY name`);
  return result.rows.map(mapCity);
}

export async function findPublicCity(slug) {
  const cities = await getPublicCities();
  return cities.find((city) => city.slug === slug) || null;
}
