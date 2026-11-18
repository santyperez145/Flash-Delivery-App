import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { flashDesign } from "./design-system";

// Pausa del comercio por un tiempo y con motivo (RES-07).
//
// Como en Uber Eats Orders: el local elige por qué pausa y cuánto tiempo, y la
// pausa vence sola. Antes había un único interruptor, y una pausa por un pico de
// demanda quedaba hasta que alguien se acordara de volver a abrir. El cierre sin
// fecha sigue existiendo, para el día que el local no abre.

export type MotivoPausa = "high_demand" | "staff" | "kitchen" | "other";

export const MOTIVOS: Array<{ id: MotivoPausa; rotulo: string }> = [
  { id: "high_demand", rotulo: "Mucha demanda" },
  { id: "staff", rotulo: "Falta personal" },
  { id: "kitchen", rotulo: "Problema en cocina" },
  { id: "other", rotulo: "Otro motivo" },
];
const DURACIONES = [
  { minutos: 15, rotulo: "15 min" },
  { minutos: 30, rotulo: "30 min" },
  { minutos: 60, rotulo: "1 h" },
  { minutos: 120, rotulo: "2 h" },
];

export const rotuloMotivo = (motivo: string | null | undefined) =>
  MOTIVOS.find((entry) => entry.id === motivo)?.rotulo ?? "";

export function MerchantPause({
  pausedUntil,
  pauseReason,
  manualOpen,
  timezone,
  busy,
  onPause,
  onToggleOpen,
}: {
  pausedUntil: string | null;
  pauseReason: string | null;
  manualOpen: boolean;
  timezone: string;
  busy: boolean;
  /** 0 reanuda. */
  onPause: (minutes: number, reason?: MotivoPausa) => void;
  onToggleOpen: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoPausa | null>(null);
  const hora = (iso: string) =>
    new Intl.DateTimeFormat("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(iso));

  if (!manualOpen)
    return <Boton rotulo="Abrir pedidos" principal disabled={busy} onPress={onToggleOpen} />;

  if (pausedUntil)
    return (
      <View style={estilos.caja}>
        <Text style={estilos.estado}>
          Pausado hasta las {hora(pausedUntil)}
          {pauseReason ? ` · ${rotuloMotivo(pauseReason)}` : ""}
        </Text>
        <Text style={estilos.ayuda}>Vuelve a recibir pedidos solo, a esa hora.</Text>
        <Boton rotulo="Reanudar ahora" principal disabled={busy} onPress={() => onPause(0)} />
        {/* Cerrar por el día no puede exigir reanudar antes: la pausa reabriría sola. */}
        <Pressable accessibilityRole="button" disabled={busy} onPress={onToggleOpen}>
          <Text style={estilos.cerrar}>Cerrar sin fecha</Text>
        </Pressable>
      </View>
    );

  return (
    <View style={estilos.caja}>
      <Text style={estilos.titulo}>Pausar pedidos</Text>
      <Text style={estilos.ayuda}>Elegí el motivo y por cuánto tiempo. Se reanuda solo.</Text>
      <View style={estilos.fila}>
        {MOTIVOS.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: motivo === entry.id }}
            style={[estilos.chip, motivo === entry.id && estilos.chipActivo]}
            onPress={() => setMotivo(entry.id)}
          >
            <Text style={[estilos.chipTexto, motivo === entry.id && estilos.chipTextoActivo]}>
              {entry.rotulo}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={estilos.fila}>
        {DURACIONES.map((duracion) => (
          <Boton
            key={duracion.minutos}
            rotulo={duracion.rotulo}
            disabled={busy || !motivo}
            onPress={() => motivo && onPause(duracion.minutos, motivo)}
          />
        ))}
      </View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onToggleOpen}>
        <Text style={estilos.cerrar}>Cerrar sin fecha</Text>
      </Pressable>
    </View>
  );
}

function Boton({
  rotulo,
  principal = false,
  disabled,
  onPress,
}: {
  rotulo: string;
  principal?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[estilos.boton, principal && estilos.botonPrincipal, disabled && estilos.botonApagado]}
    >
      <Text style={[estilos.botonTexto, principal && estilos.botonTextoPrincipal]}>{rotulo}</Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  caja: {
    gap: flashDesign.space.xs,
    padding: flashDesign.space.md,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  titulo: { color: flashDesign.color.ink, fontSize: 16, fontWeight: "800" },
  estado: { color: flashDesign.color.ink, fontSize: 16, fontWeight: "800" },
  ayuda: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: flashDesign.space.xs },
  chip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: flashDesign.space.sm,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  chipActivo: { backgroundColor: flashDesign.color.ink },
  chipTexto: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.metadata,
    fontWeight: "700",
  },
  chipTextoActivo: { color: "#fff" },
  boton: {
    minHeight: flashDesign.control.touch,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: flashDesign.space.sm,
    borderRadius: flashDesign.radius.control,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  botonPrincipal: { backgroundColor: flashDesign.color.ink, borderColor: flashDesign.color.ink },
  botonApagado: { opacity: 0.45 },
  botonTexto: { color: flashDesign.color.ink, fontWeight: "800" },
  botonTextoPrincipal: { color: "#fff" },
  cerrar: {
    color: flashDesign.color.danger,
    fontSize: flashDesign.type.metadata,
    fontWeight: "700",
    paddingVertical: flashDesign.space.xs,
  },
});
