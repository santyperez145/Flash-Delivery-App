// Rutas OpenAPI que viven fuera de `openapi.js` (monolito de H-08). Se juntan acá
// para que sumar una no agrande ese archivo.
import { accountPaths } from "./openapi-account.js";
import { accountMfaPaths } from "./openapi-account-mfa.js";
import { giftCardPaths } from "./openapi-gift-cards.js";
import { familyProfilePaths } from "./openapi-family-profile.js";
import { merchantApplicationPaths } from "./openapi-merchant-applications.js";
import { driverApplicationPaths } from "./openapi-driver-applications.js";
import { cashPaths } from "./openapi-cash.js";
import { orderDeliveryCodePaths } from "./openapi-order-delivery-code.js";
import { orderDeliveryPhotoPaths } from "./openapi-order-delivery-photo.js";
import { rideFareSplitPaths } from "./openapi-ride-fare-splits.js";
import { rideTripCheckPaths } from "./openapi-ride-trip-checks.js";

export const extraPaths = (helpers) => ({
  ...accountPaths(helpers),
  ...accountMfaPaths(helpers),
  ...orderDeliveryPhotoPaths(helpers),
  ...orderDeliveryCodePaths(helpers),
  ...rideTripCheckPaths(helpers),
  ...rideFareSplitPaths(helpers),
  ...giftCardPaths(helpers),
  ...familyProfilePaths(helpers),
  ...merchantApplicationPaths(helpers),
  ...driverApplicationPaths(helpers),
  ...cashPaths(helpers),
});
