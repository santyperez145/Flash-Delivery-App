import { useState } from "react";
import { Car, PackageCheck, ShoppingBag } from "lucide-react";

import { api } from "../api";
import {
  orderStatusLabel,
  orderSteps,
  pickupOrderSteps,
  rideStatusLabel,
  rideSteps,
  shipmentStatusLabel,
  shipmentSteps,
} from "../labels";
import type { AppState, User } from "../types";
import { RescheduleControl } from "./SchedulePicker";
import { FilaAnterior, SinActividad, TarjetaEnCurso, unidades } from "./ActivityEntries";
import type { Entrada } from "./ActivityEntries";
import { avanceDe } from "./CustomerHomeFeed";
import type { Ambito } from "./CustomerScope";
import { OrderTrackingSheet } from "./OrderTrackingSheet";
import { RideTrackingSheet } from "./RideTrackingSheet";
import { ShipmentTrackingSheet } from "./ShipmentTrackingSheet";

// Actividad (FE-01): lo que está en curso arriba y lo anterior abajo, por fecha, como
// en Uber; cada ámbito ve lo suyo (Pedidos sus pedidos, Viajes sus viajes y envíos).
// Antes eran tres listas por servicio con el estado interno a la vista («delivering»)
// y una calificación de 5 estrellas de un toque.

