import { BadgeDollarSign, Bike, Car, LocateFixed, MapPin, ShieldCheck, Sparkles, Truck } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "./api";
import type { AppState, Ride, RideForm, RideQuote, RideStatus, RoadRoute, User, UserAddress } from "./types";

const money=new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});
const statusLabel:Record<RideStatus,string>={requested:"Buscando conductor",driver_assigned:"Conductor asignado",arriving:"Llegando",in_progress:"En viaje",completed:"Completado",cancelled:"Cancelado"};
const steps:RideStatus[]=["requested","driver_assigned","arriving","in_progress","completed"];
const services:Array<{id:Ride["service"];label:string;icon:typeof Car}>=[{id:"economy",label:"Flash",icon:Car},{id:"comfort",label:"Comfort",icon:Sparkles},{id:"moto",label:"Moto",icon:Bike},{id:"xl",label:"XL",icon:Truck}];
const FlashMap=lazy(()=>import("./maps/FlashMap"));

export default function RideHome({state,user,addresses,rideForm,setRideForm,quote,quoteRide,requestRide,locatePickup,locationStatus,locationMessage,busy}:{state:AppState;user:User|null;addresses:UserAddress[];rideForm:RideForm;setRideForm:React.Dispatch<React.SetStateAction<RideForm>>;quote:RideQuote|null;quoteRide:()=>void;requestRide:()=>void;locatePickup:()=>void;locationStatus:"idle"|"locating"|"ready"|"denied";locationMessage:string;busy:boolean}){
  const[route,setRoute]=useState<RoadRoute|null>(null),[routeError,setRouteError]=useState("");
  const activeRide=state.rides.find(ride=>ride.customerId===user?.id&&!['completed','cancelled'].includes(ride.status));
  const driver=state.drivers.find(entry=>entry.id===activeRide?.driverId);
  const savedDestinations=addresses.filter(entry=>entry.lat!==null&&entry.lng!==null&&(entry.address!==rideForm.pickup||entry.lat!==rideForm.pickupCoords?.lat||entry.lng!==rideForm.pickupCoords?.lng));
  useEffect(()=>{let active=true;setRoute(null);setRouteError("");if(!rideForm.pickupCoords||!rideForm.destinationCoords)return;api.route(rideForm.pickupCoords,rideForm.destinationCoords).then(result=>{if(active)setRoute(result.route);}).catch(error=>{if(active)setRouteError(error instanceof Error?error.message:"Ruta no disponible");});return()=>{active=false};},[rideForm.pickupCoords?.lat,rideForm.pickupCoords?.lng,rideForm.destinationCoords?.lat,rideForm.destinationCoords?.lng]);
  const hasMap=Boolean(rideForm.pickupCoords&&rideForm.destinationCoords);
  return <>
    {hasMap?<Suspense fallback={<section className="ride-map ride-preview-map flash-map-loading" aria-label="Cargando mapa interactivo"><span>Cargando mapa…</span></section>}><FlashMap origin={rideForm.pickupCoords!} destination={rideForm.destinationCoords!} route={route?.coordinates||[]} className="ride-map ride-preview-map" ariaLabel="Vista previa interactiva del recorrido" caption={route?`${route.distanceKm} km · ${route.durationMin} min`:routeError||"Calculando ruta vial…"} detail={routeError?"La cotización informará si existe cobertura.":"Arrastrá para explorar · usá el control para reencuadrar"}/></Suspense>:<section className="ride-map ride-map-empty" aria-label="Definí origen y destino para ver el mapa"><div className="ride-map-empty-copy"><LocateFixed size={24}/><strong>Tu viaje empieza en una ubicación real</strong><span>Usá el GPS o una dirección guardada y elegí el destino.</span></div></section>}
    <section className="booking-card">
      <label><span>Origen</span><input value={rideForm.pickup} placeholder="Usá GPS o escribí el punto de partida" onChange={event=>setRideForm(current=>({...current,pickup:event.target.value,pickupCoords:null}))}/></label>
      <label><span>Destino</span><input value={rideForm.destination} placeholder="¿A dónde vas?" onChange={event=>setRideForm(current=>({...current,destination:event.target.value,destinationCoords:null}))}/></label>
      <button className="location-action" type="button" onClick={locatePickup} disabled={busy||locationStatus==="locating"}><LocateFixed size={15}/>{locationStatus==="locating"?"Buscando GPS...":"Usar mi ubicación actual"}</button>
      {locationMessage&&<small className={`location-message ${locationStatus}`}>{locationMessage}</small>}
      {savedDestinations.length>0&&<div className="ride-saved-destinations" aria-label="Destinos guardados">{savedDestinations.map(entry=><button type="button" key={entry.id} onClick={()=>setRideForm(current=>({...current,destination:entry.address,destinationCoords:{lat:entry.lat!,lng:entry.lng!}}))}><MapPin size={14}/><span>{entry.label}</span></button>)}</div>}
      <div className="ride-services">{services.map(({id,label,icon:Icon})=><button className={rideForm.service===id?"active":""} key={id} onClick={()=>setRideForm(current=>({...current,service:id}))} type="button"><Icon size={16}/><span>{label}</span></button>)}</div>
      {quote&&<div className="quote-card"><div><span>{quote.distanceKm} km · {quote.durationMin} min</span><strong>{money.format(quote.fare)}</strong></div><small>{quote.etaMin} min hasta el punto · {quote.routingMode==="coordinates"?"basado en coordenadas":"estimación por dirección"}</small></div>}
      <div className="two-actions"><button className="ghost-action" onClick={quoteRide} type="button" disabled={busy||!rideForm.pickup.trim()||!rideForm.destination.trim()}><BadgeDollarSign size={16}/> Cotizar</button><button className="primary-button" onClick={requestRide} type="button" disabled={busy||!quote?.quoteToken}><Car size={16}/> Pedir viaje</button></div>
    </section>
    <section className="safety-panel"><div><ShieldCheck size={18}/><strong>Viaje protegido</strong></div>{[["PIN","Verificación al subir"],["Share","Compartir recorrido"],["SOS","Soporte prioritario"]].map(([label,value])=><span key={label}><b>{label}</b>{value}</span>)}</section>
    {activeRide&&<section className="tracking-card"><div><span className="muted-label">Tracking</span><strong>{statusLabel[activeRide.status]} · {activeRide.etaMin} min</strong><small>{activeRide.pickup} → {activeRide.destination}</small></div><div className="stepper">{steps.map((step,index)=>{const currentIndex=steps.indexOf(activeRide.status);return <div className={index<=currentIndex?"step active":"step"} key={step}><span>{index+1}</span><small>{statusLabel[step]}</small></div>})}</div><div className="tracking-person"><span className="avatar">{(driver?.name||"FD").split(" ").map(part=>part[0]).join("").slice(0,2)}</span><div><strong>{driver?.name||"Asignando conductor"}</strong><small>{money.format(activeRide.fare)}</small></div></div></section>}
  </>;
}
