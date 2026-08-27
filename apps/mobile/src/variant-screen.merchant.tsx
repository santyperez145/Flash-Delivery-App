// La pantalla de Flash Negocios (ticket ARC-001).
//
// Sólo entra al bundle cuando `EXPO_PUBLIC_APP_VARIANT` es `merchant`.
//
// Es la única de las tres que dibuja encabezado propio. Estaba en `App.tsx`
// detrás de dos `mode === "merchant" && (...)`, lo que obligaba al caparazón a
// conocer una variante en particular. Ahora el caparazón pregunta por el
// encabezado de la variante instalada y las otras dos responden `null`.
import { Pressable, Text, View } from "react-native";

import { MerchantScreen } from "./screens/MerchantScreen";
import { styles } from "./styles";
import type { VariantHeader, VariantScreen } from "./variant-screen.types";

export const variantHeader: VariantHeader = ({ sessionUser, logout }) => (
  <>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>Flash Negocios</Text>
        <Text style={styles.title}>Control en vivo de tu local</Text>
      </View>
      <Pressable onPress={logout} style={styles.logoutButton}>
        <Text style={styles.logoutText}>Salir</Text>
      </Pressable>
    </View>
    <View style={styles.sessionBar}>
      <Text style={styles.sessionRole}>Cuenta comercio</Text>
      <Text style={styles.sessionName} numberOfLines={1}>
        {sessionUser?.name}
      </Text>
    </View>
  </>
);

export const variantScreen: VariantScreen = ({
  activeRestaurant,
  orders,
  busy,
  runAction,
  refresh,
}) =>
  activeRestaurant ? (
    <MerchantScreen
      restaurant={activeRestaurant}
      orders={orders}
      busy={busy}
      runAction={runAction}
      onRefresh={refresh}
    />
  ) : null;
