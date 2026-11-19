import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "./api";
import { flashDesign } from "./design-system";
import { money } from "./format";
import type { FareSplit, FareSplitInvitation, Ride } from "./types";

// Dividir la tarifa de un viaje (PAG-02), como Uber. Quien pidió un viaje pagado con
// Flash Wallet invita por email a otras cuentas Flash; cada una que acepta paga su
// parte desde su Wallet. Mismo comportamiento que la web.

const estadoTexto: Record<FareSplit["status"], string> = {
  invited: "Invitado",
  accepted: "Aceptó",
  declined: "Rechazó",
  cancelled: "Cancelado",
};

/** En el seguimiento del viaje, para quien lo pidió. */
export function FareSplitPanel({ ride }: { ride: Ride }) {
  const [splits, setSplits] = useState<FareSplit[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const activo =
    ride.paymentMethod === "Flash Wallet" && !["completed", "cancelled"].includes(ride.status);
  const cargar = useCallback(
    () =>
      api
        .getRideFareSplits(ride.id)
        .then((respuesta) => {
          setSplits(respuesta.splits);
          setFallo(false);
        })
        .catch(() => setFallo(true)),
    [ride.id],
  );
  useEffect(() => {
    if (!activo) return;
    void cargar();
    const timer = setInterval(() => void cargar(), 15000);
    return () => clearInterval(timer);
  }, [activo, cargar]);
  if (!activo) return null;
  const aceptados = splits.filter((split) => split.status === "accepted").length;
  const invitar = async () => {
    setBusy(true);
    setAviso(null);
    try {
      await api.inviteToSplitFare(ride.id, email.trim());
      setEmail("");
      setAviso("Si ese email tiene cuenta Flash, le llega la invitación");
      await cargar();
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo invitar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={estilos.caja} accessibilityLabel="Dividir la tarifa">
      <View style={estilos.cabecera}>
        <Ionicons name="people-outline" size={20} color={flashDesign.color.ink} />
        <View style={estilos.cuerpo}>
          <Text style={estilos.titulo}>Dividir la tarifa</Text>
          <Text style={estilos.texto}>
            {aceptados > 0
              ? `Cada uno paga ${money.format(Math.floor((ride.fare * 100) / (aceptados + 1)) / 100)}`
              : "Invitá a quien viaja con vos"}
          </Text>
        </View>
      </View>
      {splits.map((split) => (
        <View key={split.id} style={estilos.fila}>
          <Text style={estilos.nombre}>{split.name}</Text>
          <Text style={estilos.texto}>{estadoTexto[split.status]}</Text>
        </View>
      ))}
      {fallo ? (
        <Pressable accessibilityRole="button" onPress={() => void cargar()}>
          <Text style={estilos.error}>No pudimos ver con quién dividís · Reintentar</Text>
        </Pressable>
      ) : null}
      <View style={estilos.fila}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email de su cuenta Flash"
          accessibilityLabel="Email de su cuenta Flash"
          keyboardType="email-address"
          autoCapitalize="none"
          style={estilos.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || !email.trim()}
          onPress={() => void invitar()}
          style={[estilos.boton, (busy || !email.trim()) && estilos.apagado]}
        >
          <Text style={estilos.botonTexto}>Invitar</Text>
        </Pressable>
      </View>
      {aviso ? <Text style={estilos.texto}>{aviso}</Text> : null}
    </View>
  );
}

/** En el inicio, para quien recibió una invitación. */
export function FareSplitInvitations({
  onPagado,
}: {
  /** Después de pagar una parte: la Wallet cambió y la cuenta se vuelve a leer. */
  onPagado?: () => void;
} = {}) {
  const [invitaciones, setInvitaciones] = useState<FareSplitInvitation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const cargar = useCallback(
    () =>
      api
        .getFareSplitInvitations()
        .then((respuesta) => {
          setInvitaciones(respuesta.invitations);
          setFallo(false);
        })
        .catch(() => setFallo(true)),
    [],
  );
  // Una invitación puede llegar con el inicio abierto: se relee cada 30 segundos.
  useEffect(() => {
    void cargar();
    const timer = setInterval(() => void cargar(), 30000);
    return () => clearInterval(timer);
  }, [cargar]);
  if (fallo)
    return (
      <Pressable accessibilityRole="button" onPress={() => void cargar()}>
        <Text style={estilos.error}>
          No pudimos ver si te invitaron a dividir un viaje · Reintentar
        </Text>
      </Pressable>
    );
  if (!invitaciones.length && !aviso) return null;
  const responder = async (invitacion: FareSplitInvitation, accept: boolean) => {
    setBusy(invitacion.id);
    setAviso(null);
    try {
      const respuesta = await api.respondToFareSplit(invitacion.id, accept);
      if (accept) onPagado?.();
      setAviso(
        accept && respuesta.split.share !== undefined
          ? `Listo: pagaste ${money.format(respuesta.split.share)} con tu Flash Wallet`
          : "Invitación rechazada",
      );
      await cargar();
    } catch (error) {
      setAviso(error instanceof Error ? error.message : "No se pudo responder");
    } finally {
      setBusy(null);
    }
  };
  return (
    <View>
      {invitaciones.map((invitacion) => (
        <View key={invitacion.id} style={estilos.caja}>
          <View style={estilos.cabecera}>
            <Ionicons name="people-outline" size={20} color={flashDesign.color.ink} />
            <View style={estilos.cuerpo}>
              <Text style={estilos.titulo}>
                {invitacion.inviterName} quiere dividir el viaje a {invitacion.destination}
              </Text>
              <Text style={estilos.texto}>
                Tu parte: {money.format(invitacion.share)}, desde tu Flash Wallet
              </Text>
            </View>
          </View>
          <View style={estilos.fila}>
            <Pressable
              accessibilityRole="button"
              disabled={busy === invitacion.id}
              onPress={() => void responder(invitacion, false)}
              style={[estilos.boton, estilos.botonSecundario]}
            >
              <Text style={estilos.botonTextoSecundario}>Rechazar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy === invitacion.id}
              onPress={() => void responder(invitacion, true)}
              style={estilos.boton}
            >
              <Text style={estilos.botonTexto}>Aceptar y pagar</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {aviso ? <Text style={estilos.texto}>{aviso}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: {
    gap: flashDesign.space.xs,
    padding: flashDesign.space.md,
    marginBottom: flashDesign.space.sm,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  cabecera: { flexDirection: "row", gap: flashDesign.space.sm, alignItems: "flex-start" },
  cuerpo: { flex: 1, gap: 2 },
  titulo: { color: flashDesign.color.ink, fontSize: 15, fontWeight: "800" },
  texto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata },
  nombre: { color: flashDesign.color.ink, fontWeight: "700" },
  fila: {
    flexDirection: "row",
    gap: flashDesign.space.xs,
    alignItems: "center",
    justifyContent: "space-between",
  },
  input: {
    flex: 1,
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.sm,
    color: flashDesign.color.ink,
    backgroundColor: flashDesign.color.canvas,
    borderRadius: flashDesign.radius.control,
  },
  boton: {
    minHeight: flashDesign.control.touch,
    justifyContent: "center",
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.ink,
  },
  botonSecundario: { backgroundColor: flashDesign.color.surfaceMuted },
  apagado: { opacity: 0.45 },
  botonTexto: { color: "#fff", fontWeight: "800" },
  botonTextoSecundario: { color: flashDesign.color.ink, fontWeight: "800" },
  error: { color: flashDesign.color.danger, fontSize: flashDesign.type.metadata },
});
