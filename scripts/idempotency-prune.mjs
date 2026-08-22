import {pruneExpiredIdempotencyKeyBatches} from "../server/idempotency-repository.js";
import {closePostgres} from "../server/postgres.js";

const limit=Math.min(10000,Math.max(1,Number(process.env.IDEMPOTENCY_PRUNE_BATCH)||1000));
const maxBatches=Math.min(100,Math.max(1,Number(process.env.IDEMPOTENCY_PRUNE_MAX_BATCHES)||10));
try{
  const result=await pruneExpiredIdempotencyKeyBatches({limit,maxBatches});
  console.log(JSON.stringify({event:"idempotency_pruned",...result}));
}finally{await closePostgres();}
