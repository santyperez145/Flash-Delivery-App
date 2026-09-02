// Primitivas compartidas de las consolas compactas (ARC-001).
//
// Uber/DoorDash no mezclan comercio, conductor y ops en un solo módulo; sí
// comparten cards. Flash deja aquí oferta, métrica, mini-pedido y avance de
// viaje. Ninguna primitiva decide autorización ni reconstruye ventas.
import { Car } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { money } from "../format";
import { orderStatusLabel, rideStatusLabel } from "../labels";
import type { AppState, DispatchOffer, Driver, Order, Ride } from "../types";

export function describirOferta(oferta: DispatchOffer, ahora: number) {
  const aceptacion = oferta.scoreBreakdown
    ? ` · ${Math.round(oferta.scoreBreakdown.acceptanceRate * 100)}% aceptación`
    : "";
  const restanS = Math.max(0, Math.ceil((new Date(oferta.expiresAt).getTime() - ahora) / 1000));
  return `${oferta.distanceKm} km · ${oferta.durationMin} min${aceptacion} · vence en ${restanS}s`;
}

export function PanelHeader({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return (
    <header className="panel-header">
      <span>
        <Icon size={18} />
      </span>
      <div>
        <p className="eyebrow">Panel</p>
        <h2>{title}</h2>
      </div>
    </header>
  );
}

export function RideOpsCard({
  ride,
  driver,
  onAdvance,
  busy,
}: {
  ride: Ride;
  driver?: Driver;
  onAdvance: () => void;
  busy: boolean;
}) {
  const canAdvance = !["requested", "completed", "cancelled"].includes(ride.status);
  return (
    <article className="work-card">
      <div className="work-card-top">
        <span>{ride.id}</span>
        <strong>{rideStatusLabel[ride.status]}</strong>
      </div>
      <h3>{ride.pickup}</h3>
      <p>{ride.destination}</p>
      <div className="work-meta">
        <span>{money.format(ride.fare)}</span>
        <span>{driver?.name || "Sin conductor"}</span>
      </div>
      {canAdvance && (
        <button type="button" onClick={onAdvance} disabled={busy}>
          <Car size={15} /> Avanzar
        </button>
      )}
    </article>
  );
}

export function OfferCard({
  icon: Icon,
  title,
  subtitle,
  amount,
  action,
  secondaryAction,
  onAction,
  onSecondaryAction,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  amount: number;
  action: string;
  secondaryAction?: string;
  onAction: () => void;
  onSecondaryAction?: () => void;
  busy: boolean;
}) {
  return (
    <article className="offer-card">
      <span className="offer-icon">
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <b>{money.format(amount)}</b>
      </div>
      <div className="offer-card-actions">
        {secondaryAction && (
          <button className="secondary" type="button" onClick={onSecondaryAction} disabled={busy}>
            {secondaryAction}
          </button>
        )}
        <button type="button" onClick={onAction} disabled={busy}>
          {action}
        </button>
      </div>
    </article>
  );
}

export function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

export function MiniOrder({ state, order }: { state: AppState; order: Order }) {
  const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
  return (
    <article className="ops-card">
      <span>{order.id}</span>
      <strong>
        {restaurant?.name} · {orderStatusLabel[order.status]}
      </strong>
      <p>
        {money.format(order.total)} · {order.items.length} items
      </p>
    </article>
  );
}

export function MiniRide({ state, ride }: { state: AppState; ride: Ride }) {
  const driver = state.drivers.find((entry) => entry.id === ride.driverId);
  return (
    <article className="ops-card">
      <span>{ride.id}</span>
      <strong>
        {rideStatusLabel[ride.status]} · {driver?.name || "Sin conductor"}
      </strong>
      <p>
        {money.format(ride.fare)} · {ride.distanceKm} km
      </p>
    </article>
  );
}
