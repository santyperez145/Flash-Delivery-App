// Tableros overview del backoffice (ARC-001).
//
// Salud del marketplace, investor pulse, funnel, riesgos, zonas y grillas live.
// Salen de AdminConsole porque son presentación del dashboard, no orquestación
// de secciones.

import { Car, RefreshCw, ShoppingBag } from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import { orderStatusLabel, rideStatusLabel } from "../labels";
import type { AdminDashboard, AppState, Order, Ride } from "../types";

export function RealtimeStatus({
  status,
}: {
  status: "connecting" | "live" | "reconnecting" | "offline";
}) {
  const labels = {
    connecting: "Conectando live",
    live: "Realtime activo",
    reconnecting: "Reconectando",
    offline: "Realtime offline",
  } as const;
  return (
    <span className={`realtime-status ${status}`} title="Canal de actualizaciones de la plataforma">
      <span />
      {labels[status]}
    </span>
  );
}

export function MarketplaceHealth({
  state,
  dashboard,
  cancellationCount,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  cancellationCount: number;
}) {
  const rows = [
    [
      "Fill rate delivery",
      dashboard
        ? `${dashboard.marketplace.fillRateDelivery}%`
        : `${state.orders.filter((order) => order.courierId).length}/${state.orders.length}`,
      "Asignacion",
    ],
    [
      "Fill rate taxi",
      dashboard
        ? `${dashboard.marketplace.fillRateRide}%`
        : `${state.rides.filter((ride) => ride.driverId).length}/${state.rides.length}`,
      "Conductores",
    ],
    ["Locales abiertos", `${state.metrics.openRestaurants}/${state.restaurants.length}`, "Supply"],
    ["Cancelaciones", String(cancellationCount), "Riesgo"],
  ];
  return (
    <div className="health-list">
      {rows.map(([label, value, detail]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{detail}</small>
        </div>
      ))}
    </div>
  );
}

// Sin tablero no hay cifras que mostrar: el tablero es lo único que lee el
// ledger. Antes cada tarjeta caía a $0 o 0%, que se lee como «no vendimos nada»
// cuando en realidad la lectura falló. El reintento recarga la consola, igual
// que el botón Refrescar de la barra superior, que es quien vuelve a pedirlo.
export function LedgerUnavailable() {
  return (
    <div role="status">
      <p className="admin-empty">Sin datos del ledger todavía</p>
      <button type="button" onClick={() => window.location.reload()}>
        <RefreshCw size={16} /> Reintentar
      </button>
    </div>
  );
}

// El período de las cifras del tablero: el servidor suma todo lo registrado,
// sin ventana de fechas. Con PostgreSQL son los pagos del ledger; sin él, los
// pedidos y viajes del estado cargado.
export function grossVolumePeriod(dashboard: AdminDashboard) {
  return dashboard.marketplace.financial
    ? "Pagos procesados · acumulado histórico"
    : "Pedidos + viajes · acumulado histórico";
}

export function InvestorPulse({
  dashboard,
  grossVolume,
  platformRevenue,
}: {
  dashboard: AdminDashboard | null;
  grossVolume: number | null;
  platformRevenue: number | null;
}) {
  if (!dashboard) return <LedgerUnavailable />;
  const investor = dashboard.investor;
  const margin = investor.contributionMarginPercent;
  const runway = investor.runwayMonths;
  // Sin el medidor de «readiness»: el puntaje parte de una constante del
  // servidor y no mide nada que se pueda verificar. Tampoco va el párrafo de
  // pitch, que era un texto de venta presentado como lectura del tablero.
  const volume = grossVolume ?? dashboard.marketplace.grossVolume;
  const revenue = platformRevenue ?? dashboard.marketplace.estimatedPlatformRevenue;
  return (
    <div className="investor-summary">
      <div className="investor-stats">
        <span>GMV {money.format(volume)}</span>
        <span>Revenue posteado {money.format(revenue)}</span>
        <span>Runway {runway === null || runway === 0 ? "sin configurar" : `${runway}m`}</span>
        <span>Margen {margin === null ? "sin configurar" : `${margin}%`}</span>
      </div>
      <p className="admin-empty">{grossVolumePeriod(dashboard)}</p>
    </div>
  );
}

export function UnitEconomicsBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  if (!dashboard) return <LedgerUnavailable />;
  const rows = dashboard.investor.unitEconomics;
  return (
    <div className="unit-grid">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </div>
      ))}
    </div>
  );
}

// Sin tablero de hitos: el servidor devuelve una lista fija escrita a mano
// («Realtime dispatch: next», «Pagos reales: next») que no se deriva de nada y
// quedó desactualizada. Una hoja de ruta presentada como estado es un dato
// inventado; el estado real de cada capacidad vive en docs/matriz-madurez.md.

