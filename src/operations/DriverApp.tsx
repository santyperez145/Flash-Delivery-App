// Consola compacta de conductor (ARC-001).
//
// GPS, ofertas privadas y avance de trabajo. Uber Driver aísla este cockpit
// del comercio y de ops; Flash adopta la misma frontera en el phone-stage.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bike,
  Car,
  LocateFixed,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  WalletCards,
} from "lucide-react";

import { api } from "../api";
import { initials, money } from "../format";
import { OrderOpsCard, SectionTitle, TopBar } from "../ui/panels";
import type { AppState, DispatchOffer, Driver, User } from "../types";
import { describirOferta, OfferCard, RideOpsCard } from "./ops-primitives";

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
