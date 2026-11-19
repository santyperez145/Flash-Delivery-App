import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { api } from "../api";
import { useServiciosDisponibles, type ServicioCliente } from "../customer-services";
import { ambitoDe, type Ambito } from "../customer-scope";
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
//
// Desde FE-02 hay dos inicios, como Uber Eats y Uber: **Pedidos** (buscador, rubros,
// «Volver a pedir» y comercios cerca) y **Viajes** («¿A dónde vas?», lugares
// recientes, viaje y envíos). Lo que está en curso del otro ámbito se avisa con un
// toque para ir, y el control del viaje (SEG-01) se ve en los dos.

type Destino = { address: string; point: GeoPoint | null };

export function CustomerHomeScreen({
  ambito,
  onChangeAmbito,
  user,
  deliveryAddress,
  restaurants,
  orders,
  activeOrders,
  activeRides,
  ridesWithCheck,
  onWalletChanged,
  activeShipments,
  onSearch,
  onWhereTo,
  onOpenVertical,
  onOpenShipment,
  onOpenRestaurant,
  onOpenActivity,
}: {
  /** FE-02: el inicio de Pedidos o el de Viajes. */
  ambito: Ambito;
  /** Para ir al otro ámbito cuando ahí hay algo en curso. */
  onChangeAmbito: (ambito: Ambito) => void;
  user: User;
  deliveryAddress: string;
  restaurants: Restaurant[];
  /** Los pedidos de la persona, en curso y terminados. */
  orders: Order[];
  activeOrders: Order[];
  activeRides: Ride[];
  /** SEG-01: viajes con un aviso del control del viaje sin contestar. */
  ridesWithCheck: Ride[];
  /** PAG-02: después de pagar una parte de un viaje, se vuelve a leer la cuenta. */
  onWalletChanged: () => void;
  activeShipments: Shipment[];
  onSearch: () => void;
  onWhereTo: (destino: Destino | null) => void;
  onOpenVertical: (vertical: MerchantVertical) => void;
  onOpenShipment: () => void;
  onOpenRestaurant: (restaurantId: string) => void;
  onOpenActivity: () => void;
}) {
  const disponibles = useServiciosDisponibles();
  const { fallo, reintentar, hayComercios, cargando } = disponibles;
  const pedidos = ambito === "pedidos";
  const servicios = disponibles.servicios.filter((servicio) => ambitoDe(servicio) === ambito);
  const viajes = disponibles.servicios.some((servicio) => servicio.tipo === "ride");
  const [destinos, setDestinos] = useState<RideDestination[]>([]);
  useEffect(() => {
    // Con los viajes apagados, los destinos de antes no quedan como acceso al servicio.
    if (!viajes) setDestinos([]);
    if (!viajes || pedidos) return;
    let vigente = true;
    api
      .getRideDestinations()
      .then((respuesta) => vigente && setDestinos(respuesta.destinations.slice(0, 3)))
      .catch(() => vigente && setDestinos([]));
    return () => {
      vigente = false;
    };
  }, [viajes, pedidos, user.id]);

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
  // «Restaurantes cerca tuyo»: sólo abiertos, de los que llegan antes. Uno cerrado
  // abriría la tienda y dejaría armar un pedido que el servidor rechaza. Sólo
  // restaurantes, para que «Ver todos» abra lo mismo que se ve; los demás rubros
  // tienen su acceso en la grilla.
  const cerca = restaurants
    .filter(
      (restaurant) => restaurant.open && (restaurant.vertical ?? "restaurant") === "restaurant",
    )
    .sort((a, b) => a.etaMin - b.etaMin)
    .slice(0, 8);

  const enPedidos = activeOrders.map((order) => ({
    id: order.id,
    icono: "fast-food" as const,
    texto: `Pedido de ${restaurants.find((entry) => entry.id === order.restaurantId)?.name ?? "tu comercio"}`,
  }));
  const enViajes = [
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
  const enCurso = pedidos ? enPedidos : enViajes;
  // Lo que está en curso del otro lado no se esconde: se avisa, con un toque para ir.
  const delOtroLado = pedidos ? enViajes : enPedidos;

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
        {pedidos ? (
          <View style={estilos.direccion}>
            <Ionicons name="location-outline" size={15} color={flashDesign.color.inkSoft} />
            <Text style={estilos.direccionTexto} numberOfLines={1}>
              {deliveryAddress || "Agregá una dirección en tu cuenta"}
            </Text>
          </View>
        ) : (
          <Text style={estilos.direccionTexto}>¿A dónde vamos hoy?</Text>
        )}
      </View>

      {/* SEG-01: el aviso del control del viaje se ve en los dos ámbitos. Es de seguridad. */}
      {ridesWithCheck.map((ride) => (
        <TripCheckBanner key={ride.id} ride={ride} />
      ))}

      {/* Sin comercios no hay nada que buscar. */}
      {pedidos && hayComercios && (
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
      {!pedidos && viajes && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="¿A dónde vas?"
          style={estilos.aDondeVasGrande}
          onPress={() => onWhereTo(null)}
        >
          <Ionicons name="navigate" size={20} color={flashDesign.color.ride} />
          <Text style={estilos.aDondeVasTexto}>¿A dónde vas?</Text>
          <View style={estilos.ahora}>
            <Ionicons name="time-outline" size={14} color={flashDesign.color.ink} />
            <Text style={estilos.ahoraTexto}>Ahora</Text>
          </View>
        </Pressable>
      )}
      {fallo && <AvisoRubros onRetry={reintentar} />}
      {/* FE-03: sin comercios en la zona, se dice qué pasa en lugar de una pantalla vacía. */}
      {pedidos && !cargando && !fallo && !hayComercios && !restaurants.length && (
        <View style={estilos.sinComercios} accessibilityRole="summary">
          <Ionicons name="storefront-outline" size={30} color={flashDesign.color.inkSoft} />
          <Text style={estilos.sinComerciosTitulo}>Todavía no hay comercios en tu zona</Text>
          <Text style={estilos.sinComerciosTexto}>
            Cuando se sumen comercios cerca tuyo, los vas a ver acá. Mientras tanto, podés pedir un
            viaje o mandar un envío.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ir a Viajes"
            style={estilos.otroLado}
            onPress={() => onChangeAmbito("viajes")}
          >
            <Ionicons name="car-sport-outline" size={16} color={flashDesign.color.ink} />
            <Text style={estilos.otroLadoTexto}>Viajes y envíos</Text>
            <Text style={estilos.otroLadoAccion}>Ir a Viajes</Text>
          </Pressable>
        </View>
      )}
      {/* PAG-02: invitaciones a dividir un viaje. */}
      {!pedidos && <FareSplitInvitations onPagado={onWalletChanged} />}

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
      {delOtroLado.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pedidos ? "Ir a Viajes" : "Ir a Pedidos"}
          style={estilos.otroLado}
          onPress={() => onChangeAmbito(pedidos ? "viajes" : "pedidos")}
        >
          <Ionicons name={delOtroLado[0].icono} size={16} color={flashDesign.color.ink} />
          <Text style={estilos.otroLadoTexto} numberOfLines={1}>
            {delOtroLado[0].texto} en curso
          </Text>
          <Text style={estilos.otroLadoAccion}>{pedidos ? "Ir a Viajes" : "Ir a Pedidos"}</Text>
        </Pressable>
      )}

      {/* Con un solo rubro la grilla no elige nada: se va directo a los comercios. */}
      {(pedidos ? servicios.length > 1 : servicios.length > 0) && (
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
      )}

      {!pedidos && viajes && destinos.length > 0 && (
        <View style={estilos.seccion}>
          <Text style={estilos.seccionTitulo}>Lugares recientes</Text>
          {destinos.map((destino) => (
            <Pressable
              key={destino.id}
              accessibilityRole="button"
              accessibilityLabel={`Viajar a ${destino.label}`}
              style={estilos.fila}
              onPress={() => onWhereTo({ address: destino.address, point: destino.point })}
            >
              <View style={estilos.filaIcono}>
                <Ionicons name="time-outline" size={18} color={flashDesign.color.ink} />
              </View>
              <View style={estilos.filaCopia}>
                <Text style={estilos.filaTitulo}>{destino.label}</Text>
                <Text style={estilos.filaTexto} numberOfLines={1}>
                  {destino.address}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={flashDesign.color.muted} />
            </Pressable>
          ))}
        </View>
      )}
      {!pedidos && !viajes && servicios.length === 0 && (
        <Text style={estilos.aviso}>Los viajes todavía no están disponibles en tu zona.</Text>
      )}

      {pedidos && yaPedidos.length > 0 && (
        <View style={estilos.seccion}>
          <Text style={estilos.seccionTitulo}>Volver a pedir</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {yaPedidos.map((restaurant) => (
              <Comercio
                key={restaurant.id}
                restaurant={restaurant}
                etiqueta={`Volver a pedir en ${restaurant.name}`}
                onPress={() => onOpenRestaurant(restaurant.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}
      {pedidos && cerca.length > 0 && (
        <View style={estilos.seccion}>
          <View style={estilos.seccionCabecera}>
            <Text style={estilos.seccionTitulo}>Restaurantes cerca tuyo</Text>
            <Text
              accessibilityRole="button"
              style={estilos.verTodos}
              onPress={() => onOpenVertical("restaurant")}
            >
              Ver todos
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {cerca.map((restaurant) => (
              <Comercio
                key={restaurant.id}
                restaurant={restaurant}
                etiqueta={`Abrir ${restaurant.name}`}
                onPress={() => onOpenRestaurant(restaurant.id)}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

/** La tarjeta de un comercio en las filas del inicio. Uno cerrado lo dice. */
function Comercio({
  restaurant,
  etiqueta,
  onPress,
}: {
  restaurant: Restaurant;
  etiqueta: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={estilos.comercio}
      onPress={onPress}
    >
      {restaurant.image || restaurant.cover ? (
        <Image
          source={{ uri: restaurant.image || restaurant.cover }}
          style={[estilos.comercioImagen, !restaurant.open && estilos.comercioCerrado]}
        />
      ) : (
        <View style={[estilos.comercioImagen, estilos.comercioSinImagen]}>
          <Ionicons name="storefront-outline" size={22} color={flashDesign.color.muted} />
        </View>
      )}
      <Text style={estilos.comercioNombre} numberOfLines={1}>
        {restaurant.name}
      </Text>
      <Text style={estilos.filaTexto}>
        {restaurant.open ? `${restaurant.etaMin} min` : "Cerrado ahora"}
      </Text>
    </Pressable>
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
  seccionCabecera: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  verTodos: { color: flashDesign.color.ink, fontWeight: "800", textDecorationLine: "underline" },
  aDondeVasGrande: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.sm,
    minHeight: 60,
    marginHorizontal: flashDesign.space.md,
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  ahora: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.surface,
  },
  ahoraTexto: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.metadata,
    fontWeight: "800",
  },
  otroLado: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.xs,
    marginHorizontal: flashDesign.space.md,
    paddingHorizontal: flashDesign.space.sm,
    minHeight: flashDesign.control.touch,
    borderRadius: flashDesign.radius.control,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    backgroundColor: flashDesign.color.surface,
  },
  sinComercios: {
    alignItems: "center",
    gap: flashDesign.space.sm,
    marginHorizontal: flashDesign.space.md,
    paddingVertical: flashDesign.space.lg,
  },
  sinComerciosTitulo: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.section,
    fontWeight: "900",
    textAlign: "center",
  },
  sinComerciosTexto: {
    color: flashDesign.color.inkSoft,
    fontSize: flashDesign.type.body,
    lineHeight: 21,
    textAlign: "center",
  },
  otroLadoTexto: { flex: 1, color: flashDesign.color.ink, fontSize: flashDesign.type.metadata },
  otroLadoAccion: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.metadata,
    fontWeight: "800",
  },
  filaIcono: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  comercioCerrado: { opacity: 0.45 },
});
