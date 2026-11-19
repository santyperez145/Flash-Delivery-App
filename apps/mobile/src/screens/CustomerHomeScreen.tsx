import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../api";
import { useServiciosDisponibles, type ServicioCliente } from "../customer-services";
import { TripCheckBanner } from "../TripCheckBanner";
import { FareSplitInvitations } from "../FareSplit";
import { flashDesign } from "../design-system";
import type {
  GeoPoint,
  MerchantVertical,
  Order,
  Restaurant,
  Ride,
  RideDestination,
  Shipment,
  User,
} from "../types";

// El inicio de la app del cliente (RES-01).
//
// Antes, «Inicio» era la portada de comidas con un selector de servicio arriba:
// viajes y envíos eran ventanas aparte. Uber reorganizó su app en 2023 con el
// inicio como puerta a todos sus servicios, «¿A dónde vas?» con destinos
// recientes y lo que está en curso arriba de todo. Este inicio sigue esa lógica,
// con datos reales: los servicios del catálogo, los destinos que la persona usó y
// los comercios donde ya pidió. Lo que no existe, no se muestra.

type Destino = { address: string; point: GeoPoint | null };

export function CustomerHomeScreen({
  user,
  deliveryAddress,
  restaurants,
  orders,
  activeOrders,
  activeRides,
  ridesWithCheck,
  activeShipments,
  onSearch,
  onWhereTo,
  onOpenVertical,
  onOpenShipment,
  onOpenRestaurant,
  onOpenActivity,
}: {
  user: User;
  deliveryAddress: string;
  restaurants: Restaurant[];
  /** Los pedidos de la persona, en curso y terminados. */
  orders: Order[];
  activeOrders: Order[];
  activeRides: Ride[];
  /** SEG-01: viajes con un aviso del control del viaje sin contestar. */
  ridesWithCheck: Ride[];
  activeShipments: Shipment[];
  onSearch: () => void;
  onWhereTo: (destino: Destino | null) => void;
  onOpenVertical: (vertical: MerchantVertical) => void;
  onOpenShipment: () => void;
  onOpenRestaurant: (restaurantId: string) => void;
  onOpenActivity: () => void;
}) {
  const { servicios, fallo, reintentar, hayComercios } = useServiciosDisponibles();
  const viajes = servicios.some((servicio) => servicio.tipo === "ride");
  const [destinos, setDestinos] = useState<RideDestination[]>([]);
  useEffect(() => {
    if (!viajes) return;
    let vigente = true;
    api
      .getRideDestinations()
      .then((respuesta) => vigente && setDestinos(respuesta.destinations.slice(0, 3)))
      .catch(() => vigente && setDestinos([]));
    return () => {
      vigente = false;
    };
  }, [viajes, user.id]);

  // «Volver a pedir»: comercios abiertos donde la persona ya recibió un pedido,
  // del más reciente al más viejo, sin repetir.
  const yaPedidos: Restaurant[] = [];
  for (const order of [...orders]
    .filter((order) => order.customerId === user.id && order.status === "delivered")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))) {
    const restaurant = restaurants.find((entry) => entry.id === order.restaurantId);
    if (restaurant?.open && !yaPedidos.some((entry) => entry.id === restaurant.id))
      yaPedidos.push(restaurant);
    if (yaPedidos.length === 4) break;
  }

  const enCurso = [
    ...activeOrders.map((order) => ({
      id: order.id,
      icono: "fast-food" as const,
      texto: `Pedido de ${restaurants.find((entry) => entry.id === order.restaurantId)?.name ?? "tu comercio"}`,
    })),
    ...activeRides.map((ride) => ({
      id: ride.id,
      icono: "car-sport" as const,
      texto: `Viaje a ${ride.destination}`,
    })),
    ...activeShipments.map((shipment) => ({
      id: shipment.id,
      icono: "cube" as const,
      texto: `Envío a ${shipment.destination}`,
    })),
  ];

  const abrir = (servicio: ServicioCliente) =>
    servicio.tipo === "ride"
      ? onWhereTo(null)
      : servicio.tipo === "shipment"
        ? onOpenShipment()
        : onOpenVertical(servicio.vertical);

  return (
    <View style={estilos.pantalla}>
      <View style={estilos.encabezado}>
        <Text style={estilos.saludo}>Hola, {user.name.split(" ")[0]}</Text>
        <View style={estilos.direccion}>
          <Ionicons name="location-outline" size={15} color={flashDesign.color.inkSoft} />
          <Text style={estilos.direccionTexto} numberOfLines={1}>
            {deliveryAddress || "Agregá una dirección en tu cuenta"}
          </Text>
        </View>
      </View>

      {/* Sin comercios no hay nada que buscar. */}
      {hayComercios && (
        <Pressable
          accessibilityRole="search"
          accessibilityLabel="Buscar comida, súper o farmacia"
          style={estilos.buscador}
          onPress={onSearch}
        >
          <Ionicons name="search" size={18} color={flashDesign.color.inkSoft} />
          <Text style={estilos.buscadorTexto}>Buscar comida, súper o farmacia</Text>
        </Pressable>
      )}
      {fallo && <AvisoRubros onRetry={reintentar} />}
      {/* PAG-02: invitaciones a dividir un viaje. */}
      <FareSplitInvitations />
      {ridesWithCheck.map((ride) => (
        <TripCheckBanner key={ride.id} ride={ride} />
      ))}

      {enCurso.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ver lo que está en curso"
          style={estilos.enCurso}
          onPress={onOpenActivity}
        >
          <Ionicons name={enCurso[0].icono} size={20} color="#fff" />
          <View style={estilos.enCursoCopia}>
            <Text style={estilos.enCursoTitulo}>
              {enCurso.length === 1 ? "Tenés algo en curso" : `Tenés ${enCurso.length} en curso`}
            </Text>
            <Text style={estilos.enCursoTexto} numberOfLines={1}>
              {enCurso[0].texto}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#fff" />
        </Pressable>
      )}

      <View style={estilos.grilla}>
        {servicios.map((servicio) => (
          <Pressable
            key={servicio.tipo === "vertical" ? servicio.vertical : servicio.tipo}
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${servicio.titulo}`}
            style={estilos.servicio}
            onPress={() => abrir(servicio)}
          >
            <View style={[estilos.servicioIcono, { backgroundColor: `${servicio.color}18` }]}>
              <Ionicons name={servicio.icono} size={26} color={servicio.color} />
            </View>
            <Text style={estilos.servicioTitulo}>{servicio.titulo}</Text>
          </Pressable>
        ))}
      </View>

      {viajes && (
        <View style={estilos.seccion}>
          <Pressable
            accessibilityRole="button"
            style={estilos.aDondeVas}
            onPress={() => onWhereTo(null)}
          >
            <Ionicons name="navigate" size={18} color={flashDesign.color.ride} />
            <Text style={estilos.aDondeVasTexto}>¿A dónde vas?</Text>
          </Pressable>
          {destinos.map((destino) => (
            <Pressable
              key={destino.id}
              accessibilityRole="button"
              accessibilityLabel={`Viajar a ${destino.label}`}
              style={estilos.fila}
              onPress={() => onWhereTo({ address: destino.address, point: destino.point })}
            >
              <Ionicons name="time-outline" size={18} color={flashDesign.color.inkSoft} />
              <View style={estilos.filaCopia}>
                <Text style={estilos.filaTitulo}>{destino.label}</Text>
                <Text style={estilos.filaTexto} numberOfLines={1}>
                  {destino.address}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {yaPedidos.length > 0 && (
        <View style={estilos.seccion}>
          <Text style={estilos.seccionTitulo}>Volver a pedir</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {yaPedidos.map((restaurant) => (
              <Pressable
                key={restaurant.id}
                accessibilityRole="button"
                accessibilityLabel={`Volver a pedir en ${restaurant.name}`}
                style={estilos.comercio}
                onPress={() => onOpenRestaurant(restaurant.id)}
              >
                {restaurant.image || restaurant.cover ? (
                  <Image
                    source={{ uri: restaurant.image || restaurant.cover }}
                    style={estilos.comercioImagen}
                  />
                ) : (
                  <View style={[estilos.comercioImagen, estilos.comercioSinImagen]}>
                    <Ionicons name="storefront-outline" size={22} color={flashDesign.color.muted} />
                  </View>
                )}
                <Text style={estilos.comercioNombre} numberOfLines={1}>
                  {restaurant.name}
                </Text>
                <Text style={estilos.filaTexto}>{restaurant.etaMin} min</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/** El aviso de un resumen de rubros que no se pudo leer. */
export function AvisoRubros({ onRetry }: { onRetry: () => void }) {
  return (
    <Text style={estilos.aviso} accessibilityRole="alert">
      No pudimos ver qué hay disponible en tu zona.{" "}
      <Text style={estilos.avisoAccion} accessibilityRole="button" onPress={onRetry}>
        Reintentar
      </Text>
    </Text>
  );
}

const estilos = StyleSheet.create({
  aviso: {
    marginHorizontal: flashDesign.space.md,
    color: flashDesign.color.inkSoft,
    fontSize: flashDesign.type.metadata,
  },
  avisoAccion: { color: flashDesign.color.ink, fontWeight: "800", textDecorationLine: "underline" },
  pantalla: { gap: flashDesign.space.lg, paddingBottom: flashDesign.space.lg },
  encabezado: { gap: 4, paddingHorizontal: flashDesign.space.md, paddingTop: flashDesign.space.md },
  saludo: { color: flashDesign.color.ink, fontSize: flashDesign.type.title, fontWeight: "800" },
  direccion: { flexDirection: "row", alignItems: "center", gap: 4 },
  direccionTexto: { flex: 1, color: flashDesign.color.inkSoft, fontSize: flashDesign.type.body },
  buscador: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.xs,
    minHeight: flashDesign.control.primaryHeight,
    marginHorizontal: flashDesign.space.md,
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  buscadorTexto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.body },
  enCurso: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.sm,
    marginHorizontal: flashDesign.space.md,
    padding: flashDesign.space.md,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.ink,
  },
  enCursoCopia: { flex: 1 },
  enCursoTitulo: { color: "#fff", fontSize: flashDesign.type.body, fontWeight: "800" },
  enCursoTexto: { color: "#d9d4dd", fontSize: flashDesign.type.metadata },
  grilla: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: flashDesign.space.md,
    paddingHorizontal: flashDesign.space.xs,
  },
  servicio: { width: "25%", alignItems: "center", gap: 6, minHeight: flashDesign.control.touch },
  servicioIcono: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: flashDesign.radius.card,
  },
  servicioTitulo: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.metadata,
    fontWeight: "700",
  },
  seccion: { gap: flashDesign.space.xs, paddingHorizontal: flashDesign.space.md },
  seccionTitulo: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.section,
    fontWeight: "800",
  },
  aDondeVas: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.xs,
    minHeight: flashDesign.control.primaryHeight,
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.control,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  aDondeVasTexto: { color: flashDesign.color.ink, fontSize: 16, fontWeight: "800" },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.sm,
    minHeight: flashDesign.control.touch,
  },
  filaCopia: { flex: 1 },
  filaTitulo: { color: flashDesign.color.ink, fontSize: flashDesign.type.body, fontWeight: "700" },
  filaTexto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata },
  comercio: { width: 132, gap: 4, marginRight: flashDesign.space.sm },
  comercioImagen: { width: 132, height: 84, borderRadius: flashDesign.radius.control },
  comercioSinImagen: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  comercioNombre: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.body,
    fontWeight: "700",
  },
});
