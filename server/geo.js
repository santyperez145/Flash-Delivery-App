// Coordenadas: la forma que se acepta y la distancia entre dos (ticket ARC-001).
//
// Las dos cosas estaban sueltas en `server/index.js` y las comparten los tres
// dominios que mueven algo por la ciudad: viajes, envíos y la posición del
// conductor. Extraer viajes primero las habría duplicado.
//
// `coordinateSchema` acota a los rangos reales del planeta. No es formalismo:
// una latitud de 200 llega a PostGIS y produce un punto que `ST_DWithin` mide
// contra cualquier cosa, así que el disparate tiene que morir en el borde.
//
// `distanceBetween` es haversine sobre una esfera de 6.371 km. Es una
// aproximación —la Tierra no es esférica y la ruta no es la línea recta— y por
// eso se usa para ordenar y descartar candidatos, nunca para cobrar. El precio
// sale del plan tarifario versionado, y la distancia vial de la API de mapas.
//
// Devuelve `null` cuando falta cualquiera de los dos puntos, en lugar de `0` o
// `NaN`. Cero significaría «están en el mismo lugar», que es exactamente la
// respuesta equivocada para «no sé dónde está»: pondría al conductor sin
// posición conocida primero en la lista de cercanos.
import { z } from "zod";

export const coordinateSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export function distanceBetween(first, second) {
  if (!first || !second) return null;
  const earthRadiusKm = 6371;
  const latDelta = ((second.lat - first.lat) * Math.PI) / 180;
  const lngDelta = ((second.lng - first.lng) * Math.PI) / 180;
  const firstLat = (first.lat * Math.PI) / 180;
  const secondLat = (second.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.sin(lngDelta / 2) ** 2 * Math.cos(firstLat) * Math.cos(secondLat);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
