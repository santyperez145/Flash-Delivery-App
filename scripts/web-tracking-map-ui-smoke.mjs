import fs from "node:fs/promises";
import { readAudienceSource, readWebSource } from "./source-contract.mjs";

// La fuente se lee por audiencia y no por archivo (ARC-001 paso 8): la mitad del
// trabajo que queda del ticket es partir `App.tsx`, y un contrato con la ruta
// fija se rompe —o se vacía— en cuanto un componente cambia de archivo.
const { source: app } = await readWebSource();
const publicTracking = await fs.readFile("src/PublicRideTrackingPage.tsx", "utf8");
const entry = await fs.readFile("src/main.tsx", "utf8");
const map = await fs.readFile("src/maps/FlashMap.tsx", "utf8");
const vite = await fs.readFile("vite.config.ts", "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

// Cinco usos, no cuatro.
//
// Contaba sobre `src/App.tsx` más `src/PublicRideTrackingPage.tsx` y exigía
// exactamente 4. Cuando `RideHome` se extrajo a su propio archivo, su uso del
// mapa **dejó de contarse y el contrato siguió en verde**: afirmaba una
// cobertura de cuatro verticales mientras miraba tres. Es el mismo defecto que
// ARC-001 encontró en `test:realtime-audience`, ya consumado acá.
//
// Ahora cuenta sobre el árbol web entero, así que un componente que cambie de
// archivo sigue contando. Y el número es un piso además de una igualdad: si
// alguien agrega una vertical con mapa, esto falla y le pide declararla.
const mapUsages = [...app.matchAll(/<FlashMap\b/g)].length;
assert(
  mapUsages === 5,
  `tracking público, comida, viajes y envíos comparten el mapa interactivo (${mapUsages} usos)`,
);
// La prohibición es para las **pantallas**, no para el renderer.
//
// `src/maps/FlashMap.tsx` declara su capa base de tiles, que es exactamente
// donde corresponde y es el punto del contrato: la plomería cartográfica vive en
// un módulo aislado. Al pasar a leer el árbol entero, la aserción empezaba a
// atrapar ese uso legítimo, así que la exclusión se declara en vez de aflojar la
// regla.
const { source: pantallas } = await readAudienceSource(["src"], { exclude: ["src/maps/"] });
assert(
  !pantallas.includes("buildWebTrackingMap") && !pantallas.includes("tile.openstreetmap.org"),
  "las pantallas no reimplementan la proyección ni la grilla raster legacy",
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
