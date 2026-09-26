// Compositor de estilos del cliente móvil (ARC-001, paso 10d).
// Fusiona módulos por superficie antes del spread en `styles.ts`.
import { customerAccountStyleDefs } from "./customer-account";
import { customerFoodStyleDefs } from "./customer-food";
import { customerTrackingStyleDefs } from "./customer-tracking";

export const customerStyleDefs = {
  ...customerFoodStyleDefs,
  ...customerAccountStyleDefs,
  ...customerTrackingStyleDefs,
};
