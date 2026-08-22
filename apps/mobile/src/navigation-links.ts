import type { GeoPoint } from "./types";

export type NavigationTravelMode = "driving" | "bicycling";

export function buildExternalNavigationUrl(
  platform: string,
  destinationPoint: GeoPoint,
  travelMode: NavigationTravelMode,
) {
  const { lat, lng } = destinationPoint;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) return null;

  const destination = encodeURIComponent(`${lat},${lng}`);
  if (platform === "ios" && travelMode === "driving") {
    return `http://maps.apple.com/?daddr=${destination}&dirflg=d`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=${travelMode}&dir_action=navigate`;
}
