import { useEffect, useState } from "react";
import {
  IceCreamCone,
  Car,
  ChevronLeft,
  ChevronRight,
  PackageCheck,
  Pill,
  RefreshCw,
  Search,
  ShoppingBasket,
  Store,
  Utensils,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api } from "../api";
import type {
  AppState,
  CatalogVertical,
  CustomerTab,
  MerchantVertical,
  Restaurant,
  Service,
  User,
} from "../types";
import { Cocinas, Comercios, EnCurso, enCursoDe, Promociones } from "./CustomerHomeFeed";
import type { Ambito } from "./CustomerScope";

// El inicio del cliente en la web (RES-02), con la misma lógica que el móvil
// (RES-01): la puerta a todos los servicios, con buscador, lo que está en curso,
// «¿A dónde vas?» y «Volver a pedir». Uber reorganizó así su app en 2023 (ver
// docs/reestructuracion-competitiva.md).
//
// **Sólo se ofrece lo que existe.** Los rubros salen del resumen del catálogo y
// uno sin comercios no aparece; viajes y envíos respetan sus interruptores, y si
// la lectura falla no se interpreta como «apagado».

type Flags = Record<string, { active: boolean; variant: Record<string, unknown> }> | null;
export type ServicioWeb =
  | { tipo: "ride" | "shipment"; titulo: string; detalle: string; icono: LucideIcon }
  | {
      tipo: "vertical";
      vertical: MerchantVertical;
      titulo: string;
      detalle: string;
      icono: LucideIcon;
      comercios: number;
    };

const RUBROS: Record<MerchantVertical, { titulo: string; detalle: string; icono: LucideIcon }> = {
  restaurant: { titulo: "Comida", detalle: "Restaurantes cerca tuyo", icono: Utensils },
  grocery: { titulo: "Súper", detalle: "Almacén y súper a domicilio", icono: ShoppingBasket },
  pharmacy: { titulo: "Farmacia", detalle: "Cuidado personal y salud", icono: Pill },
  kiosk: { titulo: "Kiosco", detalle: "Bebidas, golosinas y más", icono: IceCreamCone },
  retail: { titulo: "Tiendas", detalle: "Comercios de tu zona", icono: Store },
};

export function useServiciosWeb(features: Flags, ambito: Ambito) {
  // `null` mientras carga; "error" si el resumen no se pudo leer. Uno leído y vacío
  // es otra cosa: no hay comercios, y no se ofrece pedir.
  const [rubros, setRubros] = useState<CatalogVertical[] | "error" | null>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vigente = true;
    setRubros(null);
    api
      .getCatalogVerticals()
      .then((respuesta) => vigente && setRubros(respuesta.verticals))
      .catch(() => vigente && setRubros("error"));
    return () => {
      vigente = false;
    };
  }, [intento]);
  const servicios: ServicioWeb[] = [];
  if (features?.public_rides?.active ?? true)
    servicios.push({ tipo: "ride", titulo: "Viaje", detalle: "Auto, moto o XL", icono: Car });
  for (const rubro of Array.isArray(rubros) ? rubros : [])
    if (rubro.merchants > 0)
      servicios.push({
        tipo: "vertical",
        vertical: rubro.vertical,
        ...RUBROS[rubro.vertical],
        comercios: rubro.merchants,
      });
  if (rubros === "error")
    servicios.push({
      tipo: "vertical",
      vertical: "restaurant",
      ...RUBROS.restaurant,
      comercios: 0,
    });
  if (features?.shipment_beta?.active ?? true)
    servicios.push({
      tipo: "shipment",
      titulo: "Envíos",
      detalle: "Mandá un paquete en el día",
      icono: PackageCheck,
    });
  return {
    // Pedidos ofrece los rubros de comercio; Viajes, viajes y envíos (FE-01).
    servicios: servicios.filter(
      (servicio) => (servicio.tipo === "vertical") === (ambito === "pedidos"),
    ),
    cargando: rubros === null,
    // Si el resumen falló, Comida queda con el catálogo ya cargado, pero se dice que
    // falta información y se ofrece reintentar: no se presenta como disponibilidad.
    fallo: rubros === "error",
    reintentar: () => setIntento((n) => n + 1),
    hayComercios: servicios.some((servicio) => servicio.tipo === "vertical"),
  };
}

