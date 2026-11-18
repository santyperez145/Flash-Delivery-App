import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "./api";
import { flashDesign } from "./design-system";
import type { Order } from "./types";

// Código de entrega (SEG-03), como el PIN de Uber Eats. Un pedido de valor alto, o
// de quien tuvo un reclamo aprobado, se entrega con un código: el cliente lo ve acá
// y quien reparte lo ingresa antes de cerrarlo.

const pendiente = (order: Order) =>
  Boolean(order.deliveryCode?.required && !order.deliveryCode.verified);

/** Lo que ve el cliente en el seguimiento: el código para dárselo a quien reparte. */
export function OrderDeliveryCodeView({ order }: { order: Order }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const activo = pendiente(order) && !["delivered", "cancelled"].includes(order.status);
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    setError(null);
    api
      .getOrderDeliveryCode(order.id)
      .then((respuesta) => vigente && setCodigo(respuesta.deliveryCode))
      .catch(
        (requestError) =>
          vigente &&
          setError(requestError instanceof Error ? requestError.message : "No se pudo leer"),
      );
    return () => {
      vigente = false;
    };
  }, [activo, order.id, intento]);
  // Si la lectura falló (sin conexión, por ejemplo), se reintenta sola cada 10 s:
  // quien reparte está esperando el código en la puerta.
  useEffect(() => {
    if (!activo || !error) return;
    const timer = setTimeout(() => setIntento((n) => n + 1), 10000);
    return () => clearTimeout(timer);
  }, [activo, error]);
  if (!activo) return null;
  return (
    <View style={estilos.caja} accessibilityLabel="Código de entrega">
      <Ionicons name="key-outline" size={22} color={flashDesign.color.ink} />
      <View style={estilos.cuerpo}>
        <Text style={estilos.titulo}>Código de entrega</Text>
        <Text style={estilos.texto}>
          Dáselo a quien te entregue el pedido. No lo compartas antes de recibirlo.
        </Text>
        {codigo ? <Text style={estilos.codigo}>{codigo}</Text> : null}
        {error ? (
          <Pressable accessibilityRole="button" onPress={() => setIntento((n) => n + 1)}>
            <Text style={estilos.error}>{error} · Reintentar</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Lo que ve quien reparte: ingresa el código y recién ahí cierra el pedido. */
export function OrderDeliveryCodeEntry({
  order,
  busy,
  onVerifiedDeliver,
}: {
  order: Order;
  busy: boolean;
  onVerifiedDeliver: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  if (!pendiente(order) || order.status !== "delivering") return null;
  return (
    <View style={estilos.caja}>
      <Ionicons name="key-outline" size={22} color={flashDesign.color.ink} />
      <View style={estilos.cuerpo}>
        <Text style={estilos.titulo}>Pedí el código de entrega</Text>
        <Text style={estilos.texto}>
          Este pedido se entrega con el código que tiene el cliente.
        </Text>
        <TextInput
          value={pin}
          onChangeText={(texto) => setPin(texto.replace(/\D/g, "").slice(0, 4))}
          keyboardType="numeric"
          secureTextEntry
          maxLength={4}
          placeholder="••••"
          accessibilityLabel="Código de entrega"
          style={estilos.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy || pin.length !== 4}
          onPress={() => {
            onVerifiedDeliver(pin);
            setPin("");
          }}
          style={[estilos.boton, (busy || pin.length !== 4) && estilos.apagado]}
        >
          <Text style={estilos.botonTexto}>Verificar y entregar</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const faltaCodigoDeEntrega = (order: Order) =>
  pendiente(order) && order.status === "delivering";

const estilos = StyleSheet.create({
  caja: {
    flexDirection: "row",
    gap: flashDesign.space.sm,
    padding: flashDesign.space.md,
    marginBottom: flashDesign.space.sm,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  cuerpo: { flex: 1, gap: flashDesign.space.xxs },
  titulo: { color: flashDesign.color.ink, fontSize: 16, fontWeight: "800" },
  texto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.body },
  codigo: {
    marginTop: 6,
    color: flashDesign.color.ink,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 8,
  },
  input: {
    minHeight: flashDesign.control.touch,
    marginTop: 6,
    paddingHorizontal: flashDesign.space.sm,
    color: flashDesign.color.ink,
    fontSize: 20,
    letterSpacing: 6,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    borderRadius: flashDesign.radius.control,
  },
  boton: {
    minHeight: flashDesign.control.touch,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.ink,
  },
  apagado: { opacity: 0.45 },
  botonTexto: { color: "#fff", fontWeight: "800" },
  error: { color: flashDesign.color.danger, fontSize: flashDesign.type.metadata },
});
