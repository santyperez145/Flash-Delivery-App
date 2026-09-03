import { createPostgresRuntimeContext } from "./postgres-runtime/context.mjs";
import { runBootstrapCommerceSuite } from "./postgres-runtime/suite-bootstrap-commerce.mjs";
import { runSubscriptionsPromotionsSuite } from "./postgres-runtime/suite-subscriptions-promotions.mjs";
import { runDispatchMerchantOpsSuite } from "./postgres-runtime/suite-dispatch-merchant-ops.mjs";
import { runShipmentsFinanceSupportSuite } from "./postgres-runtime/suite-shipments-finance-support.mjs";
import { runCleanup } from "./postgres-runtime/cleanup.mjs";

const ctx = createPostgresRuntimeContext();

try {
  await runBootstrapCommerceSuite(ctx);
  await runSubscriptionsPromotionsSuite(ctx);
  await runDispatchMerchantOpsSuite(ctx);
  await runShipmentsFinanceSupportSuite(ctx);
} finally {
  await runCleanup(ctx);
}
