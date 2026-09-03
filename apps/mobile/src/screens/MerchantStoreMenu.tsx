// Catálogo y stock mobile (ARC-001).
//
// Uber Eats Manager y DoorDash Business Manager aíslan el menú de la cola.
// Flash deja alta y stock global aquí; el inventario por sucursal vive en web.
import type { Dispatch, SetStateAction } from "react";
import { Text, TextInput, View } from "react-native";

import { api } from "../api";
import { money } from "../format";
import { styles } from "../styles";
import { ActionButton } from "../ui";
import type { MerchantOperationsMetrics, Restaurant } from "../types";

type RunAction = (action: () => Promise<unknown>, success: string) => void;
type NewItem = {
  name: string;
  description: string;
  category: string;
  price: string;
};

export function MerchantStoreMenu({
  restaurant,
  metrics,
  busy,
  runAction,
  newItem,
  setNewItem,
}: {
  restaurant: Restaurant;
  metrics: MerchantOperationsMetrics | undefined;
  busy: boolean;
  runAction: RunAction;
  newItem: NewItem;
  setNewItem: Dispatch<SetStateAction<NewItem>>;
}) {
  return (
    <>
      <View style={styles.merchantScreenHeading}>
        <Text style={styles.merchantScreenEyebrow}>MENÚ</Text>
        <Text style={styles.merchantScreenTitle}>Catálogo y stock</Text>
        <Text style={styles.merchantScreenCopy}>
          {metrics
            ? `${restaurant.menu.length - metrics.unavailableItems} disponibles · ${metrics.unavailableItems} sin stock`
            : "Sincronizando inventario de la sucursal"}
        </Text>
      </View>
      <Text style={styles.sectionTitle}>Menu y stock</Text>
      {restaurant.menu.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemCopy}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.cardText}>
              {money.format(item.price)} - {item.stock ? "Disponible" : "Agotado"}
            </Text>
          </View>
          <ActionButton
            label={item.stock ? "Agotar" : "Reponer"}
            disabled={busy}
            onPress={() =>
              runAction(
                () => api.updateMenuStock(restaurant.id, item.id, !item.stock),
                "Stock actualizado",
              )
            }
          />
        </View>
      ))}
      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Agregar producto</Text>
        <TextInput
          value={newItem.name}
          onChangeText={(value) => setNewItem((current) => ({ ...current, name: value }))}
          placeholder="Nombre"
          style={styles.input}
        />
        <TextInput
          value={newItem.description}
          onChangeText={(value) => setNewItem((current) => ({ ...current, description: value }))}
          placeholder="Descripcion"
          style={styles.input}
        />
        <TextInput
          value={newItem.category}
          onChangeText={(value) => setNewItem((current) => ({ ...current, category: value }))}
          placeholder="Categoria"
          style={styles.input}
        />
        <TextInput
          value={newItem.price}
          onChangeText={(value) => setNewItem((current) => ({ ...current, price: value }))}
          placeholder="Precio"
          keyboardType="numeric"
          style={styles.input}
        />
        <ActionButton
          label="Crear producto"
          disabled={busy || !newItem.name.trim() || Number(newItem.price) <= 0}
          onPress={() =>
            runAction(async () => {
              await api.addMenuItem(restaurant.id, {
                name: newItem.name.trim(),
                description: newItem.description.trim(),
                category: newItem.category.trim() || "Especiales",
                price: Number(newItem.price),
              });
              setNewItem({
                name: "",
                description: "",
                category: "Especiales",
                price: "",
              });
            }, "Producto creado")
          }
        />
      </View>
    </>
  );
}
