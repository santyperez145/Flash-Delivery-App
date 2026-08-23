import { Check, Flame, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "./api";
import type { PublicRideTracking, RideStatus } from "./types";

const FlashMap = lazy(() => import("./maps/FlashMap"));

const rideStatusLabel: Record<RideStatus, string> = {
  requested: "Buscando conductor",
  driver_assigned: "Conductor asignado",
  arriving: "Llegando",
  in_progress: "En viaje",
  completed: "Completado",
  cancelled: "Cancelado",
};

const rideSteps: RideStatus[] = [
  "requested",
  "driver_assigned",
  "arriving",
  "in_progress",
  "completed",
];

export default function PublicRideTrackingPage({ token }: { token: string }) {
  const [tracking, setTracking] = useState<PublicRideTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.getPublicRideTracking(token);
        if (!cancelled) {
          setTracking(response.tracking);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Este enlace no existe, venció o fue revocado.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token]);

  const currentIndex = tracking
    ? Math.max(rideSteps.indexOf(tracking.status), 0)
    : 0;

  return (
    <main className="public-tracking-page">
      <header className="public-tracking-header">
        <a className="public-tracking-brand" href="/" aria-label="Abrir Flash">
          <span className="brand-mark"><Flame size={20} /></span>
          <strong>Flash</strong>
        </a>
        <span className="public-tracking-secure"><ShieldCheck size={14} /> Seguimiento seguro</span>
      </header>
      {loading && !tracking ? (
        <section className="public-tracking-state" aria-live="polite">
          <RefreshCw size={22} className="spin" />
          <strong>Cargando seguimiento</strong>
          <span>Consultando el estado vigente del viaje.</span>
        </section>
      ) : error && !tracking ? (
        <section className="public-tracking-state error" role="alert">
          <TriangleAlert size={22} />
          <strong>Seguimiento no disponible</strong>
          <span>{error}</span>
        </section>
      ) : tracking && (
        <div className="public-tracking-content">
          <section className="public-tracking-intro">
            <span className="muted-label">Viaje Flash · {tracking.rideId}</span>
            <h1>{rideStatusLabel[tracking.status]}</h1>
            <p>{tracking.pickup} → {tracking.destination}</p>
          </section>
          <Suspense fallback={<section className="public-tracking-map flash-map-loading"><span>Cargando mapa…</span></section>}>
            <FlashMap
              origin={tracking.pickupLocation}
              destination={tracking.destinationLocation}
              driver={tracking.driver?.location || null}
              className="public-tracking-map"
              ariaLabel="Mapa público interactivo del viaje"
              caption={tracking.driver?.location ? "Ubicación del conductor actualizada" : "Conductor sin posición compartida"}
              detail={`ETA publicada: ${tracking.etaMin} min`}
            />
          </Suspense>
          <section className="public-tracking-summary">
            <div>
              <span className="muted-label">Conductor</span>
              <strong>{tracking.driver?.firstName || "Asignando conductor"}</strong>
              <small>{tracking.driver ? `${tracking.driver.vehicle || "Vehículo Flash"} · ${tracking.driver.plate || "patente no disponible"}` : "Te avisaremos cuando haya asignación."}</small>
            </div>
            <div className="public-tracking-eta"><span>ETA</span><strong>{tracking.etaMin} min</strong></div>
          </section>
          <section className="public-tracking-progress">
            <div className="stepper tracking-stepper ride-tracking-stepper">
              {rideSteps.map((step, index) => (
                <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                  <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                  <small>{rideStatusLabel[step]}</small>
                </div>
              ))}
            </div>
          </section>
          <p className="public-tracking-note">
            Este enlace vence el {new Date(tracking.expiresAt).toLocaleString("es-AR")}. No muestra teléfono, email ni información de pago.
          </p>
        </div>
      )}
    </main>
  );
}
