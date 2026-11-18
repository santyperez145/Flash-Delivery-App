import { useEffect, useState, type ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

import { api, request } from "./api";
import { flashDesign } from "./design-system";
import type { CatalogVertical, MerchantVertical } from "./types";

// Los servicios que Flash ofrece a quien pide (RES-01).
//
// Uber reorganizó su app en 2023 alrededor de esta idea: el inicio deja de ser
// el mapa de un servicio y pasa a ser la puerta a todos, con una pestaña
// «Servicios» que reúne lo disponible en la ciudad. Flash es lo mismo: viajes,
// comida, súper, farmacia, kiosco, tiendas y envíos.
//
// **Sólo se ofrece lo que existe.** Los rubros salen del resumen del catálogo
// (`GET /api/catalog/verticals`): un rubro sin comercios no se muestra. Viajes y
// envíos respetan sus interruptores (`public_rides`, `shipment_beta`) con la
// misma regla que la web: si la lectura falla, no se interpreta como «apagado».

type IconName = ComponentProps<typeof Ionicons>["name"];

export type ServicioCliente =
  | { tipo: "ride"; titulo: string; detalle: string; icono: IconName; color: string }
  | { tipo: "shipment"; titulo: string; detalle: string; icono: IconName; color: string }
  | {
      tipo: "vertical";
      vertical: MerchantVertical;
      titulo: string;
      detalle: string;
      icono: IconName;
      color: string;
      comercios: number;
    };

const RUBROS: Record<MerchantVertical, { titulo: string; detalle: string; icono: IconName }> = {
  restaurant: { titulo: "Comida", detalle: "Restaurantes cerca tuyo", icono: "fast-food-outline" },
  grocery: { titulo: "Súper", detalle: "Almacén y súper a domicilio", icono: "basket-outline" },
  pharmacy: { titulo: "Farmacia", detalle: "Cuidado personal y salud", icono: "medkit-outline" },
  kiosk: { titulo: "Kiosco", detalle: "Bebidas, golosinas y más", icono: "ice-cream-outline" },
  retail: { titulo: "Tiendas", detalle: "Comercios de tu zona", icono: "bag-handle-outline" },
};

type Flags = Record<string, { active: boolean }>;

export function useServiciosDisponibles() {
  // `null` mientras carga; "error" si el resumen no se pudo leer. Un resumen leído
  // y vacío es otra cosa: no hay comercios, y no se ofrece pedir.
  const [rubros, setRubros] = useState<CatalogVertical[] | "error" | null>(null);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vigente = true;
    setRubros(null);
    api
      .getCatalogVerticals()
      .then((respuesta) => vigente && setRubros(respuesta.verticals))
      .catch(() => vigente && setRubros("error"));
    request<{ features: Flags }>("/features")
      .then((respuesta) => vigente && setFlags(respuesta.features))
      .catch(() => vigente && setFlags(null));
    return () => {
      vigente = false;
    };
  }, [intento]);

  const servicios: ServicioCliente[] = [];
  if (flags?.public_rides?.active ?? true)
    servicios.push({
      tipo: "ride",
      titulo: "Viaje",
      detalle: "Auto, moto o XL, cuando lo necesites",
      icono: "car-sport-outline",
      color: flashDesign.color.ride,
    });
  for (const rubro of Array.isArray(rubros) ? rubros : [])
    if (rubro.merchants > 0)
      servicios.push({
        tipo: "vertical",
        vertical: rubro.vertical,
        ...RUBROS[rubro.vertical],
        color: flashDesign.color.food,
        comercios: rubro.merchants,
      });
  // Si el resumen falló, la comida sigue disponible: es el catálogo que la app ya
  // tiene cargado. Si se leyó vacío, no hay comercios que ofrecer.
  if (rubros === "error")
    servicios.push({
      tipo: "vertical",
      vertical: "restaurant",
      ...RUBROS.restaurant,
      color: flashDesign.color.food,
      comercios: 0,
    });
  if (flags?.shipment_beta?.active ?? true)
    servicios.push({
      tipo: "shipment",
      titulo: "Envíos",
      detalle: "Mandá un paquete en el día",
      icono: "cube-outline",
      color: flashDesign.color.shipment,
    });
  return {
    servicios,
    cargando: rubros === null,
    // Si el resumen falló, Comida queda con el catálogo ya cargado, pero se dice que
    // falta información y se ofrece reintentar: no se presenta como disponibilidad.
    fallo: rubros === "error",
    reintentar: () => setIntento((n) => n + 1),
    hayComercios: servicios.some((servicio) => servicio.tipo === "vertical"),
  };
}
