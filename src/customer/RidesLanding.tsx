import { Clock3, MapPin, Navigation, Star } from "lucide-react";

import type { AppState, GeoPoint, RideForm, User } from "../types";
import type { Portada, ServicioWeb } from "./CustomerHome";
import { useServiciosWeb } from "./CustomerHome";
import { EnCurso, enCursoDe, Seccion } from "./CustomerHomeFeed";
import { TripCheckBanner } from "./TripCheckBanner";

// El inicio de Viajes (FE-01), como el de Uber: «¿A dónde vas?» primero, después
// los lugares guardados y los destinos recientes, que llevan al viaje con el
// destino ya cargado. **Sólo datos de la cuenta**: un destino reciente es uno al
// que la persona viajó, con sus coordenadas; uno sin coordenadas no se ofrece,
// porque no se podría cotizar.

type Flags = Record<string, { active: boolean; variant: Record<string, unknown> }> | null;
type Lugar = {
  id: string;
  titulo: string;
  detalle: string;
  /** La dirección que va al viaje: en un reciente es el título, no el subtítulo. */
  direccion: string;
  punto: GeoPoint;
  reciente: boolean;
};

export function lugaresDe(state: AppState, userId: string | undefined): Lugar[] {
  const guardados = state.addresses
    .filter((entry) => entry.userId === userId && entry.lat !== null && entry.lng !== null)
    .map((entry) => ({
      id: `guardado-${entry.id}`,
      titulo: entry.label,
      detalle: entry.address,
      direccion: entry.address,
      punto: { lat: entry.lat as number, lng: entry.lng as number },
      reciente: false,
    }));
  const vistos = new Set(guardados.map((lugar) => lugar.detalle));
  const recientes: Lugar[] = [];
  for (const ride of [...state.rides]
    .filter(
      (entry) =>
        entry.customerId === userId &&
        // «Viajaste» sólo si el viaje terminó: uno cancelado no es un lugar visitado.
        entry.status === "completed" &&
        entry.destinationLocation,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (vistos.has(ride.destination)) continue;
    vistos.add(ride.destination);
    recientes.push({
      id: `reciente-${ride.id}`,
      titulo: ride.destination,
      detalle: "Viajaste hace poco",
      direccion: ride.destination,
      punto: ride.destinationLocation as GeoPoint,
      reciente: true,
    });
  }
  return [...guardados, ...recientes.slice(0, 4)];
}

export function RidesHome({
  state,
  user,
  features,
  portada,
  setRideForm,
  onOpenActivity,
}: {
  state: AppState;
  user: User | null;
  features: Flags;
  portada: Portada;
  setRideForm: React.Dispatch<React.SetStateAction<RideForm>>;
  onOpenActivity: () => void;
}) {
  const { servicios } = useServiciosWeb(features, "viajes");
  const viajes = servicios.some((servicio) => servicio.tipo === "ride");
  const lugares = viajes ? lugaresDe(state, user?.id) : [];
  const irA = (lugar: Lugar) => {
    setRideForm((form) => ({
      ...form,
      destination: lugar.direccion,
      destinationCoords: lugar.punto,
    }));
    portada.abrir("ride");
  };
  const abrir = (servicio: ServicioWeb) =>
    portada.abrir(servicio.tipo === "shipment" ? "shipment" : "ride");

  return (
    <section className="customer-home rides-home" aria-label="Inicio de Viajes">
      <div className="customer-home-hero">
        <h1>Hola{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p>{viajes ? "¿A dónde vamos?" : "Mandá un paquete en el día"}</p>
        {viajes && (
          <button type="button" className="rides-where" onClick={() => portada.abrir("ride")}>
            <Navigation size={20} /> ¿A dónde vas?
            <span className="customer-home-where-now">
              <Clock3 size={14} /> Ahora
            </span>
          </button>
        )}
      </div>
      {/* SEG-01: un aviso del control del viaje, también después de terminar (un
          final lejos del destino se pregunta con el viaje cerrado). */}
      {state.rides
        .filter((ride) => ride.customerId === user?.id && ride.tripCheck)
        .map((ride) => (
          <TripCheckBanner key={ride.id} ride={ride} />
        ))}
      <EnCurso items={enCursoDe(state, user?.id, "viajes")} onOpen={onOpenActivity} />
      {lugares.length > 0 && (
        <ul className="rides-places" aria-label="Lugares">
          {lugares.map((lugar) => (
            <li key={lugar.id}>
              <button type="button" onClick={() => irA(lugar)}>
                <span aria-hidden="true">
                  {lugar.reciente ? <Clock3 size={18} /> : <Star size={18} />}
                </span>
                <span>
                  <strong>{lugar.titulo}</strong>
                  <small>{lugar.detalle}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {servicios.length > 0 && (
        <Seccion titulo="Sugerencias">
          <div className="customer-home-grid" data-pocos>
            {servicios.map((servicio) => (
              <button
                type="button"
                key={servicio.tipo}
                data-servicio={servicio.tipo}
                aria-label={servicio.titulo}
                onClick={() => abrir(servicio)}
              >
                <span className="customer-home-tile-icon" aria-hidden="true">
                  <servicio.icono size={26} />
                </span>
                <strong>{servicio.titulo}</strong>
                <small>{servicio.detalle}</small>
              </button>
            ))}
          </div>
        </Seccion>
      )}
      {!servicios.length && (
        <p className="customer-home-notice">
          <MapPin size={16} /> Viajes y envíos todavía no están disponibles en tu zona.
        </p>
      )}
    </section>
  );
}