export function GrowthFunnel({
  state,
  dashboard,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
}) {
  const activatedUsers = state.users.filter((user) => user.roles.includes("customer")).length;
  const totalJobs = state.orders.length + state.rides.length;
  const completedJobs =
    state.orders.filter((order) => order.status === "delivered").length +
    state.rides.filter((ride) => ride.status === "completed").length;
  // El ancho de cada barra es proporcional a su valor. Antes bajaba 9 puntos
  // por fila sin importar el número, así que un embudo vacío se veía lleno.
  // Los conteos se miden contra el mayor de ellos; las tasas, contra 100 %.
  const largestCount = Math.max(state.users.length, activatedUsers, totalJobs, completedJobs);
  const countShare = (value: number) => (largestCount ? (value / largestCount) * 100 : 0);
  const fillDelivery = dashboard?.marketplace.fillRateDelivery ?? null;
  const fillRide = dashboard?.marketplace.fillRateRide ?? null;
  const funnel = [
    {
      label: "Usuarios",
      value: String(state.users.length),
      width: countShare(state.users.length),
      detail: "Cuentas registradas",
    },
    {
      label: "Activados",
      value: String(activatedUsers),
      width: countShare(activatedUsers),
      detail: "Con rol de cliente",
    },
    {
      label: "Jobs",
      value: String(totalJobs),
      width: countShare(totalJobs),
      detail: "Pedidos + viajes",
    },
    {
      label: "Cumplidos",
      value: String(completedJobs),
      width: countShare(completedJobs),
      detail: "Conversión operativa",
    },
    // Las tasas de asignación sólo las calcula el tablero: sin él, «—».
    {
      label: "Fill delivery",
      value: fillDelivery === null ? "—" : `${fillDelivery}%`,
      width: fillDelivery ?? 0,
      detail: "Asignación",
    },
    {
      label: "Fill taxi",
      value: fillRide === null ? "—" : `${fillRide}%`,
      width: fillRide ?? 0,
      detail: "Asignación",
    },
  ];
  return (
    <div className="funnel-list">
      {funnel.map((row) => (
        <article key={row.label}>
          <div style={{ width: `${Math.min(100, Math.max(0, row.width))}%` }} />
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </article>
      ))}
    </div>
  );
}

export function RiskSignalBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  if (!dashboard) return <LedgerUnavailable />;
  const risks = dashboard.riskSignals;
  return (
    <div className="risk-list">
      {risks.map((risk) => (
        <article className={risk.level} key={risk.id}>
          <strong>{risk.label}</strong>
          <span>{risk.value}</span>
          <small>
            {risk.level === "low"
              ? "Controlado"
              : risk.level === "medium"
                ? "Monitorear"
                : "Acción inmediata"}
          </small>
        </article>
      ))}
    </div>
  );
}

export function ZoneBoard({ state }: { state: AppState }) {
  return (
    <div className="zone-board">
      {state.zones?.map((zone) => (
        <article className={zone.demandLevel === "high" ? "hot" : ""} key={zone.id}>
          <strong>{zone.name}</strong>
          <span>{zone.demandLevel}</span>
          <small>
            {zone.activeOrders} pedidos · {zone.activeRides} viajes
          </small>
        </article>
      ))}
    </div>
  );
}

export function AdminLiveGrid({
  state,
  orders,
  rides,
  busy,
  runAction,
}: {
  state: AppState;
  orders: Order[];
  rides: Ride[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  return (
    <div className="admin-live-grid">
      <div className="admin-table">
        {orders.map((order) => {
          const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
          const driver = state.drivers.find((entry) => entry.id === order.courierId);
          return (
            <article className="admin-row compact" key={order.id}>
              <ShoppingBag size={18} />
              <div>
                <strong>{restaurant?.name || order.id}</strong>
                <span>
                  {orderStatusLabel[order.status]} · {order.deliveryAddress}
                </span>
              </div>
              <b>{money.format(order.total)}</b>
              <small>{driver?.name || "Sin repartidor"}</small>
              <button
                type="button"
                disabled={
                  busy || ["ready_for_pickup", "delivered", "cancelled"].includes(order.status)
                }
                onClick={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
      <div className="admin-table">
        {rides.map((ride) => {
          const driver = state.drivers.find((entry) => entry.id === ride.driverId);
          return (
            <article className="admin-row compact" key={ride.id}>
              <Car size={18} />
              <div>
                <strong>{ride.pickup}</strong>
                <span>
                  {rideStatusLabel[ride.status]} → {ride.destination}
                </span>
              </div>
              <b>{money.format(ride.fare)}</b>
              <small>{driver?.name || "Sin conductor"}</small>
              <button
                type="button"
                disabled={busy || ["requested", "completed", "cancelled"].includes(ride.status)}
                onClick={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
