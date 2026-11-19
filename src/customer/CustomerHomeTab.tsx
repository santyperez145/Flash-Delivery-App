import { lazy, Suspense } from "react";

import { CargandoViajes, CustomerHome, ServiceBackBar, type Portada } from "./CustomerHome";
import type { Ambito } from "./CustomerScope";
import type { CustomerAppProps } from "./CustomerSurface";
import { FoodDiscoveryHome } from "./FoodDiscoveryHome";
import { RidesHome } from "./RidesLanding";
import { ShipmentHome } from "./ShipmentHome";

// La pestaña Inicio de cada ámbito (FE-01): la portada de Pedidos o la de Viajes y,
// adentro de un servicio, su pantalla con la barra para volver. Salió de
// `CustomerSurface.tsx`, que tiene techo de tamaño.

const RideHome = lazy(() => import("../RideHome"));

export function CustomerHomeTab({
  props,
  ambito,
  portada,
  toggleFavorite,
}: {
  props: CustomerAppProps;
  ambito: Ambito;
  portada: Portada;
  toggleFavorite: (restaurantId: string, favorite: boolean) => void;
}) {
  const { state, user, service, setTab, setSelectedRestaurantId, busy } = props;
  if (!portada.enServicio)
    return ambito === "pedidos" ? (
      <CustomerHome
        state={state}
        user={user}
        features={props.features}
        portada={portada}
        onOpenRestaurant={setSelectedRestaurantId}
        onToggleFavorite={toggleFavorite}
        onOpenActivity={() => setTab("activity")}
      />
    ) : (
      <RidesHome
        state={state}
        user={user}
        features={props.features}
        portada={portada}
        setRideForm={props.setRideForm}
        onOpenActivity={() => setTab("activity")}
        onWalletChanged={() =>
          props.runAction(() => Promise.resolve(), "Pagaste tu parte del viaje")
        }
      />
    );

  return (
    <>
      <ServiceBackBar
        titulo={service === "ride" ? "Viaje" : service === "shipment" ? "Envíos" : "Comida"}
        onBack={portada.volver}
      />
      {service === "food" && (
        <FoodDiscoveryHome
          key={portada.rubro}
          initialVertical={portada.rubro}
          restaurants={props.restaurants}
          allItems={props.allItems}
          query={props.query}
          setQuery={props.setQuery}
          category={props.category}
          setCategory={props.setCategory}
          categories={props.categories}
          state={state}
          onToggleFavorite={toggleFavorite}
          onOpenRestaurant={(restaurant) => setSelectedRestaurantId(restaurant.id)}
          onOpenItem={props.openItem}
          onOpenSubscription={() => setTab("profile")}
        />
      )}
      {service === "ride" && (
        <Suspense fallback={<CargandoViajes />}>
          <RideHome
            state={state}
            user={user}
            addresses={props.addresses}
            rideForm={props.rideForm}
            setRideForm={props.setRideForm}
            quote={props.quote}
            quoteRide={props.quoteRide}
            requestRide={props.requestRide}
            locatePickup={props.locatePickup}
            locationStatus={props.locationStatus}
            locationMessage={props.locationMessage}
            busy={busy}
          />
        </Suspense>
      )}
      {service === "shipment" && (
        <ShipmentHome
          state={state}
          user={user}
          busy={busy}
          onCreateShipment={props.createShipment}
        />
      )}
    </>
  );
}
