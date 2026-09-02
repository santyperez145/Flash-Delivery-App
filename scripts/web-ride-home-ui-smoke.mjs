import fs from "node:fs/promises";
import { contains, containsAll, containsNone, section } from "./source-contract.mjs";

const commerce = await fs.readFile("src/customer/useCustomerCommerce.tsx", "utf8"),
  ride = await fs.readFile("src/RideHome.tsx", "utf8"),
  map = await fs.readFile("src/maps/FlashMap.tsx", "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};
const initialForm = section(commerce, "const emptyRideForm", "const [quote", {
  minChars: 150,
});

assert(
  containsAll(initialForm, ['pickup: ""', 'destination: ""']) &&
    containsNone(initialForm, ["Defensa", "Aeroparque"]),
  "Viajes web no inicia con una ruta ficticia",
);
assert(
  containsAll(commerce, ["rideSeededUserId", "entry.isDefault", "entry.lat !== null"]),
  "origen inicial deriva una sola vez de la dirección geocodificada propia",
);
assert(
  containsAll(ride, ["api.route(", 'import("./maps/FlashMap")', "route?.coordinates"]),
  "vista previa usa rutas reales y un motor cartográfico aislado",
);
assert(
  containsAll(map, ["new maplibregl.Map", "fitBounds", "NavigationControl", "AttributionControl"]),
  "mapa permite explorar, reencuadrar y conserva atribución",
);
assert(
  containsAll(map, ["VITE_MAP_STYLE_URL", "tile.openstreetmap.org", 'type: "raster"']),
  "estilo vectorial configurable conserva fallback cartográfico explícito",
);
assert(
  contains(map, "validRoute.length > 1 ? validRoute : []"),
  "una falla de rutas no dibuja un recorrido directo inventado",
);
assert(
  containsAll(ride, ["savedDestinations.map", "destinationCoords: { lat: entry.lat!"]),
  "destinos guardados conservan coordenadas al seleccionarse",
);
assert(
  contains(ride, "disabled={busy || !rideForm.pickup.trim() || !rideForm.destination.trim()}"),
  "cotización se bloquea sin origen y destino explícitos",
);