export function CustomerActivityScreen({
  state,
  user,
  runAction,
  busy,
  ambito,
  onOpenRestaurant,
}: {
  state: AppState;
  user: User | null;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  busy: boolean;
  /** Pedidos muestra pedidos; Viajes, viajes y envíos. */
  ambito: Ambito;
  onOpenRestaurant: (restaurantId: string) => void;
}) {
  const pedidos = ambito === "pedidos";
  const orders = state.orders.filter((order) => pedidos && order.customerId === user?.id);
  const rides = state.rides.filter((ride) => !pedidos && ride.customerId === user?.id);
  const shipments = state.shipments.filter((entry) => !pedidos && entry.customerId === user?.id);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingRideId, setTrackingRideId] = useState<string | null>(null);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const trackingOrder = orders.find((order) => order.id === trackingOrderId) || null;
  const trackingRide = rides.find((ride) => ride.id === trackingRideId) || null;
  const trackingShipment = shipments.find((shipment) => shipment.id === trackingShipmentId) || null;
  const calificado = (jobId: string, subject: "merchant" | "driver") =>
    state.ratings.some((entry) => entry.jobId === jobId && entry.subjectType === subject);
  const calificar = (jobId: string, subject: "merchant" | "driver") => (estrellas: number) =>
    runAction(() => api.createRating(jobId, subject, estrellas), "Gracias por tu calificación");

  const entradas: Entrada[] = [
    ...orders.map((order): Entrada => {
      const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
      const activo = !["delivered", "cancelled"].includes(order.status);
      const cantidad = order.items.reduce((sum, item) => sum + item.quantity, 0);
      const retiro = order.fulfillment === "pickup";
      return {
        id: order.id,
        icono: ShoppingBag,
        imagen: restaurant?.image,
        titulo: restaurant?.name || "Pedido",
        detalle: retiro ? `${unidades(cantidad)} · Retiro` : unidades(cantidad),
        fecha: order.createdAt,
        monto: order.total,
        estado: orderStatusLabel[order.status],
        activo,
        cancelado: order.status === "cancelled",
        avance: avanceDe(retiro ? pickupOrderSteps : orderSteps, order.status),
        seguir: { rotulo: "Seguir pedido", accion: () => setTrackingOrderId(order.id) },
        cancelar: activo
          ? () => runAction(() => api.setOrderStatus(order.id, "cancelled"), "Pedido cancelado")
          : undefined,
        calificar:
          order.status === "delivered" && !calificado(order.id, "merchant")
            ? calificar(order.id, "merchant")
            : undefined,
        volverAPedir: !activo && restaurant ? () => onOpenRestaurant(restaurant.id) : undefined,
        // Sólo mientras nadie empezó. Después el comercio ya está cocinando o hay un
        // conductor en camino, y el servidor lo rechaza con 409.
        extra: order.scheduledFor && ["requested", "accepted"].includes(order.status) && (
          <RescheduleControl
            scheduledFor={order.scheduledFor}
            disabled={busy}
            onReschedule={(iso) =>
              runAction(() => api.rescheduleJob(order.id, iso), "Pedido reprogramado")
            }
          />
        ),
      };
    }),
    ...rides.map((ride): Entrada => {
      const driver = state.drivers.find((entry) => entry.id === ride.driverId);
      const activo = !["completed", "cancelled"].includes(ride.status);
      return {
        id: ride.id,
        icono: Car,
        titulo: `Viaje a ${ride.destination}`,
        detalle: driver ? `Con ${driver.name}` : `Desde ${ride.pickup}`,
        fecha: ride.createdAt,
        monto: ride.fare,
        estado: rideStatusLabel[ride.status],
        activo,
        cancelado: ride.status === "cancelled",
        avance: avanceDe(rideSteps, ride.status),
        seguir: { rotulo: "Seguir viaje", accion: () => setTrackingRideId(ride.id) },
        cancelar: activo
          ? () => runAction(() => api.setRideStatus(ride.id, "cancelled"), "Viaje cancelado")
          : undefined,
        calificar:
          ride.status === "completed" && !calificado(ride.id, "driver")
            ? calificar(ride.id, "driver")
            : undefined,
      };
    }),
    ...shipments.map((shipment): Entrada => {
      const activo = !["delivered", "cancelled"].includes(shipment.status);
      return {
        id: shipment.id,
        icono: PackageCheck,
        titulo: `Envío a ${shipment.recipientName}`,
        detalle: shipment.destination,
        fecha: shipment.timeline?.[0]?.at,
        monto: shipment.fare,
        estado: shipmentStatusLabel[shipment.status],
        activo,
        cancelado: shipment.status === "cancelled",
        avance: avanceDe(shipmentSteps, shipment.status),
        seguir: { rotulo: "Seguir envío", accion: () => setTrackingShipmentId(shipment.id) },
        cancelar: activo
          ? () =>
              runAction(() => api.setShipmentStatus(shipment.id, "cancelled"), "Envío cancelado")
          : undefined,
      };
    }),
  ].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  const enCurso = entradas.filter((entrada) => entrada.activo);
  const anteriores = entradas.filter((entrada) => !entrada.activo);

  return (
    <div className="activity-page">
      <h1>{pedidos ? "Pedidos" : "Actividad"}</h1>
      {!entradas.length && <SinActividad pedidos={pedidos} />}
      {enCurso.length > 0 && (
        <section aria-label="En curso">
          <h2>En curso</h2>
          <div className="activity-live-list">
            {enCurso.map((entrada) => (
              <TarjetaEnCurso key={entrada.id} entrada={entrada} busy={busy} />
            ))}
          </div>
        </section>
      )}
      {anteriores.length > 0 && (
        <section aria-label="Anteriores">
          <h2>Anteriores</h2>
          {anteriores.map((entrada) => (
            <FilaAnterior key={entrada.id} entrada={entrada} busy={busy} />
          ))}
        </section>
      )}
      {trackingOrder && (
        <OrderTrackingSheet
          order={trackingOrder}
          driver={state.drivers.find((driver) => driver.id === trackingOrder.courierId) || null}
          onClose={() => setTrackingOrderId(null)}
        />
      )}
      {trackingRide && (
        <RideTrackingSheet
          ride={trackingRide}
          driver={state.drivers.find((driver) => driver.id === trackingRide.driverId) || null}
          onClose={() => setTrackingRideId(null)}
        />
      )}
      {trackingShipment && (
        <ShipmentTrackingSheet
          shipment={trackingShipment}
          driver={state.drivers.find((driver) => driver.id === trackingShipment.driverId) || null}
          onClose={() => setTrackingShipmentId(null)}
        />
      )}
    </div>
  );
}
