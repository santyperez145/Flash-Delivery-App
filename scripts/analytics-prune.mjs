import { pruneProductEvents } from "../server/product-analytics-repository.js";
import { pruneLocalProductEvents } from "../server/store.js";
import { usesPostgresAuth } from "../server/auth-repository.js";
import { closePostgres } from "../server/postgres.js";
const retentionDays=Number(process.env.ANALYTICS_RETENTION_DAYS||90);
try{console.log(JSON.stringify(usesPostgresAuth()?await pruneProductEvents({retentionDays}):pruneLocalProductEvents({retentionDays})));}finally{await closePostgres();}
