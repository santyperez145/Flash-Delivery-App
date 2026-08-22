import { pruneProductEvents } from "../server/product-analytics-repository.js";
import { closePostgres } from "../server/postgres.js";
try{console.log(JSON.stringify(await pruneProductEvents({retentionDays:Number(process.env.ANALYTICS_RETENTION_DAYS||90)})));}finally{await closePostgres();}
