import crypto from "node:crypto";
import {createPool} from "./db-client.mjs";
import {enqueuePostgresNotification} from "../server/notification-repository.js";
import {closePostgres} from "../server/postgres.js";

const base=process.env.API_URL||"http://127.0.0.1:4000/api",pool=createPool(),suffix=crypto.randomBytes(6).toString("hex"),dedupeKeys=[];
let customerId=null,previousPreferences=[];const auditRequestIds=[];
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
async function login(email){const response=await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:"demo123",deviceName:"notification-preferences-smoke"})});const body=await response.json();if(!response.ok)throw new Error(body.message);return body.token;}
async function request(path,token,init={}){const response=await fetch(`${base}${path}`,{...init,headers:{"content-type":"application/json",Authorization:`Bearer ${token}`,...(init.headers||{})}});return{status:response.status,body:await response.json()};}

try{
  customerId=(await pool.query("SELECT id FROM users WHERE public_id='usr_customer'")).rows[0].id;
  previousPreferences=(await pool.query("SELECT category,push_enabled,email_enabled FROM user_notification_preferences WHERE user_id=$1",[customerId])).rows;
  const customerToken=await login("cliente@flash.app"),adminToken=await login("ops@flash.app");
  const defaults=await request("/notification-preferences",customerToken);
  assert(defaults.status===200&&defaults.body.preferences.length===5&&defaults.body.preferences.find(entry=>entry.category==="promotions")?.pushEnabled===false,"preferences expose five safe defaults with promotional push disabled");
  const disabled=await request("/notification-preferences/service_updates",customerToken,{method:"PATCH",body:JSON.stringify({pushEnabled:false,emailEnabled:false})});auditRequestIds.push(disabled.body.requestId);
  assert(disabled.status===200&&!disabled.body.preferences.find(entry=>entry.category==="service_updates").pushEnabled,"owner disables service push persistently");
  const inAppKey=`notification-pref-inapp-${suffix}`;dedupeKeys.push(inAppKey);const inAppId=await enqueuePostgresNotification({userPublicId:"usr_customer",template:"order_status",payload:{status:"fixture_in_app"},deduplicationKey:inAppKey});
  const inApp=(await pool.query("SELECT channel,status FROM notifications WHERE public_id=$1",[inAppId])).rows[0];
  assert(inApp.channel==="in_app"&&inApp.status==="sent","disabled push falls back to a durable in-app notification instead of dropping the event");
  const enabled=await request("/notification-preferences/service_updates",customerToken,{method:"PATCH",body:JSON.stringify({pushEnabled:true,emailEnabled:false})});auditRequestIds.push(enabled.body.requestId);
  const pushKey=`notification-pref-push-${suffix}`;dedupeKeys.push(pushKey);const pushId=await enqueuePostgresNotification({userPublicId:"usr_customer",template:"order_status",payload:{status:"fixture_push"},deduplicationKey:pushKey});
  const push=(await pool.query("SELECT channel,status FROM notifications WHERE public_id=$1",[pushId])).rows[0];
  assert(push.channel==="push"&&push.status==="queued","enabled push enters the worker queue");
  const foreignRead=await request(`/notifications/${inAppId}/read`,adminToken,{method:"PATCH",body:"{}"});
  assert(foreignRead.status===404,"another account cannot mark a notification by object id");
  const ownerRead=await request(`/notifications/${inAppId}/read`,customerToken,{method:"PATCH",body:"{}"});
  assert(ownerRead.status===200&&ownerRead.body.notifications.some(entry=>entry.id===inAppId&&entry.readAt),"owner marks an in-app notification as read");
  const persisted=(await pool.query("SELECT push_enabled FROM user_notification_preferences WHERE user_id=$1 AND category='service_updates'",[customerId])).rows[0];
  const audits=(await pool.query("SELECT action,after_data FROM audit_events WHERE request_id=ANY($1)",[auditRequestIds])).rows;
  assert(persisted.push_enabled===true&&audits.length===2&&audits.every(row=>row.action==="notification_preference.updated"),"preferences and non-sensitive audit events persist in PostgreSQL");
}finally{
  if(dedupeKeys.length)await pool.query("DELETE FROM notifications WHERE user_id=$1 AND deduplication_key=ANY($2)",[customerId,dedupeKeys]);
  if(auditRequestIds.length)await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)",[auditRequestIds]);
  if(customerId){await pool.query("DELETE FROM user_notification_preferences WHERE user_id=$1",[customerId]);for(const row of previousPreferences)await pool.query("INSERT INTO user_notification_preferences(user_id,category,push_enabled,email_enabled) VALUES($1,$2,$3,$4)",[customerId,row.category,row.push_enabled,row.email_enabled]);}
  await pool.end();await closePostgres();
}
