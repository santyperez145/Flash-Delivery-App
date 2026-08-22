process.env.NODE_ENV="test";
const {pruneExpiredIdempotencyKeys,pruneExpiredIdempotencyKeyBatches}=await import("../server/idempotency-repository.js");
let captured;
const result=await pruneExpiredIdempotencyKeys({limit:50000,pool:{query:async(sql,params)=>{captured={sql,params};return{rowCount:17};}}});
if(result.deleted!==17||result.limit!==10000||captured.params[0]!==10000)throw new Error("El batch no respeta resultado o límite máximo");
if(!/expires_at\s*<=\s*now\(\)/i.test(captured.sql)||!/FOR UPDATE SKIP LOCKED/i.test(captured.sql)||!/DELETE FROM idempotency_keys/i.test(captured.sql))throw new Error("El prune no limita filas vencidas con lock concurrente");
console.log("ok - idempotency prune deletes only an expired, locked and bounded batch");

const rowCounts=[100,100,23];
let calls=0;
const drained=await pruneExpiredIdempotencyKeyBatches({limit:100,maxBatches:20,pool:{query:async()=>({rowCount:rowCounts[calls++]})}});
if(drained.deleted!==223||drained.batches!==3||drained.batchLimit!==100||!drained.drained||calls!==3)throw new Error("El prune no drena lotes hasta encontrar uno parcial");
calls=0;
const bounded=await pruneExpiredIdempotencyKeyBatches({limit:50,maxBatches:2,pool:{query:async()=>{calls+=1;return{rowCount:50};}}});
if(bounded.deleted!==100||bounded.batches!==2||bounded.drained||calls!==2)throw new Error("El prune no respeta el máximo de lotes");
console.log("ok - idempotency prune drains backlog with a bounded number of batches");
