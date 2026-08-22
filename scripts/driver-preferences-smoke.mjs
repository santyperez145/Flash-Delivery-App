import pg from "pg";

const base=process.env.API_URL||"http://127.0.0.1:4000/api";
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,ssl:false});
const requestIds=[];
const assert=(value,label)=>{if(!value)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
const call=async(path,{token,...options}={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})}});let body={};try{body=await response.json();}catch{}if(body.requestId)requestIds.push(body.requestId);return{status:response.status,body,headers:response.headers};};
const login=async(email)=>(await call("/auth/login",{method:"POST",body:JSON.stringify({email,password:"demo123",deviceName:"driver-preferences-smoke"})})).body.token;

let driverInternalId=null,previous=null;
try{
  const driverToken=await login("conductor@flash.app"),customerToken=await login("cliente@flash.app");
  driverInternalId=(await pool.query("SELECT d.id FROM drivers d JOIN users u ON u.id=d.user_id WHERE u.public_id='usr_driver'")).rows[0].id;
  previous=(await pool.query("SELECT navigation_provider FROM driver_preferences WHERE driver_id=$1",[driverInternalId])).rows[0]||null;
  assert((await call("/driver/preferences")).status===401,"anonymous cannot read driver preferences");
  assert((await call("/driver/preferences",{token:customerToken})).status===403,"customer cannot read or select a driver navigator");
  const initial=await call("/driver/preferences",{token:driverToken});
  assert(initial.status===200&&initial.headers.get("cache-control")?.includes("no-store")&&["system","google_maps","apple_maps"].includes(initial.body.preferences.navigationProvider),"driver reads a private persisted/default preference");
  const updated=await call("/driver/preferences",{token:driverToken,method:"PATCH",body:JSON.stringify({navigationProvider:"google_maps"})});
  const persisted=(await pool.query("SELECT navigation_provider,updated_at FROM driver_preferences WHERE driver_id=$1",[driverInternalId])).rows[0];
  assert(updated.status===200&&updated.body.preferences.navigationProvider==="google_maps"&&persisted.navigation_provider==="google_maps"&&persisted.updated_at,"validated navigator preference persists in PostgreSQL");
  assert((await call("/driver/preferences",{token:driverToken,method:"PATCH",body:JSON.stringify({navigationProvider:"unknown"})})).status===400,"unknown navigation provider is rejected");
  const audit=(await pool.query("SELECT action,after_data FROM audit_events WHERE request_id=$1",[updated.body.requestId])).rows[0];
  assert(audit?.action==="driver.preferences_updated"&&audit.after_data.navigationProvider==="google_maps","preference change is auditable without location data");
}finally{
  if(driverInternalId){if(previous)await pool.query("UPDATE driver_preferences SET navigation_provider=$2,updated_at=now() WHERE driver_id=$1",[driverInternalId,previous.navigation_provider]);else await pool.query("DELETE FROM driver_preferences WHERE driver_id=$1",[driverInternalId]);}
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if(requestIds.length)await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)",[requestIds]);
  await pool.end();
}
