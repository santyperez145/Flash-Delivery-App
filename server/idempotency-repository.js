import { postgresPool } from "./postgres.js";

export async function pruneExpiredIdempotencyKeys({ limit = 1000, pool = postgresPool } = {}) {
  const batch = Math.min(10000, Math.max(1, Number(limit) || 1000));
  const result = await pool.query(
    `WITH expired AS (
    SELECT key FROM idempotency_keys
    WHERE expires_at<=now()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ) DELETE FROM idempotency_keys target USING expired
    WHERE target.key=expired.key
    RETURNING target.key`,
    [batch],
  );
  return { deleted: result.rowCount || 0, limit: batch };
}

export async function pruneExpiredIdempotencyKeyBatches({
  limit = 1000,
  maxBatches = 10,
  pool = postgresPool,
} = {}) {
  const batches = Math.min(100, Math.max(1, Number(maxBatches) || 10));
  let deleted = 0;
  let executedBatches = 0;
  let batchLimit = 0;
  for (let index = 0; index < batches; index += 1) {
    const result = await pruneExpiredIdempotencyKeys({ limit, pool });
    executedBatches += 1;
    deleted += result.deleted;
    batchLimit = result.limit;
    if (result.deleted < result.limit) break;
  }
  return {
    deleted,
    batches: executedBatches,
    batchLimit,
    maxBatches: batches,
    drained: executedBatches < batches,
  };
}
