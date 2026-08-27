// Superficies operativas en la web (ticket ARC-001, paso 16).
//
// Cuarto y último corte de `src/App.tsx`. Se lleva las tres consolas móviles
// —comercio, conductor y operaciones— con el riel de navegación que comparten y
// las seis tarjetas que sólo ellas usan.
//
// Las tres viven juntas y no en un archivo cada una porque **comparten el riel,
// las tarjetas y la forma**: son la misma consola vista por tres roles. Separar
// `MerchantApp` de `DriverApp` obligaría a un quinto módulo sólo para lo común,
// sin que ninguna de las dos quede más legible.
//
// `Metric` iba en sentido contrario: la usa también el panel de marca del shell,
// así que salió a [`../ui/panels.tsx`](../ui/panels.tsx). Era la última primitiva
// compartida entre el entrypoint y una superficie.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bike,
  Car,
  LineChart,
  LocateFixed,
  PackageCheck,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "../api";
import type { RealtimeAudienceHealth } from "../types";
import { initials, money } from "../format";
import { orderStatusLabel, rideStatusLabel } from "../labels";
import { Metric, OrderOpsCard, SectionTitle, TopBar } from "../ui/panels";
import type {
  AppState,
  DispatchOffer,
  Driver,
  Mode,
  Order,
  Restaurant,
  Ride,
  User,
} from "../types";

/**
 * El subtítulo de una oferta de dispatch: distancia, duración, tasa de
 * aceptación del conductor y cuánto le queda para vencer.
 *
 * La tasa de aceptación aparece **sólo si el scoring la calculó**. Mostrar 0%
 * cuando el dato falta diría algo falso sobre el conductor.
 *
 * El vencimiento se acota en cero: una oferta vencida muestra «0s», no un
 * número negativo que sugiera tiempo restante.
 */
function describirOferta(oferta: DispatchOffer, ahora: number) {
  const aceptacion = oferta.scoreBreakdown
    ? ` · ${Math.round(oferta.scoreBreakdown.acceptanceRate * 100)}% aceptación`
    : "";
  const restanS = Math.max(0, Math.ceil((new Date(oferta.expiresAt).getTime() - ahora) / 1000));
  return `${oferta.distanceKm} km · ${oferta.durationMin} min${aceptacion} · vence en ${restanS}s`;
}