/** El aviso de un resumen de rubros que no se pudo leer. */
function AvisoRubros({ onRetry }: { onRetry: () => void }) {
  return (
    <p className="customer-home-notice" role="alert">
      No pudimos ver qué hay disponible en tu zona.
      <button type="button" onClick={onRetry}>
        Reintentar
      </button>
    </p>
  );
}

type Abrir = (servicio: Service, vertical?: MerchantVertical) => void;

/**
 * «Inicio» es la portada con todos los servicios; tocar uno entra a él. El
 * servicio vive en `App.tsx` (H-08), así que acá sólo se guarda si se está en la
 * portada o adentro, y con qué rubro se entró.
 */
export function usePortada({
  setService,
  setTab,
  setCategory,
  setQuery,
}: {
  setService: (service: Service) => void;
  setTab: (tab: CustomerTab) => void;
  setCategory: (category: string) => void;
  setQuery: (query: string) => void;
}) {
  const [enServicio, setEnServicio] = useState(false);
  const [rubro, setRubro] = useState<MerchantVertical>("restaurant");
  const entrar = (destino: Service) => {
    setService(destino);
    setEnServicio(true);
    setTab("home");
  };
  // Buscar desde el inicio también empieza de cero: la categoría de antes ocultaría
  // comercios que coinciden con lo que se busca.
  const buscar = () => {
    setCategory("Todo");
    setQuery("");
    entrar("food");
  };
  const abrir: Abrir = (destino, vertical) => {
    // Entrar a un rubro empieza de cero: la cocina o la búsqueda de otro rubro lo
    // dejarían vacío sin que se vea por qué.
    if (vertical) {
      setRubro(vertical);
      setCategory("Todo");
      setQuery("");
    }
    entrar(destino);
  };
  /** Una cocina del inicio entra a Comida con esa categoría elegida (FE-01). */
  const abrirCategoria = (categoria: string) => {
    setRubro("restaurant");
    setQuery("");
    setCategory(categoria);
    entrar("food");
  };
  return {
    enServicio,
    volver: () => setEnServicio(false),
    rubro,
    abrir,
    buscar,
    abrirCategoria,
  };
}
export type Portada = ReturnType<typeof usePortada>;
const abrirCon = (abrir: Abrir) => (servicio: ServicioWeb) =>
  servicio.tipo === "vertical" ? abrir("food", servicio.vertical) : abrir(servicio.tipo);

