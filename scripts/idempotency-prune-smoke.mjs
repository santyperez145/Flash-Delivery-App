process.env.NODE_ENV="test";
const {pruneExpiredIdempotencyKeys}=await import("../server/idempotency-repository.js");
let captured;
const result=await pruneExpiredIdempotencyKeys({limit:50000,pool:{query:async(sql,params)=>{captured={sql,params};return{rowCount:17};}}});
if(result.deleted!==17||result.limit!==10000||captured.params[0]!==10000)throw new Error("El batch no respeta resultado o límite máximo");
if(!/expires_at\s*<=\s*now\(\)/i.test(captured.sql)||!/FOR UPDATE SKIP LOCKED/i.test(captured.sql)||!/DELETE FROM idempotency_keys/i.test(captured.sql))throw new Error("El prune no limita filas vencidas con lock concurrente");
console.log("ok - idempotency prune deletes only an expired, locked and bounded batch");
