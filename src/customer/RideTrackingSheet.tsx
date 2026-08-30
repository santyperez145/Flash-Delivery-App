import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Car, Check, Copy, KeyRound, MapPin, ShieldCheck, TriangleAlert, X } from "lucide-react";

import { api } from "../api";
import { initials, money } from "../format";
import { rideStatusLabel, rideSteps } from "../labels";
import type { Driver, Ride, RoadRoute } from "../types";

const FlashMap = lazy(() => import("../maps/FlashMap"));

const rideSafetyOptions = [
  ["sos", "Necesito ayuda urgente"],
  ["unsafe_driving", "Conducción insegura"],
  ["medical", "Emergencia médica"],
  ["harassment", "Acoso o amenaza"],
  ["crash", "Choque o incidente vial"],
  ["other", "Otro problema"],
] as const;

export function RideTrackingSheet({
  ride,
  driver,
  onClose,
}: {
  ride: Ride;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const [pickupBusy, setPickupBusy] = useState(false);
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyType, setSafetyType] = useState<(typeof rideSafetyOptions)[number][0]>("sos");
  const [safetyDetails, setSafetyDetails] = useState("");
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyNotice, setSafetyNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const origin = ride.pickupLocation;
    const destination = ride.destinationLocation;
    setRoute(null);
    setRouteError(null);
    if (!origin || !destination) {
      setRouteError("Mapa no disponible: faltan coordenadas del viaje.");
      return () => {
        cancelled = true;
      };
    }
    setRouteLoading(true);
    void api
      .route(origin, destination)
      .then((response) => {
        if (!cancelled) setRoute(response.route);
      })
      .catch((error) => {
        if (!cancelled)
          setRouteError(
            error instanceof Error ? error.message : "La ruta vial no está disponible ahora.",
          );
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    ride.id,
    ride.pickupLocation?.lat,
    ride.pickupLocation?.lng,
    ride.destinationLocation?.lat,
    ride.destinationLocation?.lng,
  ]);

  const hasMap = Boolean(ride.pickupLocation && ride.destinationLocation);
  const currentIndex = Math.max(rideSteps.indexOf(ride.status), 0);
  const nextStep = route?.steps[0]?.instruction || null;

  const revealPickupCode = async () => {
    setPickupBusy(true);
    try {
      const response = await api.getRidePickupCode(ride.id);
      setPickupCode(response.pickupCode);
    } catch (error) {
      setShareNotice(error instanceof Error ? error.message : "No se pudo consultar el PIN.");
    } finally {
      setPickupBusy(false);
    }
  };

  const shareRide = async () => {
    setShareBusy(true);
    setShareNotice(null);
    try {
      const response = await api.createRideTrackingLink(ride.id, 180);
      const configuredUrl = response.link.trackingUrl;
      const token = configuredUrl.split("/track/")[1]?.split(/[?#]/)[0];
      const url =
        token && typeof window !== "undefined"
          ? `${window.location.origin}/track/${token}`
          : configuredUrl;
      setTrackingUrl(url);
      const text = `Seguimiento de mi viaje Flash. Conductor: ${driver?.name || "asignando"}. Vence: ${new Date(response.link.expiresAt).toLocaleString("es-AR")}. ${url}`;
      if (navigator.share) {
        await navigator.share({ title: "Viaje Flash", text, url });
        setShareNotice("Seguimiento compartido");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setShareNotice("Enlace temporal copiado");
      } else {
        setShareNotice("Enlace temporal creado");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setShareNotice(error instanceof Error ? error.message : "No se pudo compartir el viaje.");
    } finally {
      setShareBusy(false);
    }
  };

  const submitSafetyIncident = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSafetyBusy(true);
    setSafetyNotice(null);
    try {
      await api.createRideSafetyIncident(ride.id, {
        type: safetyType,
        details: safetyDetails.trim() || undefined,
        location: driver?.location || ride.pickupLocation || undefined,
      });
      setSafetyNotice("Incidente registrado. Seguridad Flash ya recibió el caso.");
      setSafetyDetails("");
      setSafetyOpen(false);
    } catch (error) {
      setSafetyNotice(
        error instanceof Error ? error.message : "No se pudo registrar el incidente.",
      );
    } finally {
      setSafetyBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop tracking-backdrop" role="presentation">
      <section
        className="item-sheet order-tracking-sheet ride-tracking-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ride-tracking-title"
      >
        <button
          className="sheet-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar seguimiento"
        >
          <X size={18} />
        </button>
        <div className="tracking-sheet-heading">
          <div>
            <span className="muted-label">Viaje en vivo</span>
            <h2 id="ride-tracking-title">{rideStatusLabel[ride.status]}</h2>
            <p>
              {ride.pickup} → {ride.destination} · {money.format(ride.fare)}
            </p>
          </div>
          <span className="ride-service-badge">
            <Car size={14} /> {ride.service}
          </span>
        </div>
        {hasMap ? (
          <Suspense
            fallback={
              <div className="order-tracking-map flash-map-loading">
                <span>Cargando mapa…</span>
              </div>
            }
          >
            <FlashMap
              origin={ride.pickupLocation!}
              destination={ride.destinationLocation!}
              route={route?.coordinates || []}
              driver={driver?.location || null}
              routeColor="#7c3cff"
              ariaLabel="Mapa interactivo de seguimiento del viaje"
              caption={
                route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"
              }
              detail={
                driver
                  ? `${driver.name} · ${driver.vehicle} · ${driver.plate}`
                  : "Buscando un conductor disponible"
              }
            />
          </Suspense>
        ) : (
          <div className="tracking-map-empty">
            <MapPin size={20} />
            <strong>El mapa se activará al recibir coordenadas</strong>
            <span>{routeError}</span>
          </div>
        )}
        <div className="tracking-status-panel">
          <div className="tracking-status-copy">
            <div>
              <span className="muted-label">Estado actual</span>
              <h3>{rideStatusLabel[ride.status]}</h3>
            </div>
            {driver && (
              <div className="tracking-driver-summary">
                <span className="avatar">{initials(driver.name)}</span>
                <span>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.vehicle} · {driver.plate} · ★ {driver.rating.toFixed(1)}
                  </small>
                </span>
              </div>
            )}
          </div>
          <div className="stepper tracking-stepper ride-tracking-stepper">
            {rideSteps.map((step, index) => (
              <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                <small>{rideStatusLabel[step]}</small>
              </div>
            ))}
          </div>
          {nextStep && ride.status === "in_progress" && (
            <div className="next-route-step">
              <MapPin size={15} /> <span>{nextStep}</span>
            </div>
          )}
        </div>
        {driver && ["driver_assigned", "arriving"].includes(ride.status) && (
          <section className="ride-pin-card">
            <div>
              <span className="muted-label">PIN para iniciar</span>
              <strong>{pickupCode || "••••"}</strong>
              <small>Compartilo sólo cuando confirmes que estás junto al vehículo correcto.</small>
            </div>
            {!pickupCode && (
              <button type="button" onClick={() => void revealPickupCode()} disabled={pickupBusy}>
                <KeyRound size={15} /> {pickupBusy ? "Consultando…" : "Mostrar PIN"}
              </button>
            )}
          </section>
        )}
        <section className="ride-safety-actions">
          <div className="ride-safety-heading">
            <span className="safety-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Centro de seguridad</strong>
              <small>Acciones vinculadas a este viaje</small>
            </div>
          </div>
          <div className="ride-action-grid">
            <button type="button" onClick={() => void shareRide()} disabled={shareBusy}>
              <Copy size={15} /> {shareBusy ? "Creando enlace…" : "Compartir viaje"}
            </button>
            <button type="button" className="danger" onClick={() => setSafetyOpen((open) => !open)}>
              <TriangleAlert size={15} /> Reportar incidente
            </button>
          </div>
          {shareNotice && <small className="tracking-action-notice">{shareNotice}</small>}
          {trackingUrl && (
            <a
              className="tracking-link-preview"
              href={trackingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir enlace temporal
            </a>
          )}
          {safetyNotice && (
            <small className="tracking-action-notice safety-notice">{safetyNotice}</small>
          )}
          {safetyOpen && (
            <form
              className="ride-safety-form"
              onSubmit={(event) => void submitSafetyIncident(event)}
            >
              <label>
                <span>Tipo de incidente</span>
                <select
                  value={safetyType}
                  onChange={(event) => setSafetyType(event.target.value as typeof safetyType)}
                >
                  {rideSafetyOptions.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Detalle opcional</span>
                <textarea
                  value={safetyDetails}
                  onChange={(event) => setSafetyDetails(event.target.value)}
                  maxLength={1000}
                  placeholder="Contanos qué ocurrió"
                />
              </label>
              <button className="danger-button" type="submit" disabled={safetyBusy}>
                <TriangleAlert size={15} />{" "}
                {safetyBusy ? "Registrando…" : "Enviar a Seguridad Flash"}
              </button>
            </form>
          )}
        </section>
        <p className="tracking-integrity-note">
          La ubicación y los estados provienen del backend autenticado. Si una señal o el proveedor
          de mapas falla, Flash conserva el viaje y sus acciones de seguridad sin inventar
          movimiento.
        </p>
      </section>
    </div>
  );
}
