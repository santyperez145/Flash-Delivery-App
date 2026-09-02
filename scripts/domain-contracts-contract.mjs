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
  "RideStatus",
];

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
    SHARED.map((name) => `export type ${name} =`),
  ) &&
    containsNone(
      mobile,
      SHARED.map((name) => `export type ${name} =`),
    ),
  "web and mobile no longer redefine the shared contract bodies",
);
assert(
  contains(rootPkg, '"@flash/domain-contracts"') &&
    contains(mobilePkg, '"@flash/domain-contracts"'),
  "root and mobile declare the shared package dependency",
);
