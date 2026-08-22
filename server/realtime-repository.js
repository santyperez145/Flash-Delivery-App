import crypto from "node:crypto";
import {postgresPool} from "./postgres.js";
const allRoles=["admin","customer","merchant","driver"];
const publicId=()=>`EVT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const mapEvent=row=>({cursor:String(row.sequence_id),id:row.public_id,type:row.type,entityType:row.entity_type,entityId:row.entity_id,action:row.action,requestId:row.request_id,at:new Date(row.occurred_at).toISOString(),audienceUserIds:row.audience_user_ids||[],audienceRoles:row.audience_roles||[]});

async function resolveAudience(entityType,entityId){
  if(!entityType||!entityId)return{users:[],roles:allRoles};
  if(entityType==="user")return{users:[entityId],roles:["admin"]};
  if(entityType==="driver"){const row=(await postgresPool.query("SELECT u.public_id FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.public_id=$1",[entityId])).rows[0];return{users:row?[row.public_id]:[],roles:["admin"]};}
  if(entityType==="restaurant"){const row=(await postgresPool.query("SELECT u.public_id FROM merchants m JOIN users u ON u.id=m.owner_id WHERE m.public_id=$1",[entityId])).rows[0];return{users:row?[row.public_id]:[],roles:["admin"]};}
  if(entityType==="support_ticket"){const row=(await postgresPool.query("SELECT u.public_id FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.public_id=$1",[entityId])).rows[0];return{users:row?[row.public_id]:[],roles:["admin"]};}
  if(["order","ride","shipment"].includes(entityType)){const row=(await postgresPool.query(`SELECT customer.public_id customer_id,merchant_owner.public_id merchant_id,driver_user.public_id driver_id
      FROM jobs j JOIN users customer ON customer.id=j.customer_id LEFT JOIN merchants m ON m.id=j.merchant_id LEFT JOIN users merchant_owner ON merchant_owner.id=m.owner_id
      LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN users driver_user ON driver_user.id=d.user_id WHERE j.public_id=$1`,[entityId])).rows[0];
    return{users:row?[row.customer_id,row.merchant_id,row.driver_id].filter(Boolean):[],roles:["admin"]};}
  return{users:[],roles:allRoles};
}

export async function persistPostgresRealtimeEvent({type,entityType=null,entityId=null,action=null,requestId=null,actorPublicId=null}){const audience=await resolveAudience(entityType,entityId);const row=(await postgresPool.query(`INSERT INTO realtime_events(public_id,type,entity_type,entity_id,action,request_id,actor_public_id,audience_user_ids,audience_roles)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[publicId(),type,entityType,entityId,action,requestId,actorPublicId,audience.users,audience.roles])).rows[0];return mapEvent(row);}

export async function getPostgresRealtimeEvent(sequenceId){const row=(await postgresPool.query("SELECT * FROM realtime_events WHERE sequence_id=$1",[sequenceId])).rows[0];return row?mapEvent(row):null;}
export async function getPostgresRealtimeReplay({after=0,userPublicId,roles,limit=100}){const result=await postgresPool.query(`SELECT * FROM realtime_events WHERE sequence_id>$1 AND ($2=ANY(audience_user_ids) OR audience_roles&&$3::text[]) ORDER BY sequence_id LIMIT $4`,[after,userPublicId,roles,limit]);return result.rows.map(mapEvent);}
export async function getPostgresRealtimeCursor(){return String((await postgresPool.query("SELECT COALESCE(max(sequence_id),0)::bigint cursor FROM realtime_events")).rows[0].cursor);}
export async function prunePostgresRealtimeEvents({retentionDays=7,maxRows=100000}={}){const old=await postgresPool.query("DELETE FROM realtime_events WHERE occurred_at<now()-($1*interval '1 day')",[retentionDays]);const overflow=await postgresPool.query(`DELETE FROM realtime_events WHERE sequence_id<COALESCE((SELECT min(sequence_id) FROM(SELECT sequence_id FROM realtime_events ORDER BY sequence_id DESC LIMIT $1) kept),0)`,[maxRows]);return{deletedByAge:old.rowCount,deletedOverflow:overflow.rowCount};}

export function canReceiveRealtimeEvent(event,{userPublicId,roles}){return event.audienceUserIds.includes(userPublicId)||event.audienceRoles.some(role=>roles.includes(role));}

export async function startPostgresRealtimeListener(onEvent){let stopped=false,client=null,retry=null;const connect=async()=>{if(stopped)return;try{client=await postgresPool.connect();client.on("notification",async message=>{if(message.channel!=="flash_realtime")return;const event=await getPostgresRealtimeEvent(message.payload).catch(()=>null);if(event)onEvent(event);});client.on("error",()=>{client?.release(true);client=null;if(!stopped)retry=setTimeout(connect,1000);});await client.query("LISTEN flash_realtime");}catch(_error){client?.release(true);client=null;if(!stopped)retry=setTimeout(connect,1000);}};await connect();return async()=>{stopped=true;if(retry)clearTimeout(retry);if(client){await client.query("UNLISTEN flash_realtime").catch(()=>{});client.release();client=null;}};}
