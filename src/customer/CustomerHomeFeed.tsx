import { Bike, Car, ChevronRight, PackageCheck, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  orderStatusLabel,
  orderSteps,
  pickupOrderSteps,
  rideStatusLabel,
  rideSteps,
  shipmentStatusLabel,
  shipmentSteps,
} from "../labels";
import type { AppState, Restaurant } from "../types";
import { RestaurantCard } from "./FoodCatalogComponents";
import type { Ambito } from "./CustomerScope";

// Las secciones del inicio del cliente web (FE-01), como el feed de Uber Eats:
// lo que está en curso con su avance, promociones vigentes, cocinas, «Volver a
// pedir» y los comercios abiertos. **Todo sale del estado real**: sin promoción
// activa no hay tarjeta, y una cocina aparece sólo si algún comercio abierto la
// tiene en su carta.

export type EnCursoItem = {
  id: string;
  icono: LucideIcon;
  titulo: string;
  estado: string;
  /** De 0 a 1, según el paso del recorrido en que va. */
  avance: number;
};

export const avanceDe = <T,>(pasos: T[], estado: T) =>
  Math.max(0, pasos.indexOf(estado)) / Math.max(1, pasos.length - 1);

export function enCursoDe(
  state: AppState,
  userId: string | undefined,
  ambito: Ambito,
): EnCursoItem[] {
  const propios = <T extends { customerId: string }>(lista: T[]) =>
    lista.filter((entry) => entry.customerId === userId);
  if (ambito === "pedidos")
    return propios(state.orders)
      .filter((order) => !["delivered", "cancelled"].includes(order.status))
      .map((order) => ({
        id: order.id,
        icono: Bike,
        titulo:
          state.restaurants.find((restaurant) => restaurant.id === order.restaurantId)?.name ??
          "Tu pedido",
        estado: orderStatusLabel[order.status],
        avance: avanceDe(
          order.fulfillment === "pickup" ? pickupOrderSteps : orderSteps,
          order.status,
        ),
      }));
  return [
    ...propios(state.rides)
      .filter((ride) => !["completed", "cancelled"].includes(ride.status))
      .map((ride) => ({
        id: ride.id,
        icono: Car,
        titulo: `Viaje a ${ride.destination}`,
        estado: rideStatusLabel[ride.status],
        avance: avanceDe(rideSteps, ride.status),
      })),
    ...propios(state.shipments)
      .filter((shipment) => !["delivered", "cancelled"].includes(shipment.status))
      .map((shipment) => ({
        id: shipment.id,
        icono: PackageCheck,
        titulo: `Envío a ${shipment.destination}`,
        estado: shipmentStatusLabel[shipment.status],
        avance: avanceDe(shipmentSteps, shipment.status),
      })),
  ];
}

