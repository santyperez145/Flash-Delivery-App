import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useServiciosDisponibles, type ServicioCliente } from "../customer-services";
import { ambitoDe, type Ambito } from "../customer-scope";
import { flashDesign } from "../design-system";
import { AvisoRubros } from "./CustomerHomeScreen";
import { styles } from "../styles";
import type { MerchantVertical } from "../types";

// Navegación del cliente (RES-01): Inicio · Servicios · Actividad · Cuenta.
//
// Es la estructura que Uber adoptó en su rediseño de 2023 para una app que
// reúne viajes, comida y envíos: el inicio como puerta, una pestaña con todos los
// servicios de la ciudad y una actividad única para lo pedido. La búsqueda vive
// en el inicio y en cada tienda, no en una pestaña propia.
//
// Desde FE-02 los rótulos siguen al ámbito, como Uber Eats y Uber: en Pedidos,
// «Explorar» y «Pedidos»; en Viajes, «Servicios» y «Actividad».

export type VistaCliente = "home" | "services" | "service" | "activity" | "account";
type IconName = ComponentProps<typeof Ionicons>["name"];

const pestanasDe = (
  ambito: Ambito,
): Array<{ vista: VistaCliente; rotulo: string; icono: IconName }> => [
  { vista: "home", rotulo: "Inicio", icono: "home-outline" },
  {
    vista: "services",
    rotulo: ambito === "pedidos" ? "Explorar" : "Servicios",
    icono: ambito === "pedidos" ? "compass-outline" : "grid-outline",
  },
  {
    vista: "activity",
    rotulo: ambito === "pedidos" ? "Pedidos" : "Actividad",
    icono: ambito === "pedidos" ? "receipt-outline" : "time-outline",
  },
  { vista: "account", rotulo: "Cuenta", icono: "person-outline" },
];

export function CustomerTabBar({
  vista,
  ambito,
  onChange,
}: {
  vista: VistaCliente;
  ambito: Ambito;
  onChange: (vista: VistaCliente) => void;
}) {
  return (
    <View style={styles.foodBottomNav} accessibilityRole="tablist">
      {pestanasDe(ambito).map((pestana) => {
        // Dentro de un servicio se está «en» Inicio: de ahí se llegó.
        const activa = vista === pestana.vista || (vista === "service" && pestana.vista === "home");
        return (
          <Pressable
            key={pestana.vista}
            accessibilityRole="tab"
            accessibilityState={{ selected: activa }}
            onPress={() => onChange(pestana.vista)}
            style={styles.foodBottomItem}
          >
            <Ionicons name={pestana.icono} size={21} color={activa ? "#ff6a21" : "#9c989f"} />
            <Text style={[styles.foodBottomLabel, activa && styles.foodBottomLabelActive]}>
              {pestana.rotulo}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Dentro de un servicio: volver al inicio, como en cualquier app de varios servicios. */
export function ServiceBackBar({ titulo, onBack }: { titulo: string; onBack: () => void }) {
  return (
    <View style={estilos.volver}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver al inicio"
        hitSlop={10}
        onPress={onBack}
        style={estilos.volverBoton}
      >
        <Ionicons name="chevron-back" size={22} color={flashDesign.color.ink} />
      </Pressable>
      <Text style={estilos.volverTitulo}>{titulo}</Text>
    </View>
  );
}

/**
 * La pestaña Servicios: lo disponible en la ciudad, con qué es cada cosa. En Pedidos
 * («Explorar») son los rubros; en Viajes, viajes y envíos.
 */
export function CustomerServicesScreen({
  ambito,
  onOpenRide,
  onOpenVertical,
  onOpenShipment,
}: {
  ambito: Ambito;
  onOpenRide: () => void;
  onOpenVertical: (vertical: MerchantVertical) => void;
  onOpenShipment: () => void;
}) {
  const disponibles = useServiciosDisponibles();
  const { cargando, reintentar } = disponibles;
  const servicios = disponibles.servicios.filter((servicio) => ambitoDe(servicio) === ambito);
  // El resumen de rubros sólo importa en Pedidos.
  const fallo = disponibles.fallo && ambito === "pedidos";
  const abrir = (servicio: ServicioCliente) =>
    servicio.tipo === "ride"
      ? onOpenRide()
      : servicio.tipo === "shipment"
        ? onOpenShipment()
        : onOpenVertical(servicio.vertical);
  return (
    <View style={estilos.servicios}>
      <Text style={estilos.titulo}>{ambito === "pedidos" ? "Explorar" : "Servicios"}</Text>
      {fallo && <AvisoRubros onRetry={reintentar} />}
      <Text style={estilos.subtitulo}>
        {cargando
          ? "Buscando lo disponible en tu zona…"
          : servicios.length === 0
            ? ambito === "pedidos"
              ? "Todavía no hay comercios en tu zona."
              : "Los viajes y envíos todavía no están disponibles en tu zona."
            : ambito === "pedidos"
              ? "Comida, súper, farmacia y más en tu zona"
              : "Viajá o mandá un paquete en el día"}
      </Text>
      {servicios.map((servicio) => (
        <Pressable
          key={servicio.tipo === "vertical" ? servicio.vertical : servicio.tipo}
          accessibilityRole="button"
          accessibilityLabel={`Abrir ${servicio.titulo}`}
          style={estilos.servicio}
          onPress={() => abrir(servicio)}
        >
          <View style={[estilos.icono, { backgroundColor: `${servicio.color}18` }]}>
            <Ionicons name={servicio.icono} size={24} color={servicio.color} />
          </View>
          <View style={estilos.copia}>
            <Text style={estilos.servicioTitulo}>{servicio.titulo}</Text>
            <Text style={estilos.servicioDetalle}>
              {servicio.tipo === "vertical" && servicio.comercios > 0
                ? `${servicio.detalle} · ${servicio.comercios} ${servicio.comercios === 1 ? "comercio" : "comercios"}`
                : servicio.detalle}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={flashDesign.color.muted} />
        </Pressable>
      ))}
    </View>
  );
}

const estilos = StyleSheet.create({
  volver: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.xs,
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.sm,
  },
  volverBoton: {
    width: flashDesign.control.touch,
    height: flashDesign.control.touch,
    alignItems: "center",
    justifyContent: "center",
  },
  volverTitulo: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.section,
    fontWeight: "800",
  },
  servicios: { gap: flashDesign.space.sm, padding: flashDesign.space.md },
  titulo: { color: flashDesign.color.ink, fontSize: flashDesign.type.title, fontWeight: "800" },
  subtitulo: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.body },
  servicio: {
    flexDirection: "row",
    alignItems: "center",
    gap: flashDesign.space.sm,
    minHeight: 72,
    padding: flashDesign.space.sm,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  icono: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: flashDesign.radius.control,
  },
  copia: { flex: 1 },
  servicioTitulo: { color: flashDesign.color.ink, fontSize: 16, fontWeight: "800" },
  servicioDetalle: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata },
});
