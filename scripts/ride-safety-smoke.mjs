import crypto from "node:crypto";
import {createPool} from "./db-client.mjs";

const base=process.env.API_URL||"http://127.0.0.1:4000/api",pool=createPool(),rideId=`RID-SAFE-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const created={link:null,incident:null};
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
async function login(email){const response=await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:"demo123",deviceName:"ride-safety-smoke"})});const body=await response.json();if(!response.ok)throw new Error(body.message);return body;}
async function request(path,token,init={}){const response=await fetch(`${base}${path}`,{...init,headers:{"content-type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{ }),...(init.headers||{})}});return{status:response.status,body:await response.json()};}

try{
 const customer=await login("cliente@flash.app"),driver=await login("conductor@flash.app");
 const ids=(await pool.query(`SELECT (SELECT id FROM users WHERE public_id=$1) customer_id,(SELECT id FROM drivers WHERE public_id=$2) driver_id`,[customer.user.id,driver.user.driverId])).rows[0];
 await pool.query(`INSERT INTO jobs(public_id,kind,customer_id,driver_id,status,pickup_address,pickup_location,dropoff_address,dropoff_location,service_level,quoted_amount_cents,final_amount_cents,distance_m,estimated_duration_s)
   VALUES($1,'ride',$2,$3,'in_progress','Obelisco',ST_SetSRID(ST_MakePoint(-58.3816,-34.6037),4326)::geography,'Aeroparque',ST_SetSRID(ST_MakePoint(-58.4156,-34.5592),4326)::geography,'economy',850000,850000,7200,1500)`,[rideId,ids.customer_id,ids.driver_id]);
 const forbidden=await request(`/rides/${rideId}/tracking-links`,driver.token,{method:"POST",body:JSON.stringify({ttlMinutes:60})});assert(forbidden.status===403,"driver cannot mint a passenger tracking bearer link");
 const linked=await request(`/rides/${rideId}/tracking-links`,customer.token,{method:"POST",body:JSON.stringify({ttlMinutes:60})});created.link=linked.body.link?.id;assert(linked.status===201&&created.link&&linked.body.link.trackingUrl,"passenger creates an expiring tracking link");
 const token=linked.body.link.trackingUrl.split("/").at(-1),stored=(await pool.query("SELECT token_hash,expires_at,view_count FROM ride_tracking_links WHERE public_id=$1",[created.link])).rows[0];assert(stored.token_hash===crypto.createHash("sha256").update(token).digest("hex")&&!stored.token_hash.includes(token),"database stores only the SHA-256 token digest");
 const publicView=await request(`/public/rides/track/${token}`);assert(publicView.status===200&&publicView.body.tracking.rideId===rideId&&publicView.body.tracking.driver?.firstName,"bearer link exposes a deliberately scoped live ride view");
 const viewed=(await pool.query("SELECT view_count,last_viewed_at FROM ride_tracking_links WHERE public_id=$1",[created.link])).rows[0];assert(viewed.view_count===1&&viewed.last_viewed_at,"public views are counted without visitor identity collection");
 const sos=await request(`/rides/${rideId}/safety-incidents`,customer.token,{method:"POST",body:JSON.stringify({type:"sos",location:{lat:-34.59,lng:-58.39}})});created.incident=sos.body.incident?.id;assert(sos.status===201&&created.incident,"passenger creates a persisted urgent SOS incident");
 const incident=(await pool.query("SELECT incident_type,status,ST_Y(location::geometry) lat FROM ride_safety_incidents WHERE public_id=$1",[created.incident])).rows[0];assert(incident.incident_type==="sos"&&incident.status==="open"&&Number(incident.lat)===-34.59,"SOS retains exact evidence and open operations state");
 const notified=(await pool.query("SELECT count(*)::int count FROM notifications WHERE template='safety_sos' AND payload->>'incidentId'=$1",[created.incident])).rows[0].count;assert(notified>0,"SOS notifies operations and support accounts");
 const mismatched=await request(`/rides/RID-WRONG/tracking-links/${created.link}`,customer.token,{method:"DELETE"});assert(mismatched.status===404,"revocation binds the link to the ride URL and owner");
 const revoked=await request(`/rides/${rideId}/tracking-links/${created.link}`,customer.token,{method:"DELETE"});assert(revoked.status===200&&revoked.body.revoked,"passenger revokes the bearer link");
 const afterRevoke=await request(`/public/rides/track/${token}`);assert(afterRevoke.status===404,"revoked tracking token is unusable");
}finally{
 await pool.query("DELETE FROM notifications WHERE template='safety_sos' AND payload->>'rideId'=$1",[rideId]);
 await pool.query("DELETE FROM audit_events WHERE entity_type='ride' AND entity_id=$1",[rideId]);
 await pool.query("DELETE FROM jobs WHERE public_id=$1",[rideId]);
 await pool.end();
}
