import { processMercadoPagoWebhookBatch } from "../server/mercadopago-webhook-repository.js";
import { closePostgres, postgresPool } from "../server/postgres.js";
if (!postgresPool) throw new Error("DATABASE_URL is required for Mercado Pago webhook worker");
try {
  const result = await processMercadoPagoWebhookBatch({
    limit: Number(process.env.WORKER_BATCH_SIZE) || 20,
  });
  console.log(JSON.stringify({ worker: "mercadopago-webhook", ...result }));
  if (result.deadLetter > 0) process.exitCode = 2;
} finally {
  await closePostgres();
}
