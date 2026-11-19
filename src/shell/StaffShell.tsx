// El marco de staff de la web (RES-06): panel de marca con métricas de la
// operación, barra de estado del teléfono y selector de perfiles.
//
// Es la herramienta de quien opera Flash con varios roles. Una cuenta que sólo
// pide no lo ve: para ella Flash es un sitio, como cualquier app de la competencia,
// y las métricas de la plataforma no son datos que le correspondan. Vive aparte de
// `App.tsx` porque ese archivo es un monolito de H-08.
import { useEffect, useState } from "react";
import { Bike, Flame, LogIn, ShieldCheck, Store, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { AppState, Mode, User } from "../types";
import { Metric } from "../ui/panels";

const demandLabel: Record<AppState["zones"][number]["demandLevel"], string> = {
  low: "Demanda baja",
  medium: "Demanda media",
  high: "Demanda alta",
};

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
      {/* Antes era un «mapa» con una grilla y tres pines fijos que no
          representaban nada: parecía tracking en vivo y no lo era. Lo que la
          plataforma sí sabe de cada zona es su nombre, su demanda y cuánto
          tiene activo, así que eso es lo que se muestra, como lista. */}
      {state.zones.length > 0 ? (
        <ul className="dispatch-map" aria-label="Zonas">
          {state.zones.slice(0, 3).map((zone) => (
            <li className="zone" key={zone.id}>
              <strong>{zone.name}</strong>
              <span>
                {demandLabel[zone.demandLevel]} · {zone.activeOrders + zone.activeRides} activos
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dispatch-map dispatch-map-empty">Sin zonas configuradas todavía</p>
      )}
    </aside>
  );
}
