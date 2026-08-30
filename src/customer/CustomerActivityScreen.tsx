import { useState } from "react";
import { Car, PackageCheck, ShoppingBag } from "lucide-react";

import { api } from "../api";
import { orderStatusLabel, rideStatusLabel, shipmentStatusLabel } from "../labels";
import type { AppState, User } from "../types";
import { SectionTitle } from "../ui/panels";
import { RescheduleControl } from "./SchedulePicker";
import { CustomerStatusCard } from "./CustomerStatusCard";
import { OrderTrackingSheet } from "./OrderTrackingSheet";
import { RideTrackingSheet } from "./RideTrackingSheet";
import { ShipmentTrackingSheet } from "./ShipmentTrackingSheet";

export function CustomerActivityScreen({
  state,
  user,
  runAction,
  busy,
}: {
  state: AppState;
  user: User | null;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  busy: boolean;
}) {
  const orders = state.orders.filter((order) => order.customerId === user?.id);
  const rides = state.rides.filter((ride) => ride.customerId === user?.id);
  const shipments = state.shipments.filter((shipment) => shipment.customerId === user?.id);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingRideId, setTrackingRideId] = useState<string | null>(null);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const trackingOrder = orders.find((order) => order.id === trackingOrderId) || null;
  const trackingRide = rides.find((ride) => ride.id === trackingRideId) || null;
  const trackingShipment = shipments.find((shipment) => shipment.id === trackingShipmentId) || null;
  return (
    <div className="activity-stack">
      <SectionTitle title="Pedidos" />
      {orders.map((order) => {
        const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
        const rated = state.ratings.some(
          (entry) => entry.jobId === order.id && entry.subjectType === "merchant",
        );
        const active = !["delivered", "cancelled"].includes(order.status);
        return (
          <CustomerStatusCard
            key={order.id}
            icon={ShoppingBag}
            title={`${restaurant?.name || "Restaurante"} · ${orderStatusLabel[order.status]}`}
            subtitle={`${order.items.length} items · ${order.deliveryAddress}`}
            amount={order.total}
            status={order.status}
            actionLabel={
              active
                ? "Seguir pedido"
                : order.status === "delivered"
                  ? rated
                    ? undefined
                    : "Calificar 5★"
                  : undefined
            }
            onAction={() =>
              active
                ? setTrackingOrderId(order.id)
                : order.status === "delivered"
                  ? runAction(
                      () => api.createRating(order.id, "merchant", 5),
                      "Gracias por tu calificación",
                    )
                  : undefined
            }
            secondaryActionLabel={active ? "Cancelar" : undefined}
            onSecondaryAction={
              active
                ? () =>
                    runAction(() => api.setOrderStatus(order.id, "cancelled"), "Pedido cancelado")
                : undefined
            }
            disabled={busy}
          >
            {/* Sólo mientras nadie empezó. Después el comercio ya está cocinando
                o hay un conductor en camino, y el servidor lo rechaza: ofrecer
                el botón igual sería prometer algo que devuelve 409. */}
            {order.scheduledFor && ["requested", "accepted"].includes(order.status) && (
              <RescheduleControl
                scheduledFor={order.scheduledFor}
                disabled={busy}
                onReschedule={(iso) =>
                  runAction(() => api.rescheduleJob(order.id, iso), "Pedido reprogramado")
                }
              />
            )}
          </CustomerStatusCard>
        );
      })}
      <SectionTitle title="Viajes" />
      {rides.map((ride) => {
        const driver = state.drivers.find((entry) => entry.id === ride.driverId);
        const rated = state.ratings.some(
          (entry) => entry.jobId === ride.id && entry.subjectType === "driver",
        );
        const active = !["completed", "cancelled"].includes(ride.status);
        return (
          <CustomerStatusCard
            key={ride.id}
            icon={Car}
            title={`${rideStatusLabel[ride.status]} · ${driver?.name || "Sin conductor"}`}
            subtitle={`${ride.pickup} → ${ride.destination}`}
            amount={ride.fare}
            status={ride.status}
            actionLabel={
              active
                ? "Seguir viaje"
                : ride.status === "completed"
                  ? rated
                    ? undefined
                    : "Calificar 5★"
                  : undefined
            }
            onAction={() =>
              active
                ? setTrackingRideId(ride.id)
                : ride.status === "completed"
                  ? runAction(
                      () => api.createRating(ride.id, "driver", 5),
                      "Gracias por tu calificación",
                    )
                  : undefined
            }
            secondaryActionLabel={active ? "Cancelar" : undefined}
            onSecondaryAction={
              active
                ? () => runAction(() => api.setRideStatus(ride.id, "cancelled"), "Viaje cancelado")
                : undefined
            }
            disabled={busy}
          />
        );
      })}
      <SectionTitle title="Envíos" />
      {shipments.map((shipment) => {
        const driver = state.drivers.find((entry) => entry.id === shipment.driverId);
        const active = !["delivered", "cancelled"].includes(shipment.status);
        return (
          <CustomerStatusCard
            key={shipment.id}
            icon={PackageCheck}
            title={`${shipmentStatusLabel[shipment.status]} · ${shipment.recipientName}`}
            subtitle={`${shipment.pickup} → ${shipment.destination} · ${shipment.packageSize}`}
            amount={shipment.fare}
            status={shipment.status}
            actionLabel={active ? "Seguir envío" : undefined}
            onAction={active ? () => setTrackingShipmentId(shipment.id) : undefined}
            secondaryActionLabel={active ? "Cancelar" : undefined}
            onSecondaryAction={
              active
                ? () =>
                    runAction(
                      () => api.setShipmentStatus(shipment.id, "cancelled"),
                      "Envío cancelado",
                    )
                : undefined
            }
            disabled={busy}
          />
        );
      })}
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
