// Contrato del paquete compartido (ARC-001 paso 6).
//
// Los tipos idénticos entre web y mobile viven en `@flash/domain-contracts`.
// Esta puerta afirma tres cosas que un refactor puede romper en silencio:
// el paquete existe con esos nombres, ambas superficies los reexportan, y
// ninguna de las dos vuelve a declarar el cuerpo.
import fs from "node:fs/promises";
import { contains, containsAll, containsNone } from "./source-contract.mjs";

const SHARED = [
  "DietaryPreferences",
  "GeoPoint",
  "DeliveryEvidence",
  "AppNotification",
  "NotificationPreference",
  "OrderIssue",
  "OrderSubstitution",
  "UserAddress",
  "FoodCheckoutQuote",
  "ShipmentReturn",
  "ShipmentClaimEvidence",
  "DriverDocument",
  "DriverCompliance",
  "ServiceTip",
  "DispatchScoreBreakdown",
  "MerchantOperationsMetrics",
  "MerchantOperationsDashboardCore",
  "SubscriptionPlan",
  "Subscription",
  "GroupOrderParticipant",
  "GroupOrder",
  "ServiceQuickReply",
  "ShipmentClaim",
  "DispatchOffer",
  "UserRole",
  "UserStatus",
  "User",
  "OrderStatus",
  "OrderItem",
  "Order",
  "RestaurantSummary",
  "MenuModifier",
  "MenuModifierGroup",
  "MenuItemSummary",
  "RestaurantBranch",
  "DriverServiceMode",
  "DriverSummary",
  "DriverVehicle",
  "RideStatus",
  "RideService",
  "RideSummary",
  "ShipmentStatus",
  "ShipmentPackageSize",
  "ShipmentProtection",
  "ShipmentItemCategory",
  "ShipmentServiceLevel",
  "ShipmentSummary",
  "VerticalService",
  "PromotionSummary",
];

/** Tipos que cada superficie extiende con intersección local (no redefinición del núcleo). */
const SHARED_WITH_LOCAL_EXTENSION = ["Order", "Restaurant"];

const assert = (condition, label) => {
  if (!condition) throw new Error(`failed: ${label}`);
  console.log(`ok - ${label}`);
};

const [shared, web, mobile, rootPkg, mobilePkg] = await Promise.all([
  fs.readFile("packages/domain-contracts/src/index.ts", "utf8"),
  fs.readFile("src/types.ts", "utf8"),
  fs.readFile("apps/mobile/src/types.ts", "utf8"),
  fs.readFile("package.json", "utf8"),
  fs.readFile("apps/mobile/package.json", "utf8"),
]);

assert(
  containsAll(
    shared,
    SHARED.map((name) => `export type ${name}`),
  ),
  `${SHARED.length} identical contracts live in @flash/domain-contracts`,
);
assert(
  contains(shared, "byte-a-byte") && !contains(shared, 'from "react"'),
  "shared contracts stay presentation-free",
);
assert(
  containsAll(web, ['from "@flash/domain-contracts"', ...SHARED]) &&
    containsAll(mobile, ['from "@flash/domain-contracts"', ...SHARED]),
  "web and mobile reexport the shared contracts",
);
assert(
  containsNone(
    web,
    SHARED.filter((name) => !SHARED_WITH_LOCAL_EXTENSION.includes(name)).map(
      (name) => `export type ${name} =`,
    ),
  ) &&
    containsNone(
      mobile,
      SHARED.filter((name) => !SHARED_WITH_LOCAL_EXTENSION.includes(name)).map(
        (name) => `export type ${name} =`,
      ),
    ),
  "web and mobile no longer redefine the shared contract bodies",
);
assert(
  contains(web, "Order as SharedOrder") && contains(mobile, "Order as SharedOrder"),
  "web and mobile extend shared Order with surface-specific fields",
);
assert(
  contains(web, "Restaurant = RestaurantSummary &") &&
    contains(mobile, "Restaurant = RestaurantSummary &"),
  "web and mobile extend shared RestaurantSummary with surface-specific fields",
);
assert(
  contains(web, "MenuItem = MenuItemSummary &") &&
    contains(mobile, "menu: MenuItemSummary[]") &&
    contains(web, "branches?: RestaurantBranch[]") &&
    contains(mobile, "branches?: RestaurantBranch[]"),
  "web and mobile share MenuItemSummary and RestaurantBranch",
);
assert(
  contains(web, "MerchantOperationsDashboard = MerchantOperationsDashboardCore &") &&
    contains(mobile, "MerchantOperationsDashboard = MerchantOperationsDashboardCore &"),
  "web and mobile extend shared MerchantOperationsDashboardCore with local Restaurant",
);
assert(
  contains(web, "Driver = DriverSummary") &&
    contains(mobile, "Driver = DriverSummary &") &&
    contains(web, "DriverService = DriverServiceMode") &&
    contains(mobile, "ServiceMode = DriverServiceMode") &&
    contains(web, "DriverVehicle") &&
    contains(mobile, "DriverVehicle"),
  "web and mobile share DriverSummary, DriverServiceMode and DriverVehicle",
);
assert(
  contains(web, "Ride = RideSummary &") &&
    contains(mobile, "Ride = RideSummary &") &&
    contains(web, "Shipment = ShipmentSummary") &&
    contains(mobile, "Shipment = ShipmentSummary &") &&
    contains(web, "RideService") &&
    contains(mobile, "RideService"),
  "web and mobile share RideSummary, RideService and ShipmentSummary",
);
assert(
  contains(web, "Service = VerticalService") &&
    contains(web, "Promotion = PromotionSummary") &&
    contains(mobile, "Promotion = PromotionSummary &"),
  "web and mobile share VerticalService and PromotionSummary",
);
assert(
  contains(rootPkg, '"@flash/domain-contracts"') &&
    contains(mobilePkg, '"@flash/domain-contracts"'),
  "root and mobile declare the shared package dependency",
);
