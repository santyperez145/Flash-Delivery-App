import crypto from "node:crypto";
import { postgresPool } from "./postgres.js";

const vehicleId=()=>`VEH-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const staff=roles=>roles.includes("admin")||roles.includes("support");
const modes=value=>Array.isArray(value)?value:String(value||"").replace(/^\{|\}$/g,"").split(",").filter(Boolean);
const mapVehicle=row=>({
  id:row.public_id,driverId:row.driver_public_id,kind:row.kind,model:row.model,
  plate:row.plate,color:row.color||null,seats:row.seats==null?null:Number(row.seats),
  serviceModes:modes(row.service_modes).map(mode=>mode==="ride"?"ride":"delivery"),
  active:row.active,status:row.status,rejectionReason:row.rejection_reason||null,
  reviewedAt:row.reviewed_at?new Date(row.reviewed_at).toISOString():null,
  retiredAt:row.retired_at?new Date(row.retired_at).toISOString():null,
  createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString(),
});

const select=`SELECT v.*,d.public_id driver_public_id,u.public_id user_public_id
  FROM vehicles v JOIN drivers d ON d.id=v.driver_id JOIN users u ON u.id=d.user_id`;
function assertCompatible({kind,seats,serviceModes}){if(modes(serviceModes).includes("ride")&&(!["car","van"].includes(kind)||!seats))throw Object.assign(new Error("Viajes requiere auto o van con asientos declarados"),{status:400});}

async function resolveDriver(client,{driverPublicId,actorPublicId,roles,lock=false}){
  const row=(await client.query(`SELECT d.id,d.public_id,u.public_id user_public_id FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.public_id=$1${lock?" FOR UPDATE OF d":""}`,[driverPublicId])).rows[0];
  if(!row)throw Object.assign(new Error("Conductor no encontrado"),{status:404});
  if(!staff(roles)&&row.user_public_id!==actorPublicId)throw Object.assign(new Error("No puedes gestionar vehículos de otro conductor"),{status:403});
  return row;
}

export async function getDriverVehicles({driverPublicId,actorPublicId,roles,includeRetired=false}){
  await resolveDriver(postgresPool,{driverPublicId,actorPublicId,roles});
  const result=await postgresPool.query(`${select} WHERE d.public_id=$1 ${includeRetired&&staff(roles)?"":"AND v.retired_at IS NULL"} ORDER BY v.active DESC,v.created_at DESC`,[driverPublicId]);
  return result.rows.map(mapVehicle);
}

export async function createDriverVehicle({driverPublicId,actorPublicId,roles,kind,model,plate,color,seats,serviceModes}){
  assertCompatible({kind,seats,serviceModes});
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const driver=await resolveDriver(client,{driverPublicId,actorPublicId,roles,lock:true});
    const count=Number((await client.query("SELECT count(*)::int count FROM vehicles WHERE driver_id=$1 AND retired_at IS NULL",[driver.id])).rows[0].count);
    if(count>=5)throw Object.assign(new Error("Puedes conservar hasta cinco vehículos"),{status:409});
    const hasActive=(await client.query("SELECT 1 FROM vehicles WHERE driver_id=$1 AND active",[driver.id])).rowCount>0;
    const row=(await client.query(`INSERT INTO vehicles(public_id,driver_id,kind,model,plate,color,seats,service_modes,active)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::job_kind[],$9) RETURNING public_id`,[vehicleId(),driver.id,kind,model,plate.toUpperCase(),color||null,seats||null,serviceModes,!hasActive])).rows[0];
    if(!hasActive)await client.query("UPDATE drivers SET online=false WHERE id=$1",[driver.id]);
    await client.query("COMMIT");return (await getDriverVehicles({driverPublicId,actorPublicId,roles,includeRetired:true})).find(item=>item.id===row.public_id);
  }catch(error){await client.query("ROLLBACK");if(error.code==="23505")throw Object.assign(new Error("La patente ya está registrada"),{status:409});throw error;}finally{client.release();}
}

export async function updateDriverVehicle({vehiclePublicId,actorPublicId,roles,changes}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const current=(await client.query(`${select} WHERE v.public_id=$1 FOR UPDATE OF v`,[vehiclePublicId])).rows[0];
    if(!current||current.retired_at)throw Object.assign(new Error("Vehículo no encontrado"),{status:404});
    if(!roles.includes("admin")&&current.user_public_id!==actorPublicId)throw Object.assign(new Error("No puedes modificar otro vehículo"),{status:403});
    const next={kind:changes.kind??current.kind,model:changes.model??current.model,plate:(changes.plate??current.plate).toUpperCase(),color:changes.color===undefined?current.color:changes.color,seats:changes.seats===undefined?current.seats:changes.seats,serviceModes:changes.serviceModes??current.service_modes};
    assertCompatible(next);
    await client.query(`UPDATE vehicles SET kind=$2,model=$3,plate=$4,color=$5,seats=$6,service_modes=$7::job_kind[],status='pending',rejection_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now() WHERE id=$1`,[current.id,next.kind,next.model,next.plate,next.color||null,next.seats||null,next.serviceModes]);
    if(current.active)await client.query("UPDATE drivers SET online=false WHERE id=$1",[current.driver_id]);
    await client.query("COMMIT");return (await getDriverVehicles({driverPublicId:current.driver_public_id,actorPublicId,roles,includeRetired:true})).find(item=>item.id===vehiclePublicId);
  }catch(error){await client.query("ROLLBACK");if(error.code==="23505")throw Object.assign(new Error("La patente ya está registrada"),{status:409});throw error;}finally{client.release();}
}

export async function activateDriverVehicle({vehiclePublicId,actorPublicId,roles}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const row=(await client.query(`${select} WHERE v.public_id=$1 FOR UPDATE OF v`,[vehiclePublicId])).rows[0];
    if(!row||row.retired_at)throw Object.assign(new Error("Vehículo no encontrado"),{status:404});
    if(!roles.includes("admin")&&row.user_public_id!==actorPublicId)throw Object.assign(new Error("No puedes activar otro vehículo"),{status:403});
    if(row.status!=="approved")throw Object.assign(new Error("El vehículo debe estar aprobado antes de activarlo"),{status:409});
    await client.query("UPDATE vehicles SET active=false,updated_at=now() WHERE driver_id=$1 AND active",[row.driver_id]);
    await client.query("UPDATE vehicles SET active=true,updated_at=now() WHERE id=$1",[row.id]);
    await client.query("UPDATE drivers SET online=false WHERE id=$1",[row.driver_id]);
    await client.query("COMMIT");return (await getDriverVehicles({driverPublicId:row.driver_public_id,actorPublicId,roles,includeRetired:true})).find(item=>item.id===vehiclePublicId);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function retireDriverVehicle({vehiclePublicId,actorPublicId,roles}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const row=(await client.query(`${select} WHERE v.public_id=$1 FOR UPDATE OF v`,[vehiclePublicId])).rows[0];
    if(!row||row.retired_at)throw Object.assign(new Error("Vehículo no encontrado"),{status:404});
    if(!roles.includes("admin")&&row.user_public_id!==actorPublicId)throw Object.assign(new Error("No puedes retirar otro vehículo"),{status:403});
    await client.query("UPDATE vehicles SET active=false,retired_at=now(),updated_at=now() WHERE id=$1",[row.id]);
    if(row.active)await client.query("UPDATE drivers SET online=false WHERE id=$1",[row.driver_id]);
    await client.query("COMMIT");return mapVehicle({...row,active:false,retired_at:new Date(),updated_at:new Date()});
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function reviewDriverVehicle({vehiclePublicId,actorPublicId,roles,status,rejectionReason}){
  if(!roles.includes("admin"))throw Object.assign(new Error("La revisión requiere rol administrador"),{status:403});
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const actor=(await client.query("SELECT id FROM users WHERE public_id=$1",[actorPublicId])).rows[0];
    const row=(await client.query(`${select} WHERE v.public_id=$1 FOR UPDATE OF v`,[vehiclePublicId])).rows[0];
    if(!row||row.retired_at)throw Object.assign(new Error("Vehículo no encontrado"),{status:404});
    if(row.status!=="pending")throw Object.assign(new Error("El vehículo ya fue revisado"),{status:409});
    await client.query("UPDATE vehicles SET status=$2,rejection_reason=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now() WHERE id=$1",[row.id,status,status==="rejected"?rejectionReason:null,actor?.id||null]);
    if(status!=="approved"&&row.active)await client.query("UPDATE drivers SET online=false WHERE id=$1",[row.driver_id]);
    await client.query("COMMIT");return (await getDriverVehicles({driverPublicId:row.driver_public_id,actorPublicId,roles,includeRetired:true})).find(item=>item.id===vehiclePublicId);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
