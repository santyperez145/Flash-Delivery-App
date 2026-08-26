import fs from "node:fs/promises";

const app = await fs.readFile("src/App.tsx", "utf8");
const publicTracking = await fs.readFile("src/PublicRideTrackingPage.tsx", "utf8");
const entry = await fs.readFile("src/main.tsx", "utf8");
const map = await fs.readFile("src/maps/FlashMap.tsx", "utf8");
const vite = await fs.readFile("vite.config.ts", "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

const mapUsages = [...`${app}\n${publicTracking}`.matchAll(/<FlashMap\b/g)].length;
assert(mapUsages === 4, "tracking público, comida, viajes y envíos comparten el mapa interactivo");
assert(
  !`${app}\n${publicTracking}`.includes("buildWebTrackingMap") &&
    !`${app}\n${publicTracking}`.includes("tile.openstreetmap.org"),
  "App elimina la proyección y grilla raster legacy",
);
assert(
  app.includes('routeColor="#f4511e"') &&
    app.includes('routeColor="#7c3cff"') &&
    app.includes('routeColor="#087a50"'),
  "cada vertical conserva su jerarquía cromática de ruta",
);
assert(
  app.includes("driver={driver?.location || null}") &&
    publicTracking.includes("driver={tracking.driver?.location || null}"),
  "el marcador móvil depende de coordenadas reales del backend",
);
assert(
  entry.includes('lazy(() => import("./PublicRideTrackingPage"))'),
  "el tracking público queda fuera de la carga inicial de la plataforma autenticada",
);
assert(
  map.includes("validRoute.length > 1 ? validRoute : []") && !map.includes("[origin, destination]"),
  "el renderer no inventa una ruta directa al degradarse routing",
);
assert(
  map.includes("setData(routeFeature") && map.includes("markersRef.current.forEach"),
  "tracking actualiza geometría y marcadores sin acumular capas",
);
assert(
  vite.includes('exclude: ["maplibre-gl"]'),
  "Vite conserva el worker propio de MapLibre durante desarrollo y HMR",
);
