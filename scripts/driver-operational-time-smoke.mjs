import pg from "pg";

const base=process.env.API_URL||"http://127.0.0.1:4000/api";
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,ssl:false});
const stamp=Date.now(),userPublicId=`USR-TIME-${stamp}`,driverPublicId=`DRV-TIME-${stamp}`,email=`driver-time-${stamp}@flash.test`,jobPrefix=`JOB-TIME-${stamp}`;
const requestIds=[];
let token="",userInternalId=null,driverInternalId=null;
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const assert=(value,label)=>{if(!value)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
const call=async(path,{authToken=token,...options}={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{"content-type":"application/json",...(authToken?{authorization:`Bearer ${authToken}`}:{})}});let body={};try{body=await response.json();}catch{}if(body.requestId)requestIds.push(body.requestId);return{status:response.status,body,headers:response.headers};};
const login=async(address)=>(await call("/auth/login",{authToken:"",method:"POST",body:JSON.stringify({email:address,password:"demo123",deviceName:"driver-operational-time-smoke"})})).body.token;

try{
  const password=(await pool.query("SELECT password_hash FROM users WHERE public_id='usr_admin'")).rows[0].password_hash;
  const user=(await pool.query("INSERT INTO users(public_id,email,password_hash,name,email_verified_at,profile) VALUES($1,$2,$3,'Driver Tiempo',now(),jsonb_build_object('driverId',$4::text)) RETURNING id",[userPublicId,email,password,driverPublicId])).rows[0];
  userInternalId=user.id;
  await pool.query("INSERT INTO user_roles(user_id,role) VALUES($1,'driver')",[user.id]);
  const driver=(await pool.query(`INSERT INTO drivers(public_id,user_id,online,active_mode,service_modes,current_location,location_updated_at,location_source,location_accuracy_m,metadata)
    VALUES($1,$2,false,'delivery',ARRAY['delivery','ride']::job_kind[],ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,now(),'foreground',8,'{"name":"Driver Tiempo"}') RETURNING id`,[driverPublicId,user.id])).rows[0];
  driverInternalId=driver.id;
  await pool.query("INSERT INTO driver_compliance(driver_id,status,submitted_at,reviewed_at) VALUES($1,'approved',now(),now())",[driver.id]);
  await pool.query(`INSERT INTO vehicles(public_id,driver_id,kind,model,plate,color,seats,active,service_modes,status,reviewed_at)
    VALUES($1,$2,'car','Vehículo de prueba',$3,'Negro',4,true,ARRAY['delivery','ride']::job_kind[],'approved',now())`,[`VEH-TIME-${stamp}`,driver.id,`TZ${String(stamp).slice(-8)}`]);
  token=await login(email);
  assert(Boolean(token),"fixture driver authenticates");

  const customerToken=await login("cliente@flash.app");
  assert((await call(`/drivers/${driverPublicId}/availability`,{authToken:customerToken,method:"PATCH",body:JSON.stringify({online:true})})).status===403,"another user cannot create a driver work session");

  assert((await call(`/drivers/${driverPublicId}/availability`,{method:"PATCH",body:JSON.stringify({online:true})})).status===200,"driver starts an online interval through the real availability endpoint");
  await wait(1200);
  const switched=await call(`/drivers/${driverPublicId}/availability`,{method:"PATCH",body:JSON.stringify({activeService:"ride"})});
  assert(switched.status===200&&switched.body.driver.activeService==="ride","online mode switch is accepted when vehicle eligibility is real");
  await wait(1200);
  assert((await call(`/drivers/${driverPublicId}/availability`,{method:"PATCH",body:JSON.stringify({online:false})})).status===200,"driver closes the online interval through the real endpoint");

  const availability=(await pool.query(`SELECT service_mode::text,start_reason,end_reason,started_at,ended_at
    FROM driver_availability_sessions WHERE driver_id=$1 ORDER BY started_at`,[driver.id])).rows;
  assert(availability.length===2&&availability[0].service_mode==="delivery"&&availability[0].end_reason==="mode_switch"&&availability[1].service_mode==="ride"&&availability[1].start_reason==="mode_switch"&&availability[1].end_reason==="offline"&&availability.every(row=>row.ended_at>row.started_at),"PostgreSQL preserves two closed, attributed availability intervals");
  await call(`/drivers/${driverPublicId}/availability`,{method:"PATCH",body:JSON.stringify({online:true})});
  await wait(1100);
  await pool.query("UPDATE drivers SET online=false WHERE id=$1",[driver.id]);
  const forcedOffline=(await pool.query("SELECT ended_at,end_reason FROM driver_availability_sessions WHERE driver_id=$1 ORDER BY started_at DESC LIMIT 1",[driver.id])).rows[0];
  assert(forcedOffline.ended_at&&forcedOffline.end_reason==="offline","database trigger closes time when compliance or operations disconnects supply outside the availability endpoint");

  const jobs=(await pool.query(`INSERT INTO jobs(public_id,kind,customer_id,status,pickup_address,pickup_location,dropoff_address,dropoff_location,service_level,quoted_amount_cents,distance_m,estimated_duration_s)
    SELECT $1 || '-' || sequence,'delivery',customer.id,'requested','Origen',ST_SetSRID(ST_MakePoint(-58.39,-34.60),4326)::geography,'Destino',ST_SetSRID(ST_MakePoint(-58.40,-34.61),4326)::geography,'standard',100000,1500,600
    FROM users customer CROSS JOIN generate_series(1,2) sequence WHERE customer.public_id='usr_customer' RETURNING id`,[jobPrefix])).rows;
  await pool.query("UPDATE jobs SET driver_id=$2,status='driver_assigned',updated_at=now() WHERE id=ANY($1)",[jobs.map(job=>job.id),driver.id]);
  await wait(1600);
  await pool.query("UPDATE jobs SET status='completed',updated_at=now() WHERE id=ANY($1)",[jobs.map(job=>job.id)]);
  const jobSessions=(await pool.query("SELECT start_reason,end_reason,started_at,ended_at FROM driver_job_sessions WHERE driver_id=$1 ORDER BY started_at",[driver.id])).rows;
  assert(jobSessions.length===2&&jobSessions.every(row=>row.start_reason==="offer_accepted"&&row.end_reason==="completed"&&row.ended_at>row.started_at),"assignment-to-completion intervals are captured for concurrent services");

  const response=await call("/driver/earnings"),earnings=response.body.earnings;
  const rawActiveSeconds=Number((await pool.query("SELECT COALESCE(sum(extract(epoch FROM ended_at-started_at)),0) seconds FROM driver_job_sessions WHERE driver_id=$1",[driver.id])).rows[0].seconds);
  assert(response.status===200&&response.headers.get("cache-control")?.includes("no-store")&&earnings.timeTracking.status==="available"&&earnings.timeTracking.source==="postgres-operational-sessions","earnings exposes private authoritative time provenance");
  assert(earnings.today.onlineSeconds>=2&&earnings.today.activeSeconds>=1,"today reports measured online and active durations instead of seeded hours");
  assert(rawActiveSeconds>earnings.today.activeSeconds*1.5,"overlapping assignments are unioned instead of double-counted");
}finally{
  await pool.query("SELECT set_config('app.audit_maintenance','on',false)");
  if(requestIds.length)await pool.query("DELETE FROM audit_events WHERE request_id=ANY($1)",[requestIds]);
  if(driverInternalId)await pool.query("DELETE FROM jobs WHERE driver_id=$1",[driverInternalId]);
  if(driverInternalId)await pool.query("DELETE FROM drivers WHERE id=$1",[driverInternalId]);
  if(userInternalId)await pool.query("DELETE FROM user_roles WHERE user_id=$1",[userInternalId]);
  if(userInternalId)await pool.query("DELETE FROM users WHERE id=$1",[userInternalId]);
  await pool.end();
}
