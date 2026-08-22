import pg from "pg";

const base=process.env.API_URL||"http://127.0.0.1:4000/api";
const pool=new pg.Pool({connectionString:process.env.MIGRATION_DATABASE_URL||process.env.DATABASE_URL,ssl:false});
const assert=(value,label)=>{if(!value)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
const call=async(path,{token,...options}={})=>{const response=await fetch(`${base}${path}`,{...options,headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})}});let body={};try{body=await response.json();}catch{}return{status:response.status,body,headers:response.headers};};
const login=async(email)=>(await call("/auth/login",{method:"POST",body:JSON.stringify({email,password:"demo123",deviceName:"driver-demand-smoke"})})).body.token;

try{
  const driverToken=await login("conductor@flash.app"),customerToken=await login("cliente@flash.app");
  assert(Boolean(driverToken&&customerToken),"fixtures can authenticate");
  assert((await call("/driver/demand-zones")).status===401,"anonymous cannot read private driver demand");
  assert((await call("/driver/demand-zones",{token:customerToken})).status===403,"customer cannot read driver supply signals");
  const response=await call("/driver/demand-zones",{token:driverToken}),demand=response.body.demand;
  assert(response.status===200&&response.headers.get("cache-control")?.includes("no-store")&&demand?.source==="postgres-live-window","driver receives a private live PostgreSQL snapshot");
  assert(demand.methodology.forecast===false&&demand.methodology.pricingImpact===false,"snapshot never claims prediction or surge pricing");
  const profile=(await pool.query("SELECT d.city_id,d.active_mode FROM drivers d JOIN users u ON u.id=d.user_id WHERE u.public_id='usr_driver'")).rows[0];
  const expected=await pool.query(`SELECT z.public_id,
    (SELECT count(*)::int FROM jobs j WHERE j.city_id=$1 AND j.kind=$2::job_kind AND j.driver_id IS NULL AND j.status NOT IN('completed','cancelled') AND (COALESCE(j.metadata->>'subtype','')<>'food_order' OR j.status='ready_for_pickup') AND (j.scheduled_for IS NULL OR j.scheduled_for<=now()+interval '15 minutes') AND ST_Covers(z.boundary::geometry,j.pickup_location::geometry)) open_jobs,
    (SELECT count(*)::int FROM drivers candidate JOIN driver_compliance compliance ON compliance.driver_id=candidate.id AND compliance.status='approved' WHERE candidate.city_id=$1 AND candidate.online AND candidate.active_mode=$2::job_kind AND $2::job_kind=ANY(candidate.service_modes) AND candidate.current_location IS NOT NULL AND candidate.location_updated_at>=now()-interval '5 minutes' AND COALESCE(candidate.location_accuracy_m,999)<=100 AND ST_Covers(z.boundary::geometry,candidate.current_location::geometry) AND EXISTS(SELECT 1 FROM vehicles vehicle WHERE vehicle.driver_id=candidate.id AND vehicle.active AND vehicle.retired_at IS NULL AND vehicle.status='approved' AND $2::job_kind=ANY(vehicle.service_modes)) AND (($2::job_kind='ride' AND NOT EXISTS(SELECT 1 FROM jobs active WHERE active.driver_id=candidate.id AND active.kind='ride' AND active.status NOT IN('completed','cancelled'))) OR ($2::job_kind<>'ride' AND (SELECT count(*) FROM jobs active WHERE active.driver_id=candidate.id AND active.kind=$2::job_kind AND active.status NOT IN('completed','cancelled'))<2))) eligible_drivers
    FROM service_zones z WHERE z.city_id=$1 AND z.active`,[profile.city_id,profile.active_mode]);
  const expectedById=new Map(expected.rows.map(row=>[row.public_id,{openJobs:Number(row.open_jobs),eligibleDrivers:Number(row.eligible_drivers)}]));
  assert(demand.zones.length===expected.rows.length&&demand.zones.every(zone=>zone.openJobs===expectedById.get(zone.id)?.openJobs&&zone.eligibleDrivers===expectedById.get(zone.id)?.eligibleDrivers),"zone counts equal authoritative jobs and eligible fresh supply");
  assert(demand.zones.every(zone=>zone.boundary.length>=4&&zone.boundary.every(point=>Number.isFinite(point.lat)&&Number.isFinite(point.lng))),"only aggregated zone geometry is exposed");
  assert(demand.zones.every(zone=>zone.level===(zone.openJobs>=3&&zone.openJobs>zone.eligibleDrivers?"high":zone.openJobs>0?"medium":"low")),"documented demand bands are deterministic");
}finally{await pool.end();}