/** Lo que está en curso, cada cosa con su estado y una barra de avance. */
export function EnCurso({ items, onOpen }: { items: EnCursoItem[]; onOpen: () => void }) {
  if (!items.length) return null;
  return (
    <section className="home-live" aria-label="En curso">
      {items.slice(0, 2).map((item) => (
        <button type="button" key={item.id} onClick={onOpen}>
          <span className="home-live-icon" aria-hidden="true">
            <item.icono size={20} />
          </span>
          <span className="home-live-copy">
            <small>{item.estado}</small>
            <strong>{item.titulo}</strong>
            <span
              className="home-live-bar"
              role="progressbar"
              aria-label={`Avance: ${item.estado}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(item.avance * 100)}
            >
              <span style={{ width: `${Math.max(8, item.avance * 100)}%` }} />
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
      ))}
      {items.length > 2 && (
        <button type="button" className="home-live-more" onClick={onOpen}>
          Ver las {items.length} en Actividad
        </button>
      )}
    </section>
  );
}

/** Encabezado de sección con un «Ver todo» opcional, como en las apps de delivery. */
export function Seccion({
  titulo,
  accion,
  onAccion,
  children,
}: {
  titulo: string;
  accion?: string;
  onAccion?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="home-section" aria-label={titulo}>
      <header>
        <h2>{titulo}</h2>
        {accion && onAccion && (
          <button type="button" onClick={onAccion}>
            {accion} <ChevronRight size={16} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/** Promociones vigentes de comida. Sin promoción activa, la sección no existe. */
export function Promociones({
  state,
  onOpen,
}: {
  state: Pick<AppState, "promotions">;
  onOpen: () => void;
}) {
  const vigentes = state.promotions.filter((promo) => promo.active && promo.service === "food");
  if (!vigentes.length) return null;
  return (
    <Seccion titulo="Promociones">
      <div className="home-promos">
        {vigentes.map((promo, index) => (
          <button type="button" key={promo.id} data-tono={index % 3} onClick={onOpen}>
            <Tag size={18} />
            <strong>{promo.title}</strong>
            <span>{promo.description}</span>
            {promo.code && <small>Código {promo.code}</small>}
          </button>
        ))}
      </div>
    </Seccion>
  );
}

/** Las cocinas que hoy tienen algo en la carta de un comercio abierto. */
export function cocinasDe(restaurants: Restaurant[]) {
  const conteo = new Map<string, { imagen: string; platos: number }>();
  for (const restaurant of restaurants.filter((entry) => entry.open))
    for (const item of restaurant.menu.filter((entry) => entry.stock)) {
      const actual = conteo.get(item.category);
      conteo.set(item.category, {
        imagen: actual?.imagen || item.image,
        platos: (actual?.platos ?? 0) + 1,
      });
    }
  return [...conteo.entries()]
    .sort((a, b) => b[1].platos - a[1].platos)
    .slice(0, 10)
    .map(([nombre, { imagen }]) => ({ nombre, imagen }));
}

export function Cocinas({
  restaurants,
  onOpen,
}: {
  restaurants: Restaurant[];
  onOpen: (categoria: string) => void;
}) {
  const cocinas = cocinasDe(restaurants);
  if (cocinas.length < 2) return null;
  return (
    <Seccion titulo="¿Qué se te antoja?">
      <div className="home-cuisines">
        {cocinas.map((cocina) => (
          <button type="button" key={cocina.nombre} onClick={() => onOpen(cocina.nombre)}>
            {/* FE-04: si ningún plato de la cocina tiene foto, un círculo neutro en
                lugar de un <img> vacío (los platos ya no heredan la foto del local). */}
            {cocina.imagen ? (
              <img src={cocina.imagen} alt="" loading="lazy" />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: 999,
                  background: "var(--paper-soft)",
                  border: "1px solid var(--line)",
                }}
              />
            )}
            <span>{cocina.nombre}</span>
          </button>
        ))}
      </div>
    </Seccion>
  );
}

/** Comercios para pedir ahora: abiertos primero, y entre ellos los más rápidos. */
export function Comercios({
  titulo,
  restaurants,
  favoritos,
  onOpen,
  onToggleFavorite,
  onVerTodo,
}: {
  titulo: string;
  restaurants: Restaurant[];
  favoritos: string[];
  onOpen: (restaurantId: string) => void;
  onToggleFavorite: (restaurantId: string, favorite: boolean) => void;
  onVerTodo?: () => void;
}) {
  if (!restaurants.length) return null;
  const orden = [...restaurants].sort(
    (a, b) => Number(b.open) - Number(a.open) || a.etaMin - b.etaMin,
  );
  return (
    <Seccion titulo={titulo} accion="Ver todo" onAccion={onVerTodo}>
      <div className="home-stores">
        {orden.slice(0, 8).map((restaurant) => (
          <RestaurantCard
            key={restaurant.id}
            restaurant={restaurant}
            favorite={favoritos.includes(restaurant.id)}
            onToggleFavorite={() =>
              onToggleFavorite(restaurant.id, !favoritos.includes(restaurant.id))
            }
            onClick={() => onOpen(restaurant.id)}
          />
        ))}
      </div>
    </Seccion>
  );
}
