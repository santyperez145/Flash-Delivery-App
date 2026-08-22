import {pruneExpiredIdempotencyKeys} from "../server/idempotency-repository.js";
import {closePostgres} from "../server/postgres.js";

const limit=Math.min(10000,Math.max(1,Number(process.env.IDEMPOTENCY_PRUNE_BATCH)||1000));
try{
  const result=await pruneExpiredIdempotencyKeys({limit});
  console.log(JSON.stringify({event:"idempotency_pruned",...result}));
}finally{await closePostgres();}