export function MerchantApp({
  state,
  restaurant,
  newDish,
  setNewDish,
  busy,
  runAction,
}: {
  state: AppState;
  restaurant: Restaurant;
  newDish: {
    name: string;
    description: string;
    category: string;
    price: number;
  };
  setNewDish: React.Dispatch<
    React.SetStateAction<{
      name: string;
      description: string;
      category: string;
      price: number;
    }>
  >;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const orders = state.orders.filter((order) => order.restaurantId === restaurant.id);
  const activeOrders = orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const soldOutItems = restaurant.menu.filter((item) => !item.stock).length;
  const todayRevenue = orders.reduce((sum, order) => sum + order.total, 0);
  return (
    <div className="screen">
      <TopBar title="Comercio" actionIcon={Store} />
      <section className="merchant-hero">
        <img src={restaurant.cover} alt={restaurant.name} />
        <div>
          <span>{restaurant.open ? "Abierto" : "Pausado"}</span>
          <h2>{restaurant.name}</h2>
          <p>{restaurant.address}</p>
        </div>
      </section>
      <label className="toggle-row light">
        <span>
          <strong>Aceptar pedidos</strong>
          <small>{restaurant.open ? "Online" : "Pausado"}</small>
        </span>
        <input
          checked={restaurant.open}
          onChange={(event) =>
            runAction(
              () =>
                api.updateRestaurant(restaurant.id, {
                  open: event.target.checked,
                }),
              event.target.checked ? "Local abierto" : "Local pausado",
            )
          }
          type="checkbox"
          disabled={busy}
        />
      </label>
      <div className="merchant-command">
        <MetricCard label="Venta" value={todayRevenue} tone="orange" />
        <MetricCard label="Activos" value={activeOrders.length} tone="teal" />
        <MetricCard label="ETA" value={restaurant.etaMin} tone="green" />
        <MetricCard label="Sin stock" value={soldOutItems} tone="dark" />
      </div>
      <section className="prep-control">
        <div>
          <strong>Control de cocina</strong>
          <span>Ajusta ETA en vivo para proteger SLA y evitar cancelaciones.</span>
        </div>
        <div className="prep-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    etaMin: Math.max(5, restaurant.etaMin - 5),
                  }),
                "ETA reducida",
              )
            }
          >
            -5m
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.updateRestaurant(restaurant.id, {
                    etaMin: restaurant.etaMin + 5,
                  }),
                "ETA ampliada",
              )
            }
          >
            +5m
          </button>
        </div>
      </section>
      <SectionTitle title="Cocina" action={`${orders.length} pedidos`} />
      <div className="activity-stack">
        {orders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={restaurant}
            driver={state.drivers.find((entry) => entry.id === order.courierId)}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
            busy={busy}
          />
        ))}
      </div>
      <SectionTitle title="Menu" action="Stock" />
      <div className="menu-admin">
        {restaurant.menu.map((item) => (
          <label className="stock-row" key={item.id}>
            <img src={item.image} alt={item.name} />
            <span>
              <strong>{item.name}</strong>
              <small>{money.format(item.price)}</small>
            </span>
            <input
              checked={item.stock}
              onChange={(event) =>
                runAction(
                  () => api.updateMenuStock(restaurant.id, item.id, event.target.checked),
                  "Stock actualizado",
                )
              }
              type="checkbox"
              disabled={busy}
            />
          </label>
        ))}
      </div>
      <section className="new-dish">
        <h2>Alta rapida</h2>
        <input
          value={newDish.name}
          onChange={(event) => setNewDish((current) => ({ ...current, name: event.target.value }))}
        />
        <input
          value={newDish.description}
          onChange={(event) =>
            setNewDish((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
        />
        <div className="two-fields">
          <input
            value={newDish.category}
            onChange={(event) =>
              setNewDish((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
          />
          <input
            value={newDish.price}
            onChange={(event) =>
              setNewDish((current) => ({
                ...current,
                price: Number(event.target.value),
              }))
            }
            type="number"
          />
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() =>
            runAction(() => api.addMenuItem(restaurant.id, newDish), "Producto creado")
          }
        >
          <Plus size={17} /> Agregar plato
        </button>
      </section>
    </div>
  );
}

export function DriverApp({
  state,
  driver,
  user,
  busy,
  runAction,
}: {
  state: AppState;
  driver: Driver;
  user: User | null;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const lastLocationSentAt = useRef(0);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "locating" | "live" | "denied">("idle");
  const [offers, setOffers] = useState<DispatchOffer[]>([]);
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const loadOffers = useCallback(async () => {
    if (!driver.online) {
      setOffers([]);
      return;
    }
    setOffersLoading(true);
    try {
      setOffers((await api.getDriverOffers()).offers);
    } catch (_error) {
      setOffers([]);
    } finally {
      setOffersLoading(false);
    }
  }, [driver.online]);
  useEffect(() => {
    void loadOffers();
    const poll = window.setInterval(() => void loadOffers(), 5000),
      ticker = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(ticker);
    };
  }, [loadOffers]);

  useEffect(() => {
    if (!driver.online) {
      setGpsStatus("idle");
      return;
    }
    if (!navigator.geolocation) {
      setGpsStatus("denied");
      return;
    }
    setGpsStatus("locating");
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const now = Date.now();
        if (now - lastLocationSentAt.current < 12000) return;
        lastLocationSentAt.current = now;
        api
          .updateDriverLocation(driver.id, {
            lat: coords.latitude,
            lng: coords.longitude,
            label: "Ubicacion GPS",
          })
          .then(() => setGpsStatus("live"))
          .catch(() => setGpsStatus("denied"));
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [driver.id, driver.online]);

  const activeOrders = state.orders.filter(
    (order) => order.courierId === driver.id && !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => ride.driverId === driver.id && !["completed", "cancelled"].includes(ride.status),
  );
  const hotZone = state.zones.find((zone) => zone.demandLevel === "high") || state.zones[0];
  const visibleOffers = offers.filter((offer) =>
    driver.activeService === "ride" ? offer.kind === "ride" : offer.kind === "delivery",
  );
  return (
    <div className="screen">
      <TopBar title="Driver" actionIcon={Bike} />
      <section className="driver-card">
        <div className="avatar large">{initials(driver.name)}</div>
        <div>
          <span>
            {driver.vehicle} · {driver.plate}
          </span>
          <h2>{driver.name}</h2>
          <p>
            {driver.location.label} · rating {driver.rating}
          </p>
          <small className={`driver-gps-status ${gpsStatus}`}>
            {gpsStatus === "live"
              ? "GPS activo"
              : gpsStatus === "locating"
                ? "Conectando GPS"
                : gpsStatus === "denied"
                  ? "GPS no disponible"
                  : "GPS pausado"}
          </small>
        </div>
      </section>
      <label className="toggle-row light">
        <span>
          <strong>Disponible</strong>
          <small>{driver.online ? "Recibiendo viajes y deliveries" : "Fuera de linea"}</small>
        </span>
        <input
          checked={driver.online}
          onChange={(event) =>
            runAction(
              () => api.updateDriver(driver.id, { online: event.target.checked }),
              event.target.checked ? "Driver online" : "Driver offline",
            )
          }
          type="checkbox"
          disabled={busy}
        />
      </label>
      <div className="service-toggle compact-toggle">
        {driver.serviceModes.map((mode) => (
          <button
            className={driver.activeService === mode ? "active" : ""}
            key={mode}
            type="button"
            onClick={() =>
              runAction(
                () => api.updateDriver(driver.id, { activeService: mode }),
                "Modo actualizado",
              )
            }
            disabled={busy}
          >
            {mode === "delivery" ? <ShoppingBag size={16} /> : <Car size={16} />}
            {mode === "delivery" ? "Delivery" : "Taxi"}
          </button>
        ))}
      </div>
      <section className="driver-mission">
        <div>
          <span>Demanda actual</span>
          <strong>{hotZone?.name || "Zona sin datos"}</strong>
          <small>
            {hotZone
              ? `${hotZone.activeOrders} pedidos y ${hotZone.activeRides} viajes activos`
              : "Sin zona disponible"}
          </small>
        </div>
        <b>{money.format(driver.earningsToday)}</b>
      </section>
      <div className="driver-ops-grid">
        <article>
          <LocateFixed size={16} />
          <strong>{visibleOffers.length}</strong>
          <span>Ofertas</span>
        </article>
        <article>
          <ShieldCheck size={16} />
          <strong>{driver.rating}</strong>
          <span>Rating</span>
        </article>
        <article>
          <WalletCards size={16} />
          <strong>{money.format(user?.wallet || 0)}</strong>
          <span>Saldo Flash</span>
        </article>
      </div>

      <SectionTitle title="Activos" action={money.format(driver.earningsToday)} />
      <div className="activity-stack">
        {activeOrders.map((order) => (
          <OrderOpsCard
            key={order.id}
            order={order}
            restaurant={state.restaurants.find((entry) => entry.id === order.restaurantId)}
            driver={driver}
            onAdvance={() => runAction(() => api.advanceOrder(order.id), "Delivery avanzado")}
            busy={busy}
          />
        ))}
        {activeRides.map((ride) => (
          <RideOpsCard
            key={ride.id}
            ride={ride}
            driver={driver}
            onAdvance={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
            busy={busy}
          />
        ))}
      </div>

      <SectionTitle
        title="Ofertas privadas"
        action={offersLoading ? "Actualizando…" : `${visibleOffers.length}`}
      />
      <div className="activity-stack">
        {visibleOffers.map((offer) => (
          <OfferCard
            key={offer.id}
            icon={
              offer.kind === "ride"
                ? Car
                : offer.subtype === "shipment"
                  ? PackageCheck
                  : ShoppingBag
            }
            title={`${offer.pickup} → ${offer.destination}`}
            subtitle={describirOferta(offer, clock)}
            amount={offer.fare}
            action="Aceptar"
            secondaryAction="Rechazar"
            onSecondaryAction={async () => {
              setOfferBusy(offer.id);
              await runAction(() => api.rejectDriverOffer(offer.id), "Oferta rechazada");
              await loadOffers();
              setOfferBusy(null);
            }}
            onAction={async () => {
              setOfferBusy(offer.id);
              const action =
                offer.kind === "ride"
                  ? () => api.acceptRide(offer.jobId, driver.id)
                  : offer.subtype === "shipment"
                    ? () => api.acceptShipment(offer.jobId, driver.id)
                    : () => api.acceptDelivery(offer.jobId, driver.id);
              await runAction(action, "Servicio aceptado");
              await loadOffers();
              setOfferBusy(null);
            }}
            busy={busy || offerBusy === offer.id}
          />
        ))}
        {!offersLoading && !visibleOffers.length && (
          <p>
            {driver.online
              ? "No hay ofertas vigentes para este modo."
              : "Actívate para recibir ofertas."}
          </p>
        )}
      </div>
    </div>
  );
}

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

export function OpsRail({
  mode,
  state,
  user,
  cartCount,
  cartTotal,
  busy,
  runAction,
}: {
  mode: Mode;
  state: AppState;
  user: User | null;
  cartCount: number;
  cartTotal: number;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const driver = state.drivers.find((entry) => entry.userId === user?.id);
  const merchantRestaurantId = user?.restaurantId || state.restaurants[0]?.id;
  const activeOrder = state.orders.find(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRide = state.rides.find((ride) => !["completed", "cancelled"].includes(ride.status));
  return (
    <aside className="ops-panel">
      <PanelHeader
        title={
          mode === "customer"
            ? "Cliente"
            : mode === "merchant"
              ? "Comercio"
              : mode === "driver"
                ? "Driver"
                : "Ops"
        }
        icon={
          mode === "customer"
            ? UserRound
            : mode === "merchant"
              ? Store
              : mode === "driver"
                ? Bike
                : ShieldCheck
        }
      />
      {mode === "customer" && (
        <>
          <div className="ops-card highlight">
            <span>Carrito actual</span>
            <strong>{cartCount} items</strong>
            <p>{cartCount ? money.format(cartTotal) : "Listo para pedir comida o taxi"}</p>
          </div>
          {activeOrder && <MiniOrder state={state} order={activeOrder} />}
          {activeRide && <MiniRide state={state} ride={activeRide} />}
        </>
      )}
      {mode === "merchant" && (
        <>
          <div className="ops-card">
            <span>Cuenta</span>
            <strong>{user?.name}</strong>
            <p>
              {state.orders.filter((order) => order.restaurantId === merchantRestaurantId).length}{" "}
              pedidos historicos
            </p>
          </div>
          {state.orders
            .filter((order) => order.restaurantId === merchantRestaurantId)
            .slice(0, 3)
            .map((order) => (
              <MiniOrder key={order.id} state={state} order={order} />
            ))}
        </>
      )}
      {mode === "driver" && driver && (
        <>
          <div className="ops-card highlight">
            <span>Ganancia hoy</span>
            <strong>{money.format(driver.earningsToday)}</strong>
            <p>
              {driver.online ? "Online" : "Fuera de linea"} · {driver.vehicle}
            </p>
          </div>
          <button
            className="rail-action"
            type="button"
            disabled={busy}
            onClick={() =>
              runAction(
                () => api.updateDriver(driver.id, { online: !driver.online }),
                "Disponibilidad actualizada",
              )
            }
          >
            <LocateFixed size={16} /> {driver.online ? "Pausar" : "Activar"}
          </button>
        </>
      )}
      {mode === "ops" && (
        <>
          <div className="capacity-grid">
            <Metric
              label="Facturado"
              value={money.format(state.metrics.completedRevenue)}
              trend="completado"
            />
            <Metric label="Tickets" value={String(state.metrics.openTickets)} trend="soporte" />
          </div>
          {state.supportTickets.map((ticket) => (
            <article className="ops-card" key={ticket.id}>
              <span>
                {ticket.priority} ·{" "}
                {ticket.slaStatus === "on_track" ? "en SLA" : ticket.slaStatus.replaceAll("_", " ")}
              </span>
              <strong>{ticket.title}</strong>
              <p>
                {ticket.service} · {ticket.status}
              </p>
            </article>
          ))}
        </>
      )}
    </aside>
  );
}

function PanelHeader({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
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

function RideOpsCard({
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

function OfferCard({
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

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function MiniOrder({ state, order }: { state: AppState; order: Order }) {
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

function MiniRide({ state, ride }: { state: AppState; ride: Ride }) {
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
