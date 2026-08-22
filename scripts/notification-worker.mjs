import {config} from "../server/config.js";
import {processPostgresNotificationBatch} from "../server/notification-repository.js";
import {closePostgres} from "../server/postgres.js";
if(config.notificationProvider==="disabled"&&config.emailProvider==="disabled")throw new Error("All notification providers are disabled");
let stopping=false;process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
do{const result=await processPostgresNotificationBatch({workerId:`standalone-${process.pid}`,provider:config.notificationProvider});if(result.claimed)console.log(JSON.stringify({level:"info",event:"notification_batch",...result}));if(process.env.WORKER_ONCE==="true")break;await new Promise(resolve=>setTimeout(resolve,result.claimed?250:3000));}while(!stopping);
await closePostgres();
