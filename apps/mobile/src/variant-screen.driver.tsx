// La pantalla de Flash Driver (ticket ARC-001).
//
// Sólo entra al bundle cuando `EXPO_PUBLIC_APP_VARIANT` es `driver`. Es la
// variante que además pide ubicación en segundo plano en `app.config.js`: el
// permiso más invasivo de las tres, y por eso el build que lo pide es el único
// que lo justifica ante la tienda.
import { DriverScreen } from "./screens/DriverScreen";
import type { VariantHeader, VariantScreen } from "./variant-screen.types";

export const variantHeader: VariantHeader = () => null;

export const variantScreen: VariantScreen = ({
  state,
  activeDriver,
  busy,
  runAction,
  refresh,
  logout,
}) =>
  activeDriver ? (
    <DriverScreen
      state={state}
      driver={activeDriver}
      busy={busy}
      runAction={runAction}
      onLogout={logout}
      onRefresh={refresh}
    />
  ) : null;
