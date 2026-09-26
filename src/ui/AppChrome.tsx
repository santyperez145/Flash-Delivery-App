// Chrome del phone-stage web (ARC-001).
//
// Reloj, banner de red, selector de audiencia y panel de marca. Uber y DoorDash
// mantienen ese marco fuera de la sesión de comercio; App.tsx sólo lo monta.

import { useEffect, useState } from "react";
import {
  Bike,
  Flame,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Store,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Metric } from "./panels";
import type { AppState, Mode, User } from "../types";

export function PhoneStatus({ online }: { online: boolean }) {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="phone-status" aria-hidden="true">
      <span>
        {time.toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      <span className="dynamic-island" />
      <span>{online ? "Live" : "Offline"}</span>
    </div>
  );
}

export function NetworkStatusBanner({
  online,
  realtimeStatus,
  onRetry,
}: {
  online: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  onRetry: () => void;
}) {
  const realtimeDegraded =
    online && (realtimeStatus === "connecting" || realtimeStatus === "reconnecting");
  if (online && !realtimeDegraded) return null;
  const isOffline = !online;
  return (
    <div
      className={`network-status-banner ${isOffline ? "offline" : "reconnecting"}`}
      role="status"
      aria-live="polite"
    >
      <span className="network-status-icon">
        {isOffline ? <TriangleAlert size={16} /> : <RefreshCw size={16} />}
      </span>
      <span>
        <strong>{isOffline ? "Sin conexión" : "Actualizando Flash"}</strong>
        <small>
          {isOffline
            ? "Las acciones nuevas esperan hasta recuperar internet."
            : "El estado en vivo se está reconectando."}
        </small>
      </span>
      <button type="button" onClick={onRetry} disabled={isOffline}>
        <RefreshCw size={14} /> Reintentar
      </button>
    </div>
  );
}

export function AppModeBar({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}) {
  const modes: Array<{ id: Mode; label: string; icon: LucideIcon }> = [
    { id: "customer", label: "Cliente", icon: UserRound },
    { id: "merchant", label: "Local", icon: Store },
    { id: "driver", label: "Driver", icon: Bike },
    { id: "ops", label: "Ops", icon: ShieldCheck },
  ];
  return (
    <div className="app-mode-bar" role="tablist" aria-label="Apps">
      {modes.map(({ id, label, icon: Icon }) => (
        <button
          className={mode === id ? "mode-tab active" : "mode-tab"}
          key={id}
          onClick={() => onModeChange(id)}
          type="button"
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function BrandPanel({
  state,
  mode,
  onModeChange,
  user,
}: {
  state: AppState;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  user: User | null;
}) {
  return (
    <aside className="brand-panel">
      <div className="brand-block">
        <div className="brand-mark">
          <Flame size={24} />
        </div>
        <div>
          <p className="eyebrow">Flash Platform</p>
          <h1>Comida, viajes y reparto en una sola operacion</h1>
        </div>
      </div>
      <div className="desktop-mode-grid">
        <AppModeBar mode={mode} onModeChange={onModeChange} />
      </div>
      <div className="session-card">
        <LogIn size={17} />
        <div>
          <span>Sesión autenticada</span>
          <strong>{user?.email}</strong>
        </div>
      </div>
      <div className="market-strip">
        <Metric
          label="Pedidos activos"
          value={String(state.metrics.activeOrders)}
          trend={`${state.metrics.avgOrderEta}m ETA`}
        />
        <Metric
          label="Viajes activos"
          value={String(state.metrics.activeRides)}
          trend={`${state.metrics.avgRideEta}m espera`}
        />
        <Metric
          label="Drivers online"
          value={String(state.metrics.onlineDrivers)}
          trend={`${state.metrics.openRestaurants} locales`}
        />
      </div>
      <div className="dispatch-map">
        {state.zones.slice(0, 3).map((zone, index) => (
          <div className={`zone zone-${["one", "two", "three"][index]}`} key={zone.id}>
            {zone.name} · {zone.demandLevel}
          </div>
        ))}
        <span className="pin pin-a" />
        <span className="pin pin-b" />
        <span className="pin pin-c" />
      </div>
    </aside>
  );
}
