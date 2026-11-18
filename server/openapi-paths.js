// Rutas OpenAPI que viven fuera de `openapi.js` (monolito de H-08). Se juntan acá
// para que sumar una no agrande ese archivo.
import { accountPaths } from "./openapi-account.js";
import { orderDeliveryPhotoPaths } from "./openapi-order-delivery-photo.js";
import { rideTripCheckPaths } from "./openapi-ride-trip-checks.js";

export const extraPaths = (helpers) => ({
  ...accountPaths(helpers),
  ...orderDeliveryPhotoPaths(helpers),
  ...rideTripCheckPaths(helpers),
});
