import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { api } from "../api";
import type { GeoPoint, Ride, RideTripCheck } from "../types";

// Control del viaje (SEG-01), como RideCheck de Uber: cuando el auto está detenido,
// se pierde la señal del conductor, se aleja del recorrido o el viaje termina lejos
// del destino, Flash pregunta si está todo bien. «Pedir ayuda» abre un incidente
// de seguridad en la misma cola que el SOS.

export const tripCheckCopy: Record<RideTripCheck["kind"], { title: string; body: string }> = {
  long_stop: {
    title: "¿Todo bien en tu viaje?",
    body: "Notamos que el auto está detenido hace varios minutos.",
  },
  signal_lost: {
    title: "¿Todo bien en tu viaje?",
    body: "Dejamos de recibir la ubicación del conductor.",
  },
  route_deviation: {
    title: "¿Todo bien en tu viaje?",
    body: "El auto se alejó del recorrido hacia tu destino.",
  },
  early_end: { title: "¿Llegaste bien?", body: "El viaje terminó lejos de tu destino." },
};

export function TripCheckBanner({ ride, location }: { ride: Ride; location?: GeoPoint }) {
  const [estado, setEstado] = useState<"idle" | "busy" | "ok" | "help">("idle");
  const [error, setError] = useState<string | null>(null);
  const check = ride.tripCheck;
  if (!check) return null;
  if (estado === "ok") return null;
  const copy = tripCheckCopy[check.kind];

  const contestar = async (response: "ok" | "help") => {
    setEstado("busy");
    setError(null);
    try {
      await api.answerRideTripCheck(ride.id, check.id, { response, location });
      setEstado(response);
    } catch (requestError) {
      setEstado("idle");
      setError(
        requestError instanceof Error ? requestError.message : "No se pudo enviar tu respuesta.",
      );
    }
  };

  return (
    <section className="trip-check" role="alert" aria-label="Control del viaje">
      <ShieldAlert size={22} aria-hidden="true" />
      <div>
        {estado === "help" ? (
          <>
            <strong>Avisamos a Seguridad Flash</strong>
            <p>Nuestro equipo ya tiene tu viaje y tu ubicación. Si es urgente, llamá al 911.</p>
          </>
        ) : (
          <>
            <strong>{copy.title}</strong>
            <p>{copy.body}</p>
            <div className="trip-check-actions">
              <button
                type="button"
                className="secondary"
                disabled={estado === "busy"}
                onClick={() => contestar("ok")}
              >
                Estoy bien
              </button>
              <button
                type="button"
                className="danger"
                disabled={estado === "busy"}
                onClick={() => contestar("help")}
              >
                Pedir ayuda
              </button>
            </div>
            {error && <small role="status">{error}</small>}
          </>
        )}
      </div>
    </section>
  );
}
