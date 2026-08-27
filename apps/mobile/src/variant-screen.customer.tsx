// La pantalla de Flash, la aplicación del cliente (ticket ARC-001).
//
// Este archivo sólo entra al bundle cuando `EXPO_PUBLIC_APP_VARIANT` es
// `customer`: lo decide `metro.config.js` al resolver `./variant-screen`. En el
// build de Flash Driver, `CustomerScreen` no es alcanzable desde el grafo de
// módulos, que es lo que pedía ARC-001.
import { CustomerScreen } from "./screens/CustomerScreen";
import type { VariantHeader, VariantScreen } from "./variant-screen.types";

export const variantHeader: VariantHeader = () => null;

export const variantScreen: VariantScreen = ({
  state,
  activeUser,
  busy,
  runAction,
  refresh,
  logout,
}) =>
  activeUser ? (
    <CustomerScreen
      state={state}
      user={activeUser}
      busy={busy}
      runAction={runAction}
      refresh={refresh}
      onLogout={logout}
    />
  ) : null;
