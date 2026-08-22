import {postgresPool} from "./postgres.js";

export async function pruneExpiredIdempotencyKeys({limit=1000,pool=postgresPool}={}){
  const batch=Math.min(10000,Math.max(1,Number(limit)||1000));
  const result=await pool.query(`WITH expired AS (
    SELECT key FROM idempotency_keys
    WHERE expires_at<=now()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  ) DELETE FROM idempotency_keys target USING expired
    WHERE target.key=expired.key
    RETURNING target.key`,[batch]);
  return{deleted:result.rowCount||0,limit:batch};
}
