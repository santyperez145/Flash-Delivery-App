import { lazy, Suspense, useEffect, useState } from "react";
import { Check, Copy, MapPin, X } from "lucide-react";

import { api } from "../api";
import { initials } from "../format";
import { orderStatusLabel, orderSteps, pickupOrderSteps } from "../labels";
import { OrderDeliveryCodeView } from "./OrderDeliveryCode";
import type { Driver, Order, RoadRoute } from "../types";

const FlashMap = lazy(() => import("../maps/FlashMap"));

export function OrderTrackingSheet({
  order,
  driver,
  onClose,
}: {
  order: Order;
  driver: Driver | null;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [shareLabel, setShareLabel] = useState("Compartir estado");

  useEffect(() => {
    let cancelled = false;
    const origin = order.fulfillment === "pickup" ? null : order.pickupLocation; // retiro: no hay ruta
    const destination = order.deliveryLocation;
    setRoute(null);
    setRouteError(null);
    if (!origin || !destination) {
      setRouteError("Mapa no disponible: faltan coordenadas del pedido.");
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
    order.id,
    order.pickupLocation?.lat,
    order.pickupLocation?.lng,
    order.deliveryLocation?.lat,
    order.deliveryLocation?.lng,
  ]);

  const esRetiro = order.fulfillment === "pickup";
  const steps = esRetiro ? pickupOrderSteps : orderSteps;
  const hasMap = !esRetiro && Boolean(order.pickupLocation && order.deliveryLocation);
  const currentIndex = Math.max(steps.indexOf(order.status), 0);
  const share = async () => {
    const text = `Mi pedido ${order.id} está ${orderStatusLabel[order.status].toLowerCase()}. ETA publicada: ${order.etaMin} min.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Seguimiento Flash", text });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setShareLabel("Estado copiado");
        window.setTimeout(() => setShareLabel("Compartir estado"), 2200);
      } else {
        setShareLabel("Compartir no disponible");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setShareLabel("No se pudo compartir");
    }
  };

  return (
    <div className="sheet-backdrop tracking-backdrop" role="presentation">
      <section
        className="item-sheet order-tracking-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-tracking-title"
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
            <span className="muted-label">Seguimiento en vivo</span>
            <h2 id="order-tracking-title">Pedido {order.id}</h2>
            <p>
              {orderStatusLabel[order.status]} · ETA publicada {order.etaMin} min
            </p>
          </div>
          <button className="tracking-share-button" type="button" onClick={() => void share()}>
            <Copy size={15} /> {shareLabel}
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
              origin={order.pickupLocation!}
              destination={order.deliveryLocation!}
              route={route?.coordinates || []}
              driver={driver?.location || null}
              routeColor="#f4511e"
              ariaLabel="Mapa interactivo de seguimiento del pedido"
              caption={
                route
                  ? `${route.distanceKm} km · ${route.durationMin} min de recorrido`
                  : routeLoading
                    ? "Calculando ruta real…"
                    : routeError || "Ruta vial no disponible"
              }
              detail={
                driver ? `${driver.name} · ${driver.vehicle}` : "Buscando repartidor disponible"
              }
            />
          </Suspense>
        ) : (
          <div className="tracking-map-empty">
            <MapPin size={20} />
            <strong>
              {esRetiro ? "Retirás en el local" : "El mapa se activará al recibir coordenadas"}
            </strong>
            <span>{esRetiro ? order.deliveryAddress : routeError}</span>
          </div>
        )}
        <OrderDeliveryCodeView order={order} />
        <div className="tracking-status-panel">
          <div className="tracking-status-copy">
            <div>
              <span className="muted-label">Estado actual</span>
              <h3>{orderStatusLabel[order.status]}</h3>
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
          <div className="stepper tracking-stepper">
            {steps.map((step, index) => (
              <div className={index <= currentIndex ? "step active" : "step"} key={step}>
                <span>{index < currentIndex ? <Check size={12} /> : index + 1}</span>
                <small>{orderStatusLabel[step]}</small>
              </div>
            ))}
          </div>
        </div>
        <p className="tracking-integrity-note">
          {esRetiro
            ? "No hay repartidor: el local te lo entrega en el mostrador contra el número de pedido."
            : "La ubicación del repartidor aparece cuando su teléfono envía una posición. Si se pierde la señal o el mapa, el estado y la hora estimada siguen a la vista."}
        </p>
      </section>
    </div>
  );
}
