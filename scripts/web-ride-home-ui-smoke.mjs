import fs from "node:fs/promises";

const app=await fs.readFile("src/App.tsx","utf8"),ride=await fs.readFile("src/RideHome.tsx","utf8");
const assert=(condition,message)=>{if(!condition)throw new Error(message);console.log(`ok - ${message}`);};
const initialForm=app.slice(app.indexOf("const [rideForm"),app.indexOf("const [quote",app.indexOf("const [rideForm")));

assert(initialForm.includes('pickup: ""')&&initialForm.includes('destination: ""')&&!initialForm.includes("Defensa")&&!initialForm.includes("Aeroparque"),"Viajes web no inicia con una ruta ficticia");
assert(app.includes("rideSeededUserId")&&app.includes("entry.isDefault")&&app.includes("entry.lat!==null"),"origen inicial deriva una sola vez de la dirección geocodificada propia");
assert(ride.includes("api.route(")&&ride.includes("tile.openstreetmap.org")&&ride.includes("route?.coordinates"),"vista previa usa rutas y teselas reales");
assert(ride.includes("savedDestinations.map")&&ride.includes("destinationCoords:{lat:entry.lat!"),"destinos guardados conservan coordenadas al seleccionarse");
assert(ride.includes('disabled={busy||!rideForm.pickup.trim()||!rideForm.destination.trim()}'),"cotización se bloquea sin origen y destino explícitos");
