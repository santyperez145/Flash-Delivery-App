import { lazy, Suspense, useEffect, useState } from "react";
import { Check, Copy, KeyRound, MapPin, X } from "lucide-react";

import { api } from "../api";
import { initials, money } from "../format";
import { shipmentStatusLabel, shipmentSteps } from "../labels";
import type { DeliveryEvidence, Driver, RoadRoute, Shipment } from "../types";

const FlashMap = lazy(() => import("../maps/FlashMap"));

export function ShipmentTrackingSheet({
  shipment,
  driver,
  onClose,
}: {
  shipment: Shipment;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [evidence, setEvidence] = useState<DeliveryEvidence[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [deliveryCode, setDeliveryCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const origin = shipment.pickupLocation;
    const destination = shipment.destinationLocation;
    setRoute(null);
    setEvidence([]);
    setEvidenceError(null);
    setRouteError(null);
    if (!origin || !destination) {
      setRouteError("Mapa no disponible: faltan coordenadas del envío.");
      return () => {
        cancelled = true;
      };
    }
    setRouteLoading(true);
    void Promise.all([
      api.route(origin, destination),
      api
        .getShipmentDeliveryEvidence(shipment.id)
        .then((response) => response.evidence)
        .catch((error) => {
          if (!cancelled)
            setEvidenceError(
              error instanceof Error ? error.message : "No pudimos consultar la prueba de entrega.",
            );
          return [];
        }),
    ])
      .then(([routeResponse, shipmentEvidence]) => {
        if (cancelled) return;
        setRoute(routeResponse.route);
        setEvidence(shipmentEvidence);
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
    shipment.id,
    shipment.pickupLocation?.lat,
    shipment.pickupLocation?.lng,
    shipment.destinationLocation?.lat,
    shipment.destinationLocation?.lng,
  ]);

  const hasMap = Boolean(shipment.pickupLocation && shipment.destinationLocation);
  const currentIndex = Math.max(shipmentSteps.indexOf(shipment.status), 0);
  const nextStep = route?.steps[0]?.instruction || null;
  const proofCount = Math.max(evidence.length, shipment.deliveryEvidenceCount || 0);

  const revealDeliveryCode = async () => {
    setCodeBusy(true);
    setActionNotice(null);
    try {
      const response = await api.getShipmentDeliveryCode(shipment.id);
      setDeliveryCode(response.deliveryCode);
    } catch (error) {
      setActionNotice(
        error instanceof Error ? error.message : "No se pudo consultar el PIN de entrega.",
      );
    } finally {
      setCodeBusy(false);
    }
  };

  const shareShipment = async () => {
    const text = `Mi envío Flash está ${shipmentStatusLabel[shipment.status].toLowerCase()}. Destino: ${shipment.destination}. ETA publicada: ${shipment.etaMin} min.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Seguimiento de envío Flash", text });
        setActionNotice("Estado compartido");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setActionNotice("Estado copiado");
      } else {
        setActionNotice("El estado está disponible para compartir");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setActionNotice("No se pudo compartir el estado.");
    }
  };

  return (
    <div className="sheet-backdrop tracking-backdrop" role="presentation">
      <section
        className="item-sheet order-tracking-sheet shipment-tracking-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shipment-tracking-title"
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
            <span className="muted-label">Envío en vivo</span>
            <h2 id="shipment-tracking-title">{shipmentStatusLabel[shipment.status]}</h2>
            <p>
              {shipment.pickup} → {shipment.destination} · ETA publicada {shipment.etaMin} min
            </p>
          </div>
          <button
            className="tracking-share-button"
            type="button"
            onClick={() => void shareShipment()}
          >
            <Copy size={15} /> Compartir estado
          </button>
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
              origin={shipment.pickupLocation!}
              destination={shipment.destinationLocation!}
              route={route?.coordinates || []}
              driver={driver?.location || null}
              routeColor="#087a50"
              ariaLabel="Mapa interactivo de seguimiento del envío"
              caption={
                route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"
              }
              detail={
                driver ? `${driver.name} · ${driver.vehicle}` : "Buscando un repartidor disponible"
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
              <h3>{shipmentStatusLabel[shipment.status]}</h3>
            </div>
            {driver && (
              <div className="tracking-driver-summary">
                <span className="avatar">{initials(driver.name)}</span>
                <span>
                  <strong>{driver.name}</strong>
                  <small>
                    {driver.vehicle} · ★ {driver.rating.toFixed(1)}
                  </small>
                </span>
              </div>
            )}
          </div>
          <div className="stepper tracking-stepper shipment-tracking-stepper">
            {shipmentSteps.map((step, index) => (
              <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                <small>{shipmentStatusLabel[step]}</small>
              </div>
            ))}
          </div>
          {nextStep && shipment.status === "delivering" && (
            <div className="next-route-step">
              <MapPin size={15} /> <span>{nextStep}</span>
            </div>
          )}
        </div>
        <section className="shipment-tracking-summary">
          <div>
            <span className="muted-label">Paquete</span>
            <strong>{shipment.description || "Envío Flash"}</strong>
            <small>
              {shipment.packageSize} · {shipment.weightKg} kg ·{" "}
              {shipment.itemCategory || "standard"}
            </small>
          </div>
          <div>
            <span className="muted-label">Destinatario</span>
            <strong>{shipment.recipientName}</strong>
            <small>{shipment.signatureRequired ? "Firma requerida" : "Entrega con PIN"}</small>
          </div>
          <div>
            <span className="muted-label">Protección</span>
            <strong>{shipment.protection === "standard" ? "Protegido" : "Básica"}</strong>
            <small>
              {money.format(shipment.fare)} · {shipment.distanceKm} km
            </small>
          </div>
        </section>
        {driver &&
          ["driver_assigned", "arriving", "picked_up", "delivering"].includes(shipment.status) && (
            <section className="ride-pin-card shipment-pin-card">
              <div>
                <span className="muted-label">PIN de entrega</span>
                <strong>{deliveryCode || "••••"}</strong>
                <small>
                  Compartilo únicamente con quien recibe el paquete al momento de la entrega.
                </small>
              </div>
              {!deliveryCode && (
                <button type="button" onClick={() => void revealDeliveryCode()} disabled={codeBusy}>
                  <KeyRound size={15} /> {codeBusy ? "Consultando…" : "Mostrar PIN"}
                </button>
              )}
            </section>
          )}
        <section className="shipment-proof-summary">
          <div>
            <span className="muted-label">Prueba de entrega</span>
            <strong>{shipment.deliveryVerifiedAt ? "Verificada" : "Pendiente"}</strong>
          </div>
          <span>
            {proofCount > 0
              ? `${proofCount} evidencia${proofCount === 1 ? "" : "s"} registrada${proofCount === 1 ? "" : "s"}`
              : "Todavía no hay evidencia registrada"}
          </span>
        </section>
        {evidenceError && (
          <small className="tracking-action-notice" role="status">
            {evidenceError}
          </small>
        )}
        {actionNotice && <small className="tracking-action-notice">{actionNotice}</small>}
        <p className="tracking-integrity-note">
          La ruta, el estado, el ETA, la ubicación del repartidor y la prueba de entrega provienen
          del backend autenticado. Si falta una señal o el proveedor de mapas falla, Flash conserva
          el estado operativo sin inventar movimiento.
        </p>
      </section>
    </div>
  );
}
