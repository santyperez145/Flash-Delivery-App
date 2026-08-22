import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import {deriveRidePickupPin} from "./secret-envelope.js";

const sha256=value=>crypto.createHash("sha256").update(value).digest("hex");
const publicId=prefix=>`${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
const activeStatuses=["requested","driver_assigned","arriving","in_progress"];

async function participant(client,{ridePublicId,userPublicId,lock=false}){
  const result=await client.query(`SELECT j.id,j.status,j.customer_id,d.user_id driver_user_id
    FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id
    WHERE j.public_id=$1 AND j.kind='ride' ${lock?"FOR UPDATE OF j":""}`,[ridePublicId]);
  const ride=result.rows[0];
  if(!ride)throw Object.assign(new Error("Viaje no encontrado"),{status:404});
  const user=(await client.query("SELECT id FROM users WHERE public_id=$1",[userPublicId])).rows[0];
  if(!user||(![ride.customer_id,ride.driver_user_id].includes(user.id)))throw Object.assign(new Error("No participas de este viaje"),{status:403});
  return{ride,user};
}

export async function createRideTrackingLink({ridePublicId,userPublicId,ttlMinutes=180}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const {ride,user}=await participant(client,{ridePublicId,userPublicId,lock:true});
    if(ride.customer_id!==user.id)throw Object.assign(new Error("Solo el pasajero puede compartir el viaje"),{status:403});
    if(!activeStatuses.includes(ride.status))throw Object.assign(new Error("Solo puedes compartir un viaje activo"),{status:409});
    await client.query("UPDATE ride_tracking_links SET revoked_at=COALESCE(revoked_at,now()) WHERE job_id=$1 AND created_by=$2 AND revoked_at IS NULL",[ride.id,user.id]);
    const token=crypto.randomBytes(32).toString("base64url"),id=publicId("RTL"),expiresAt=new Date(Date.now()+Math.min(1440,Math.max(15,ttlMinutes))*60000);
    await client.query("INSERT INTO ride_tracking_links(public_id,job_id,created_by,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)",[id,ride.id,user.id,sha256(token),expiresAt]);
    await client.query("COMMIT");return{id,token,expiresAt:expiresAt.toISOString()};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function revokeRideTrackingLink({ridePublicId,linkPublicId,userPublicId}){
  const result=await postgresPool.query(`UPDATE ride_tracking_links l SET revoked_at=COALESCE(l.revoked_at,now()) FROM users u,jobs j
    WHERE l.public_id=$1 AND l.created_by=u.id AND u.public_id=$2 AND l.job_id=j.id AND j.public_id=$3 RETURNING l.public_id`,[linkPublicId,userPublicId,ridePublicId]);
  if(!result.rows[0])throw Object.assign(new Error("Enlace no encontrado"),{status:404});return{revoked:true};
}

export async function getPublicRideTracking(token){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const result=await client.query(`SELECT l.id,j.public_id ride_id,j.status,j.pickup_address,j.dropoff_address,j.estimated_duration_s,j.updated_at,
      ST_Y(j.pickup_location::geometry) pickup_lat,ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat,ST_X(j.dropoff_location::geometry) dropoff_lng,
      ST_Y(d.current_location::geometry) driver_lat,ST_X(d.current_location::geometry) driver_lng,d.location_updated_at,
      du.name driver_name,v.model vehicle_model,v.color vehicle_color,v.plate vehicle_plate,l.expires_at
      FROM ride_tracking_links l JOIN jobs j ON j.id=l.job_id LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN users du ON du.id=d.user_id
      LEFT JOIN LATERAL(SELECT model,color,plate FROM vehicles WHERE driver_id=d.id AND active LIMIT 1)v ON true
      WHERE l.token_hash=$1 AND l.revoked_at IS NULL AND l.expires_at>now() FOR UPDATE OF l`,[sha256(token)]);
    const row=result.rows[0];if(!row)throw Object.assign(new Error("El enlace no existe o venció"),{status:404});
    await client.query("UPDATE ride_tracking_links SET view_count=view_count+1,last_viewed_at=now() WHERE id=$1",[row.id]);await client.query("COMMIT");
    return{rideId:row.ride_id,status:row.status,pickup:row.pickup_address,destination:row.dropoff_address,etaMin:Math.max(0,Math.ceil(Number(row.estimated_duration_s)/60)),updatedAt:new Date(row.updated_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),pickupLocation:{lat:Number(row.pickup_lat),lng:Number(row.pickup_lng)},destinationLocation:{lat:Number(row.dropoff_lat),lng:Number(row.dropoff_lng)},driver:row.driver_name?{firstName:String(row.driver_name).trim().split(/\s+/)[0],vehicle:[row.vehicle_color,row.vehicle_model].filter(Boolean).join(" "),plate:row.vehicle_plate||null,location:row.driver_lat==null?null:{lat:Number(row.driver_lat),lng:Number(row.driver_lng)},locationUpdatedAt:row.location_updated_at?new Date(row.location_updated_at).toISOString():null}:null};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function createRideSafetyIncident({ridePublicId,userPublicId,type,details,location}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");const {ride,user}=await participant(client,{ridePublicId,userPublicId,lock:true});
    if(!activeStatuses.includes(ride.status))throw Object.assign(new Error("El viaje ya no está activo"),{status:409});const id=publicId("SOS");
    await client.query(`INSERT INTO ride_safety_incidents(public_id,job_id,reporter_id,incident_type,details,location) VALUES($1,$2,$3,$4,$5,CASE WHEN $6::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$6),4326)::geography END)`,[id,ride.id,user.id,type,details||null,location?.lat??null,location?.lng??null]);
    await client.query(`INSERT INTO notifications(public_id,user_id,channel,template,payload,deduplication_key,status)
      SELECT 'NTF-'||upper(substr(md5(random()::text||u.id::text),1,8)),u.id,'in_app','safety_sos',$1,$2||':'||u.id,'sent' FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role IN('admin','support') ON CONFLICT DO NOTHING`,[{incidentId:id,rideId:ridePublicId,type},`safety-sos:${id}`]);
    await client.query("COMMIT");return{id,rideId:ridePublicId,type,status:"open",createdAt:new Date().toISOString()};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function getRidePickupCode({ridePublicId,userPublicId}){const client=await postgresPool.connect();try{const {ride,user}=await participant(client,{ridePublicId,userPublicId});if(ride.customer_id!==user.id)throw Object.assign(new Error("Solo el pasajero puede ver el PIN"),{status:403});if(!activeStatuses.includes(ride.status))throw Object.assign(new Error("El PIN ya no está disponible"),{status:409});const verification=(await client.query("SELECT verified_at FROM ride_pickup_verifications WHERE job_id=$1",[ride.id])).rows[0];if(!verification||verification.verified_at)throw Object.assign(new Error("El PIN ya fue utilizado"),{status:409});return{pickupCode:deriveRidePickupPin(ridePublicId)};}finally{client.release();}}

export async function verifyRidePickupCode({ridePublicId,userPublicId,pin}){const client=await postgresPool.connect();let transactionOpen=false;try{await client.query("BEGIN");transactionOpen=true;const {ride,user}=await participant(client,{ridePublicId,userPublicId,lock:true});if(ride.driver_user_id!==user.id)throw Object.assign(new Error("Solo el conductor asignado puede verificar el PIN"),{status:403});if(ride.status!=="arriving")throw Object.assign(new Error("El PIN se verifica al llegar por el pasajero"),{status:409});const verification=(await client.query("SELECT * FROM ride_pickup_verifications WHERE job_id=$1 FOR UPDATE",[ride.id])).rows[0];if(!verification)throw Object.assign(new Error("Verificación no disponible"),{status:409});if(verification.verified_at){await client.query("COMMIT");transactionOpen=false;return{verified:true,verifiedAt:new Date(verification.verified_at).toISOString()};}if(verification.locked_until&&new Date(verification.locked_until)>new Date())throw Object.assign(new Error("Verificación bloqueada temporalmente por intentos fallidos"),{status:429});const valid=await bcrypt.compare(pin,verification.pin_hash);if(!valid){const attempts=Math.min(5,Number(verification.failed_attempts)+1),locked=attempts>=5;await client.query("UPDATE ride_pickup_verifications SET failed_attempts=$2,locked_until=CASE WHEN $3 THEN now()+interval '10 minutes' ELSE NULL END,updated_at=now() WHERE job_id=$1",[ride.id,attempts,locked]);await client.query("COMMIT");transactionOpen=false;throw Object.assign(new Error(locked?"PIN incorrecto; verificación bloqueada temporalmente":"PIN incorrecto"),{status:locked?429:400,attemptsRemaining:Math.max(0,5-attempts)});}const verifiedAt=(await client.query("UPDATE ride_pickup_verifications SET verified_at=now(),verified_by=$2,failed_attempts=0,locked_until=NULL,updated_at=now() WHERE job_id=$1 RETURNING verified_at",[ride.id,user.id])).rows[0].verified_at;await client.query("COMMIT");transactionOpen=false;return{verified:true,verifiedAt:new Date(verifiedAt).toISOString()};}catch(error){if(transactionOpen)await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}}
