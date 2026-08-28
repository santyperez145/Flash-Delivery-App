// Pedidos grupales en el móvil (ticket GTM-001, cuarto hueco comercial).
//
// Es donde el pedido grupal ocurre de verdad: alguien comparte el código por
// chat desde el teléfono y el resto se suma desde el suyo. Tener esto sólo en la
// web habría sido construir la capacidad y no exponerla donde se usa.
//
// **Cada persona ve lo que pidió cada una, y el anfitrión ve el total.** Esa
// transparencia es la función: en un pedido de oficina lo que se discute después
// no es la comida, es quién pidió qué y cuánto salió.
import { useCallback, useEffect, useState } from "react";
import { Pressable, Share, Text, TextInput, View } from "react-native";

import { api } from "./api";
import { money } from "./format";
import { styles } from "./styles";
import type { GroupOrder, MobileCartLine } from "./types";

const ETIQUETA_ESTADO: Record<GroupOrder["status"], string> = {
  open: "Abierto",
  locked: "Cerrado para sumar",
  placed: "Pedido confirmado",
  cancelled: "Cancelado",
};

export function GroupOrderPanel({
  restaurantId,
  cart,
  userId,
  onCheckoutGroup,
  busy,
}: {
  /** Restaurante abierto, si lo hay: es desde donde se puede abrir un grupo. */
  restaurantId: string | null;
  /** Carrito propio, para volcarlo al grupo sin volver a elegir todo. */
  cart: MobileCartLine[];
  userId: string | null;
  onCheckoutGroup: (group: GroupOrder) => void;
  busy: boolean;
}) {
  const [groups, setGroups] = useState<GroupOrder[]>([]);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setGroups((await api.getGroupOrders()).groups);
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar los grupos");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ejecutar = async (accion: () => Promise<unknown>) => {
    setOcupado(true);
    setError("");
    try {
      await accion();
      await cargar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo completar la operación");
    } finally {
      setOcupado(false);
    }
  };

  const bloqueado = busy || ocupado;

  const boton = (
    clave: string,
    texto: string,
    alPresionar: () => void,
    principal = false,
    inhabilitado = false,
  ) => (
    <Pressable
      key={clave}
      accessibilityRole="button"
      disabled={bloqueado || inhabilitado}
      onPress={alPresionar}
      style={({ pressed }) => [
        principal ? styles.suscripcionAlta : styles.suscripcionBaja,
        (pressed || bloqueado || inhabilitado) && styles.disabledButton,
      ]}
    >
      <Text style={principal ? styles.suscripcionAltaText : styles.suscripcionBajaText}>
        {texto}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.suscripcionCard}>
      <Text style={styles.foodRestaurantTitle}>Pedido grupal</Text>
      <Text style={styles.cardText}>Cada uno agrega lo suyo y una sola persona paga.</Text>

      {restaurantId
        ? boton("abrir", "Abrir grupo en este restaurante", () =>
            ejecutar(() => api.createGroupOrder({ restaurantId })),
          )
        : null}

      <View style={styles.grupoSumarse}>
        <TextInput
          accessibilityLabel="Código para sumarme a un pedido grupal"
          autoCapitalize="characters"
          maxLength={6}
          placeholder="ABC123"
          editable={!bloqueado}
          value={codigo}
          // Se normaliza al escribir: el código se dicta en voz alta y se
          // escribe como salga; rechazarlo por minúsculas sería inútil.
          onChangeText={(texto) => setCodigo(texto.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          style={styles.grupoCodigoInput}
        />
        {boton(
          "sumarme",
          "Sumarme",
          () => ejecutar(async () => (await api.joinGroupOrder(codigo), setCodigo(""))),
          false,
          codigo.length !== 6,
        )}
      </View>

      {error ? <Text style={styles.suscripcionError}>{error}</Text> : null}
      {groups.length === 0 ? (
        <Text style={styles.cardText}>No tenés pedidos grupales abiertos.</Text>
      ) : null}

      {groups.map((group) => {
        const soyAnfitrion = group.hostId === userId;
        const miParte = group.participants.find((persona) => persona.userId === userId);
        return (
          <View key={group.id} style={styles.grupoTarjeta}>
            <View style={styles.suscripcionHeader}>
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>{group.restaurantName}</Text>
                <Text style={styles.cardText}>
                  {ETIQUETA_ESTADO[group.status]} · {group.participants.length} personas
                  {group.spendLimit !== null ? ` · tope ${money.format(group.spendLimit)}` : ""}
                </Text>
              </View>
            </View>

            {/* Compartir por el diálogo del sistema, que es como el código llega
                al chat donde está la gente. Mostrarlo sólo mientras sirve: en un
                grupo cerrado invita a compartirlo y a que alguien reciba un «ya
                está cerrado» sin entender por qué. */}
            {group.status === "open" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Compartir el código ${group.joinCode}`}
                disabled={bloqueado}
                onPress={() =>
                  void Share.share({
                    message: `Sumate a mi pedido de ${group.restaurantName} en Flash con el código ${group.joinCode}`,
                  })
                }
                style={({ pressed }) => [styles.grupoCodigo, pressed && styles.disabledButton]}
              >
                <Text style={styles.grupoCodigoTexto}>{group.joinCode}</Text>
                <Text style={styles.cardText}>Tocá para compartir</Text>
              </Pressable>
            ) : null}

            {group.participants.map((persona) => (
              <View key={persona.userId} style={styles.grupoParticipante}>
                <View style={styles.itemCopy}>
                  <Text style={styles.sectionTitle}>
                    {persona.name}
                    {persona.isHost ? " · anfitrión" : ""}
                  </Text>
                  {/* Quien todavía no eligió se muestra igual: saber quién falta
                      es la mitad de la utilidad en una oficina. */}
                  <Text style={styles.cardText}>
                    {persona.items.length === 0
                      ? "Todavía no eligió"
                      : persona.items.map((item) => `${item.quantity}× ${item.name}`).join(" · ")}
                  </Text>
                </View>
                <Text style={styles.sectionTitle}>{money.format(persona.subtotal)}</Text>
              </View>
            ))}

            <View style={styles.grupoTotal}>
              <Text style={styles.sectionTitle}>Total del grupo</Text>
              <Text style={styles.sectionTitle}>{money.format(group.subtotal)}</Text>
            </View>

            {group.status === "open" ? (
              <>
                {/* Volcar el carrito propio en vez de re-elegir: quien ya armó su
                    pedido no debería rehacerlo para compartirlo. */}
                {boton(
                  "poner",
                  miParte?.items.length ? "Reemplazar mi parte" : "Poner mi carrito",
                  () =>
                    ejecutar(() =>
                      api.setGroupOrderItems(
                        group.id,
                        cart.map((linea) => ({
                          menuItemId: linea.menuItemId,
                          quantity: linea.quantity,
                          extras: linea.extras,
                          note: linea.note,
                        })),
                      ),
                    ),
                  false,
                  cart.length === 0,
                )}
                {miParte?.items.length
                  ? boton("sacar", "Sacar mi parte", () =>
                      ejecutar(() => api.setGroupOrderItems(group.id, [])),
                    )
                  : null}
                {soyAnfitrion
                  ? boton(
                      "cerrar",
                      "Cerrar y revisar",
                      () => ejecutar(() => api.setGroupOrderStatus(group.id, "locked")),
                      true,
                      group.subtotal === 0,
                    )
                  : null}
                {soyAnfitrion
                  ? boton("cancelar", "Cancelar grupo", () =>
                      ejecutar(() => api.setGroupOrderStatus(group.id, "cancelled")),
                    )
                  : null}
              </>
            ) : null}

            {group.status === "locked" && soyAnfitrion ? (
              <>
                {boton("reabrir", "Reabrir", () =>
                  ejecutar(() => api.setGroupOrderStatus(group.id, "open")),
                )}
                {boton("confirmar", "Confirmar y pagar", () => onCheckoutGroup(group), true)}
              </>
            ) : null}
            {group.status === "locked" && !soyAnfitrion ? (
              <Text style={styles.cardText}>
                {group.hostName} está por confirmar. Ya no se pueden sumar productos.
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
