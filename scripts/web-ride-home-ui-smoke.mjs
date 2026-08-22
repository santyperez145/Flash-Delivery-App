import fs from "node:fs/promises";

const app=await fs.readFile("src/App.tsx","utf8"),ride=await fs.readFile("src/RideHome.tsx","utf8"),map=await fs.readFile("src/maps/FlashMap.tsx","utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message);console.log(`ok - ${message}`);};
const initialForm=app.slice(app.indexOf("const [rideForm"),app.indexOf("const [quote",app.indexOf("const [rideForm")));

assert(initialForm.includes('pickup: ""')&&initialForm.includes('destination: ""')&&!initialForm.includes("Defensa")&&!initialForm.includes("Aeroparque"),"Viajes web no inicia con una ruta ficticia");
assert(app.includes("rideSeededUserId")&&app.includes("entry.isDefault")&&app.includes("entry.lat!==null"),"origen inicial deriva una sola vez de la dirección geocodificada propia");
assert(ride.includes("api.route(")&&ride.includes('import("./maps/FlashMap")')&&ride.includes("route?.coordinates"),"vista previa usa rutas reales y un motor cartográfico aislado");
assert(map.includes("new maplibregl.Map")&&map.includes("fitBounds")&&map.includes("NavigationControl")&&map.includes("AttributionControl"),"mapa permite explorar, reencuadrar y conserva atribución");
assert(map.includes("VITE_MAP_STYLE_URL")&&map.includes("tile.openstreetmap.org")&&map.includes('type: "raster"'),"estilo vectorial configurable conserva fallback cartográfico explícito");
assert(map.includes('validRoute.length > 1 ? validRoute : []'),"una falla de rutas no dibuja un recorrido directo inventado");
assert(ride.includes("savedDestinations.map")&&ride.includes("destinationCoords:{lat:entry.lat!"),"destinos guardados conservan coordenadas al seleccionarse");
assert(ride.includes('disabled={busy||!rideForm.pickup.trim()||!rideForm.destination.trim()}'),"cotización se bloquea sin origen y destino explícitos");
