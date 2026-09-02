// Consola compacta de operaciones (ARC-001).
//
// Uber Ops concentra command center, riesgo y audiencia realtime fuera del
// comercio. Flash deja pedidos/viajes en vivo y SEC-001 aquí.
import { useEffect, useState } from "react";
import { LineChart, ShieldAlert, ShieldCheck } from "lucide-react";

import { api } from "../api";
import type { AppState, RealtimeAudienceHealth } from "../types";
import { OrderOpsCard, SectionTitle, TopBar } from "../ui/panels";
import { MetricCard, RideOpsCard } from "./ops-primitives";

export function OpsApp({
  state,
  busy,
  runAction,
}: {
  state: AppState;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const activeOrders = state.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
  return (
    <div className="screen">
      <TopBar title="Operaciones" actionIcon={LineChart} />
      <div className="ops-grid">
        <MetricCard label="Pedidos" value={state.metrics.activeOrders} tone="orange" />
        <MetricCard label="Viajes" value={state.metrics.activeRides} tone="teal" />
        <MetricCard label="Drivers" value={state.metrics.onlineDrivers} tone="green" />
        <MetricCard label="Tickets" value={state.metrics.openTickets} tone="dark" />
      </div>
      <OpsRiskBoard state={state} />
      <RealtimeAudiencePanel />
      <section className="control-map">
        {state.zones.slice(0, 3).map((zone, index) => (
          <div className={`zone zone-${["one", "two", "three"][index]}`} key={zone.id}>
            {zone.name} · {zone.activeOrders + zone.activeRides} activos
          </div>
        ))}
        <span className="pin pin-a" />
        <span className="pin pin-b" />
        <span className="pin pin-c" />
      </section>
      <SectionTitle title="Pedidos en vivo" />
      <div className="activity-stack">
        {activeOrders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={state.restaurants.find((entry) => entry.id === order.restaurantId)}
            driver={state.drivers.find((entry) => entry.id === order.courierId)}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
            busy={busy}
          />
        ))}
      </div>
      <SectionTitle title="Viajes en vivo" />
      <div className="activity-stack">
        {activeRides.map((ride) => (
          <RideOpsCard
            key={ride.id}
            ride={ride}
            driver={state.drivers.find((entry) => entry.id === ride.driverId)}
            onAdvance={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
            busy={busy}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Salud de la clasificación de audiencias realtime (SEC-001).
 *
 * La métrica Prometheus ya existía y ya alertaba, pero es un contador en
 * memoria: por réplica y borrado en cada reinicio. Servía para saber que estaba
 * pasando algo y no para saber **qué**. Este panel lee el desenlace que desde la
 * migración 120 viaja con el evento, así que puede nombrar los eventos sin
 * clasificar en lugar de contarlos.
 *
 * Cuando no hay ninguno el panel se calla. Un tablero que muestra un cero
 * permanente enseña a no mirarlo, y este tiene que llamar la atención el día que
 * deje de ser cero.
 */
function RealtimeAudiencePanel() {
  const [salud, setSalud] = useState<RealtimeAudienceHealth | null>(null);
  const [sinSoporte, setSinSoporte] = useState(false);

  useEffect(() => {
    let vigente = true;
    api
      .getRealtimeAudienceHealth(24)
      .then((datos) => {
        if (vigente) setSalud(datos);
      })
      .catch(() => {
        // El respaldo SQLite no lleva log de eventos y responde 503. No es un
        // error que operaciones deba resolver: es una capacidad ausente, y
        // decirlo es más honesto que dibujar ceros.
        if (vigente) setSinSoporte(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (sinSoporte) {
    return (
      <section className="ops-audience ops-audience-idle">
        <ShieldAlert size={16} aria-hidden />
        <span>Clasificación de audiencias sin registro: requiere PostgreSQL.</span>
      </section>
    );
  }
  if (!salud) return null;
  if (salud.unclassified.total === 0) {
    return (
      <section className="ops-audience ops-audience-idle">
        <ShieldCheck size={16} aria-hidden />
        <span>
          Sin eventos mal clasificados en {salud.windowHours} h · {salud.total} publicados
        </span>
      </section>
    );
  }
  return (
    <section className="ops-audience ops-audience-alert">
      <header>
        <ShieldAlert size={16} aria-hidden />
        <strong>
          {salud.unclassified.total} evento(s) sin clasificar en {salud.windowHours} h
        </strong>
      </header>
      <p>
        Un evento sin clasificar sólo llega a operaciones. No se filtró nada, pero quien debía
        recibirlo no lo recibió.
      </p>
      <ul>
        {salud.unclassified.byEntityType.map((fila) => (
          <li key={fila.entityType}>
            <code>{fila.entityType}</code> · {fila.total}
          </li>
        ))}
      </ul>
      <details>
        <summary>Ver los últimos {salud.unclassified.recent.length}</summary>
        <ul>
          {salud.unclassified.recent.map((evento) => (
            <li key={evento.id}>
              <code>{evento.id}</code> · {evento.type}
              {evento.entityType ? ` · ${evento.entityType}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function OpsRiskBoard({ state }: { state: AppState }) {
  const unassignedOrders = state.orders.filter(
    (order) => !order.courierId && !["delivered", "cancelled"].includes(order.status),
  ).length;
  const unassignedRides = state.rides.filter(
    (ride) => !ride.driverId && !["completed", "cancelled"].includes(ride.status),
  ).length;
  const risks = [
    ["Backlog", unassignedOrders + unassignedRides, "Asignaciones pendientes"],
    ["Supply", state.metrics.onlineDrivers, "Drivers online"],
    ["SLA", state.metrics.avgOrderEta + state.metrics.avgRideEta, "Minutos combinados"],
  ] as const;
  return (
    <section className="ops-risk-board">
      {risks.map(([label, value, detail]) => (
        <article key={label}>
          <strong>{label}</strong>
          <span>{value}</span>
          <small>{detail}</small>
        </article>
      ))}
    </section>
  );
}