export function CustomerHome({
  state,
  user,
  features,
  portada,
  onOpenRestaurant,
  onToggleFavorite,
  onOpenActivity,
}: {
  state: AppState;
  user: User | null;
  features: Flags;
  portada: Portada;
  onOpenRestaurant: (restaurantId: string) => void;
  onToggleFavorite: (restaurantId: string, favorite: boolean) => void;
  onOpenActivity: () => void;
}) {
  const { servicios, fallo, reintentar, hayComercios } = useServiciosWeb(features, "pedidos");
  const abrir = abrirCon(portada.abrir);
  const favoritos = state.favoriteRestaurantIds || [];
  // «Volver a pedir»: comercios donde la persona ya recibió un pedido.
  const yaPedidos = [
    ...new Set(
      state.orders
        .filter((order) => order.customerId === user?.id && order.status === "delivered")
        .map((order) => order.restaurantId),
    ),
  ]
    .map((id) => state.restaurants.find((restaurant) => restaurant.id === id))
    .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));

  return (
    <section className="customer-home" aria-label="Inicio">
      <div className="customer-home-hero">
        <h1>Hola{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p>¿Qué vas a pedir hoy?</p>
        {/* Sin comercios no hay nada que buscar. */}
        {hayComercios && (
          <button type="button" className="customer-home-search" onClick={portada.buscar}>
            <Search size={18} /> Buscar comida, súper o farmacia
          </button>
        )}
      </div>
      {fallo && <AvisoRubros onRetry={reintentar} />}
      <EnCurso items={enCursoDe(state, user?.id, "pedidos")} onOpen={onOpenActivity} />
      {/* Con un solo rubro, el buscador y los comercios ya lo cubren. */}
      {servicios.length > 1 && (
        <div className="customer-home-grid" data-pocos={servicios.length <= 4 || undefined}>
          {servicios.map((servicio) => (
            <button
              type="button"
              key={servicio.tipo === "vertical" ? servicio.vertical : servicio.tipo}
              data-servicio={servicio.tipo === "vertical" ? servicio.vertical : servicio.tipo}
              aria-label={servicio.titulo}
              onClick={() => abrir(servicio)}
            >
              <span className="customer-home-tile-icon" aria-hidden="true">
                <servicio.icono size={26} />
              </span>
              <strong>{servicio.titulo}</strong>
              <small>{servicio.detalle}</small>
            </button>
          ))}
        </div>
      )}
      <Promociones state={state} onOpen={portada.buscar} />
      <Cocinas restaurants={state.restaurants} onOpen={portada.abrirCategoria} />
      <Comercios
        titulo="Volver a pedir"
        restaurants={yaPedidos}
        favoritos={favoritos}
        onOpen={onOpenRestaurant}
        onToggleFavorite={onToggleFavorite}
      />
      <Comercios
        titulo="Cerca tuyo"
        restaurants={state.restaurants.filter((restaurant) => !yaPedidos.includes(restaurant))}
        favoritos={favoritos}
        onOpen={onOpenRestaurant}
        onToggleFavorite={onToggleFavorite}
        onVerTodo={() => portada.abrir("food", "restaurant")}
      />
    </section>
  );
}

/** La pestaña Servicios: todo lo disponible, con qué es cada cosa. */
export function CustomerServices({
  features,
  ambito,
  onOpen,
}: {
  features: Flags;
  ambito: Ambito;
  onOpen: Abrir;
}) {
  const { servicios, cargando, fallo, reintentar } = useServiciosWeb(features, ambito);
  const abrir = abrirCon(onOpen);
  return (
    <section className="customer-services" aria-label="Servicios">
      <h1>{ambito === "pedidos" ? "Explorar" : "Servicios"}</h1>
      {fallo && <AvisoRubros onRetry={reintentar} />}
      <p>
        {cargando
          ? "Buscando lo disponible en tu zona…"
          : ambito === "pedidos"
            ? "Todo lo que podés pedir en tu zona"
            : "Para moverte y mandar paquetes"}
      </p>
      {servicios.map((servicio) => (
        <button
          type="button"
          key={servicio.tipo === "vertical" ? servicio.vertical : servicio.tipo}
          aria-label={`Abrir ${servicio.titulo}`}
          onClick={() => abrir(servicio)}
        >
          <servicio.icono size={22} />
          <span>
            <strong>{servicio.titulo}</strong>
            <small>
              {servicio.tipo === "vertical" && servicio.comercios > 0
                ? `${servicio.detalle} · ${servicio.comercios} ${servicio.comercios === 1 ? "comercio" : "comercios"}`
                : servicio.detalle}
            </small>
          </span>
          <ChevronRight size={18} />
        </button>
      ))}
    </section>
  );
}

/** Mientras se descarga el módulo de Viajes, que se carga sólo al entrar. */
export function CargandoViajes() {
  return (
    <div className="ride-map ride-map-empty">
      <div className="ride-map-empty-copy">
        <RefreshCw size={20} />
        <strong>Cargando Viajes</strong>
      </div>
    </div>
  );
}

/** Dentro de un servicio: volver al inicio. */
export function ServiceBackBar({ titulo, onBack }: { titulo: string; onBack: () => void }) {
  return (
    <div className="customer-service-back">
      <button type="button" aria-label="Volver al inicio" onClick={onBack}>
        <ChevronLeft size={20} />
      </button>
      <strong>{titulo}</strong>
    </div>
  );
}
