// Prueba de procedencia para una dirección geocodificada (GEO-001).
//
// El cliente ve etiquetas y coordenadas, pero no puede convertirlas en hechos
// de fulfillment por sí solo. Cada resultado del proveedor recibe un JWT breve,
// ligado al usuario que lo pidió. Guardar o editar una dirección PostgreSQL
// exige ese token y usa sus valores firmados, no los campos repetidos por el
// navegador o el móvil.
//
// No es un token de sesión: lleva audiencia e issuer propios. Así una access
// token válida no puede reutilizarse como validación geográfica, aunque ambas
// firmas usen la misma clave operativa.
import jwt from "jsonwebtoken";

import { config } from "./config.js";
import { isCommercialProvider } from "./maps-provider.js";

const ISSUER = "flash-api";
const AUDIENCE = "flash-address-validation";

function validationError(message = "La validación de la dirección venció; buscala nuevamente") {
  return Object.assign(new Error(message), { status: 409 });
}

export function issueGeocodeValidation({ result, provider, userPublicId, cache }) {
  return jwt.sign(
    {
      kind: "geocode_validation",
      provider,
      placeId: result.placeId ?? null,
      label: result.label,
      lat: result.point.lat,
      lng: result.point.lng,
      type: result.type || "address",
      cache,
    },
    config.jwtSecret,
    {
      algorithm: "HS256",
      audience: AUDIENCE,
      issuer: ISSUER,
      subject: userPublicId,
      expiresIn: "15m",
    },
  );
}

export function verifyGeocodeValidation(token, userPublicId) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      audience: AUDIENCE,
      issuer: ISSUER,
      subject: userPublicId,
    });
  } catch (_error) {
    throw validationError();
  }
  const valid =
    payload?.kind === "geocode_validation" &&
    payload.provider === config.maps.provider &&
    typeof payload.label === "string" &&
    payload.label.length >= 3 &&
    payload.label.length <= 240 &&
    Number.isFinite(payload.lat) &&
    Math.abs(payload.lat) <= 90 &&
    Number.isFinite(payload.lng) &&
    Math.abs(payload.lng) <= 180 &&
    (payload.placeId === null ||
      (typeof payload.placeId === "string" &&
        payload.placeId.length >= 1 &&
        payload.placeId.length <= 512)) &&
    typeof payload.type === "string" &&
    payload.type.length >= 1 &&
    payload.type.length <= 80;
  if (!valid) throw validationError("La respuesta geográfica no coincide con el proveedor activo");
  if (config.isProduction && (!isCommercialProvider(payload.provider) || !payload.placeId)) {
    throw validationError("La dirección debe validarse con el proveedor comercial activo");
  }
  return {
    address: payload.label,
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    provider: payload.provider,
    providerPlaceId: payload.placeId,
    geocodeType: payload.type,
    verifiedAt: new Date(Number(payload.iat) * 1000),
  };
}
