import pg from "pg";
import {createPool} from "./db-client.mjs";

const {Client}=pg;
if(!process.env.DATABASE_URL||!process.env.MIGRATION_DATABASE_URL)throw new Error("DATABASE_URL and MIGRATION_DATABASE_URL are required");
const runtime=new Client({connectionString:process.env.DATABASE_URL,ssl:false});
const ownerWithoutMaintenance=new Client({connectionString:process.env.MIGRATION_DATABASE_URL,ssl:false});
const maintenance=createPool();
const action=`test.audit_append_only.${Date.now()}`;
let fixtureId=null,runtimeFixtureId=null;
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
try{
  await runtime.connect();await ownerWithoutMaintenance.connect();
  fixtureId=(await maintenance.query("INSERT INTO audit_events(actor_roles,action,entity_type,entity_id,after_data) VALUES(ARRAY[]::user_role[],$1,'test','append-only-owner','{}') RETURNING id",[action])).rows[0].id;
  runtimeFixtureId=(await runtime.query("INSERT INTO audit_events(actor_roles,action,entity_type,entity_id,after_data) VALUES(ARRAY[]::user_role[],$1,'test','append-only-runtime','{}') RETURNING id",[`${action}.runtime`])).rows[0].id;
  assert(runtimeFixtureId,"runtime retains append privilege");
  assert(Number((await maintenance.query("SELECT app.audit_chain_invalid_count() invalid")).rows[0].invalid)===0,"audit hash chain validates after concurrent runtime append");
  let runtimeUpdateDenied=false;try{await runtime.query("UPDATE audit_events SET action=action WHERE id=$1",[fixtureId]);}catch(error){runtimeUpdateDenied=error.code==='42501';}
  let runtimeDeleteDenied=false;try{await runtime.query("DELETE FROM audit_events WHERE id=$1",[fixtureId]);}catch(error){runtimeDeleteDenied=error.code==='42501';}
  let runtimeTruncateDenied=false;try{await runtime.query("TRUNCATE audit_events");}catch(error){runtimeTruncateDenied=error.code==='42501';}
  assert(runtimeUpdateDenied&&runtimeDeleteDenied&&runtimeTruncateDenied,"runtime cannot update, delete or truncate audit history");
  let ownerTriggerDenied=false;try{await ownerWithoutMaintenance.query("DELETE FROM audit_events WHERE id=$1",[fixtureId]);}catch(error){ownerTriggerDenied=error.code==='42501';}
  assert(ownerTriggerDenied,"schema owner also needs explicit maintenance context");
  await maintenance.query("UPDATE audit_events SET after_data=$2 WHERE id=$1",[fixtureId,{tampered:true}]);
  assert(Number((await maintenance.query("SELECT app.audit_chain_invalid_count() invalid")).rows[0].invalid)>0,"hash chain detects privileged payload alteration");
  await maintenance.query("SELECT app.rebuild_audit_chain()");
  assert(Number((await maintenance.query("SELECT app.audit_chain_invalid_count() invalid")).rows[0].invalid)===0,"explicit maintenance can rechain selected fixture maintenance");
}finally{
  if(fixtureId||runtimeFixtureId)await maintenance.query("DELETE FROM audit_events WHERE id=ANY($1::bigint[])",[[fixtureId,runtimeFixtureId].filter(Boolean)]);
  assert(Number((await maintenance.query("SELECT app.audit_chain_invalid_count() invalid")).rows[0].invalid)===0,"maintenance delete preserves the remaining chain");
  await runtime.end().catch(()=>{});await ownerWithoutMaintenance.end().catch(()=>{});await maintenance.end();
}
assert(true,"maintenance connection removes only selected test fixtures");
