import { refreshDueMerchantPaymentConnections } from "../server/payment-oauth-refresh-repository.js";
import { closePostgres, postgresPool } from "../server/postgres.js";
if (!postgresPool) throw new Error("DATABASE_URL is required for payment OAuth refresh worker");
try {
  const result = await refreshDueMerchantPaymentConnections({
    limit: Number(process.env.WORKER_BATCH_SIZE) || 20,
  });
  console.log(JSON.stringify({ worker: "payment-oauth-refresh", ...result }));
  if (result.attention > 0) process.exitCode = 2;
} finally {
  await closePostgres();
}
