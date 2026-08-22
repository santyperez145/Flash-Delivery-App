import {processPostgresDispatchBatch} from "../server/dispatch-repository.js";
import {closePostgres} from "../server/postgres.js";
let stopping=false;process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
do{const result=await processPostgresDispatchBatch();if(result.claimed||result.expired)console.log(JSON.stringify({level:"info",event:"dispatch_batch",...result}));if(process.env.WORKER_ONCE==="true")break;await new Promise(resolve=>setTimeout(resolve,result.claimed?500:3000));}while(!stopping);
await closePostgres();
