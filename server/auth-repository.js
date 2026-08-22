import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { postgresPool } from "./postgres.js";
import {encryptEmailVerificationCode,encryptRecoveryToken} from "./secret-envelope.js";

const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const tokenHash = (token) => crypto.createHash("sha256").update(String(token || "")).digest("hex");

export async function requestPasswordRecovery({email,requesterFingerprintHash}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const user=(await client.query("SELECT id,public_id FROM users WHERE email=$1 AND status='active' FOR UPDATE",[String(email).trim().toLowerCase()])).rows[0];
    if(!user){await client.query("COMMIT");return null;}
    await client.query("UPDATE password_recovery_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL",[user.id]);
    const token=crypto.randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+20*60*1000);
    await client.query("INSERT INTO password_recovery_tokens(user_id,token_hash,requester_fingerprint_hash,expires_at) VALUES($1,$2,$3,$4)",[user.id,tokenHash(token),requesterFingerprintHash||null,expiresAt]);
    await client.query(`INSERT INTO notifications(public_id,user_id,channel,template,payload,sensitive_payload_ciphertext,deduplication_key,status)
      VALUES($1,$2,'email','password_recovery',$3,$4,$5,'queued')`,[`NTF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,user.id,{expiresAt:expiresAt.toISOString()},encryptRecoveryToken(token),`password-recovery:${user.id}:${Date.now()}`]);
    await client.query(`INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) VALUES($1,ARRAY[]::user_role[],'auth.password_recovery_requested','user',$2,$3)`,[user.id,user.public_id,{expiresAt:expiresAt.toISOString()}]);
    await client.query("COMMIT");return{token,expiresAt:expiresAt.toISOString(),userPublicId:user.public_id};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function consumePasswordRecovery({token,password}){
  const client=await postgresPool.connect();try{await client.query("BEGIN");
    const row=(await client.query(`SELECT pr.id,pr.user_id,u.public_id,u.password_hash FROM password_recovery_tokens pr JOIN users u ON u.id=pr.user_id
      WHERE pr.token_hash=$1 AND pr.consumed_at IS NULL AND pr.expires_at>now() AND u.status='active' FOR UPDATE OF pr,u`,[tokenHash(token)])).rows[0];
    if(!row)throw Object.assign(new Error("El código no existe o venció"),{status:400});
    if(bcrypt.compareSync(password,row.password_hash))throw Object.assign(new Error("La contraseña nueva debe ser diferente"),{status:409});
    const passwordHash=bcrypt.hashSync(password,12);
    await client.query("UPDATE users SET password_hash=$2,failed_login_attempts=0,login_locked_until=NULL,updated_at=now() WHERE id=$1",[row.user_id,passwordHash]);
    await client.query("UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",[row.user_id]);
    const revokedSessions=(await client.query("UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL RETURNING id",[row.user_id])).rowCount;
    await client.query(`INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) VALUES($1,ARRAY[]::user_role[],'auth.password_recovered','user',$2,$3)`,[row.user_id,row.public_id,{revokedSessions}]);
    await client.query("COMMIT");return{userPublicId:row.public_id,revokedSessions};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

function mapUser(row) {
  if (!row) return null;
  const profile = row.profile && typeof row.profile === "object" ? row.profile : {};
  return {
    id: row.public_id,
    internalId: row.id,
    name: row.name,
    email: row.email,
    password: row.password_hash,
    roles: row.roles || [],
    phone: row.phone || "",
    wallet: Number(profile.wallet || 0),
    defaultAddress: profile.defaultAddress || "",
    restaurantId: profile.restaurantId || undefined,
    driverId: profile.driverId || undefined,
    status: row.status,
    emailVerifiedAt: row.email_verified_at ? new Date(row.email_verified_at).toISOString() : null,
    loginLockedUntil: row.login_locked_until ? new Date(row.login_locked_until).toISOString() : null
  };
}

const userSelect = `
  SELECT u.*, COALESCE(array_agg(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
`;

export function usesPostgresAuth() {
  return Boolean(postgresPool);
}

export async function findAuthUserByEmail(email) {
  const result = await postgresPool.query(
    `${userSelect} WHERE u.email = $1 AND u.status = 'active' GROUP BY u.id`,
    [String(email).trim().toLowerCase()]
  );
  return mapUser(result.rows[0]);
}

export async function findAuthUserByPublicId(publicId) {
  const result = await postgresPool.query(
    `${userSelect} WHERE u.public_id = $1 AND u.status = 'active' GROUP BY u.id`,
    [String(publicId)]
  );
  return mapUser(result.rows[0]);
}

export async function recordPostgresLoginFailure(email) {
  const result = await postgresPool.query(
    `UPDATE users SET
       failed_login_attempts = CASE WHEN login_locked_until IS NOT NULL AND login_locked_until <= now() THEN 1 ELSE failed_login_attempts + 1 END,
       login_locked_until = CASE
         WHEN (CASE WHEN login_locked_until IS NOT NULL AND login_locked_until <= now() THEN 1 ELSE failed_login_attempts + 1 END) >= 5
           THEN now() + interval '15 minutes'
         ELSE login_locked_until
       END,
       updated_at = now()
     WHERE email=$1 AND status='active'
     RETURNING failed_login_attempts,login_locked_until`,
    [String(email).trim().toLowerCase()]
  );
  return result.rows[0] || null;
}

export async function recordPostgresLoginSuccess(publicId) {
  await postgresPool.query(
    `UPDATE users SET failed_login_attempts=0,login_locked_until=NULL,last_login_at=now(),updated_at=now()
     WHERE public_id=$1`,
    [publicId]
  );
}

export async function getPostgresUsers({includeInactive=false}={}){const result=await postgresPool.query(`${userSelect} ${includeInactive?"":"WHERE u.status='active'"} GROUP BY u.id ORDER BY u.created_at`);return result.rows.map(mapUser);}

export async function getPostgresOperationsUserPage({limit=50,cursor=null,query=""}={}){
  const page=await postgresPool.query(`SELECT u.id,u.public_id,to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created_at FROM users u WHERE ($1='' OR u.public_id ILIKE '%'||$1||'%' OR u.name ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%') AND ($2::timestamptz IS NULL OR (u.created_at,u.id)>($2::timestamptz,$3::uuid)) ORDER BY u.created_at,u.id LIMIT $4`,[query.trim(),cursor?.createdAt||null,cursor?.id||null,limit+1]);
  const hasMore=page.rows.length>limit,rows=page.rows.slice(0,limit),ids=rows.map(row=>row.public_id);
  const result=ids.length?await postgresPool.query(`${userSelect} WHERE u.public_id=ANY($1::text[]) GROUP BY u.id`,[ids]):{rows:[]};
  const byId=new Map(result.rows.map(row=>{const {password,internalId,loginLockedUntil,...safe}=mapUser(row);return[safe.id,safe];})),last=rows.at(-1);
  return{users:rows.map(row=>byId.get(row.public_id)).filter(Boolean),nextCursor:hasMore&&last?Buffer.from(JSON.stringify({createdAt:last.cursor_created_at,id:last.id})).toString("base64url"):null};
}

export async function setPostgresUserStatus({targetPublicId,actorPublicId,actorRoles,status,reason,requestId}) {
  const client=await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor=(await client.query("SELECT id FROM users WHERE public_id=$1 AND status='active'",[actorPublicId])).rows[0];
    const target=(await client.query(`SELECT u.id,u.public_id,u.status,ARRAY(SELECT role::text FROM user_roles WHERE user_id=u.id) roles
      FROM users u WHERE u.public_id=$1 FOR UPDATE`,[targetPublicId])).rows[0];
    if(!actor||!target)throw Object.assign(new Error("Usuario no encontrado"),{status:404});
    if(target.public_id===actorPublicId)throw Object.assign(new Error("No puedes cambiar el estado de tu propia cuenta"),{status:409});
    if(target.status===status)throw Object.assign(new Error(`La cuenta ya está ${status==='active'?'activa':'suspendida'}`),{status:409});
    if(status==='suspended'&&target.roles.includes('admin')){
      const activeAdmins=Number((await client.query(`SELECT count(DISTINCT u.id)::int count FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE ur.role='admin' AND u.status='active'`)).rows[0].count);
      if(activeAdmins<=1)throw Object.assign(new Error("No se puede suspender al último administrador activo"),{status:409});
    }
    await client.query("UPDATE users SET status=$2,updated_at=now() WHERE id=$1",[target.id,status]);
    let revokedSessions=0,withdrawnOffers=0;
    if(status==='suspended'){
      revokedSessions=(await client.query("UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL RETURNING id",[target.id])).rowCount;
      const driver=(await client.query("UPDATE drivers SET online=false WHERE user_id=$1 RETURNING id",[target.id])).rows[0];
      if(driver)withdrawnOffers=(await client.query("UPDATE dispatch_offers SET status='withdrawn',responded_at=now() WHERE driver_id=$1 AND status='pending' RETURNING id",[driver.id])).rowCount;
    }
    await client.query(`INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,request_id,before_data,after_data)
      VALUES($1,$2::user_role[],$3,'user',$4,$5,$6,$7)`,[actor.id,actorRoles,status==='active'?'user.reactivated':'user.suspended',targetPublicId,requestId||null,{status:target.status},{status,reason,revokedSessions,withdrawnOffers}]);
    await client.query("COMMIT");
    return {id:targetPublicId,status,reason,revokedSessions,withdrawnOffers};
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
}

export async function getPostgresAddresses(userPublicId=null){const values=userPublicId?[userPublicId]:[],where=userPublicId?"WHERE u.public_id=$1":"";const [addresses,users]=await Promise.all([
  postgresPool.query(`SELECT a.id::text,u.public_id user_id,a.label,a.formatted_address address,ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,a.is_default,a.created_at,a.updated_at FROM addresses a JOIN users u ON u.id=a.user_id ${where} ORDER BY a.is_default DESC,a.created_at`,values),
  postgresPool.query(`SELECT public_id,profile->>'defaultAddress' address FROM users u ${userPublicId?"WHERE u.public_id=$1 AND COALESCE(profile->>'defaultAddress','')<>''":"WHERE COALESCE(profile->>'defaultAddress','')<>''"}`,values)]);
  const result=addresses.rows.map(row=>({id:row.id,userId:row.user_id,label:row.label,address:row.address,lat:Number(row.lat),lng:Number(row.lng),isDefault:row.is_default}));
  const represented=new Set(result.filter(entry=>entry.isDefault).map(entry=>entry.userId));for(const row of users.rows)if(!represented.has(row.public_id))result.push({id:`profile-${row.public_id}`,userId:row.public_id,label:"Principal",address:row.address,lat:null,lng:null,isDefault:true});return result;}

function mapAddress(row){return {id:String(row.id),userId:row.user_public_id,label:row.label,address:row.formatted_address,lat:Number(row.lat),lng:Number(row.lng),isDefault:row.is_default};}
const addressReturning=`a.id,a.label,a.formatted_address,a.is_default,ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,u.public_id user_public_id`;

export async function createPostgresAddress({userPublicId,label,address,lat,lng,isDefault}){const client=await postgresPool.connect();try{await client.query("BEGIN");const user=(await client.query("SELECT id FROM users WHERE public_id=$1 FOR UPDATE",[userPublicId])).rows[0];if(!user){const error=new Error("Usuario no existe");error.status=404;throw error;}const count=Number((await client.query("SELECT count(*)::int count FROM addresses WHERE user_id=$1",[user.id])).rows[0].count);if(count>=10){const error=new Error("Alcanzaste el máximo de 10 direcciones");error.status=409;throw error;}const makeDefault=Boolean(isDefault)||count===0;if(makeDefault)await client.query("UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND is_default",[user.id]);const result=await client.query(`INSERT INTO addresses(user_id,label,formatted_address,location,is_default) VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6) RETURNING *`,[user.id,label,address,lat,lng,makeDefault]);if(makeDefault)await client.query("UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE id=$1",[user.id,address]);await client.query("COMMIT");return mapAddress({...result.rows[0],user_public_id:userPublicId,lat,lng});}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function updatePostgresAddress({userPublicId,addressId,label,address,lat,lng,isDefault}){const client=await postgresPool.connect();try{await client.query("BEGIN");const owned=(await client.query("SELECT a.*,u.public_id user_public_id FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.public_id=$2 FOR UPDATE",[addressId,userPublicId])).rows[0];if(!owned){const error=new Error("Dirección no encontrada");error.status=404;throw error;}if(isDefault)await client.query("UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND id<>$2 AND is_default",[owned.user_id,addressId]);const result=await client.query(`UPDATE addresses a SET label=$3,formatted_address=$4,location=ST_SetSRID(ST_MakePoint($6,$5),4326)::geography,is_default=CASE WHEN $7 THEN true ELSE is_default END,updated_at=now() FROM users u WHERE a.id=$1 AND a.user_id=u.id AND u.public_id=$2 RETURNING ${addressReturning}`,[addressId,userPublicId,label,address,lat,lng,Boolean(isDefault)]);const updated=result.rows[0];if(updated.is_default)await client.query("UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE public_id=$1",[userPublicId,address]);await client.query("COMMIT");return mapAddress(updated);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function setPostgresDefaultAddress({userPublicId,addressId}){const client=await postgresPool.connect();try{await client.query("BEGIN");const owned=(await client.query("SELECT a.id,a.user_id,a.formatted_address FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.public_id=$2 FOR UPDATE",[addressId,userPublicId])).rows[0];if(!owned){const error=new Error("Dirección no encontrada");error.status=404;throw error;}await client.query("UPDATE addresses SET is_default=false,updated_at=now() WHERE user_id=$1 AND id<>$2 AND is_default",[owned.user_id,addressId]);await client.query("UPDATE addresses SET is_default=true,updated_at=CASE WHEN is_default THEN updated_at ELSE now() END WHERE id=$1",[addressId]);await client.query("UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE public_id=$1",[userPublicId,owned.formatted_address]);await client.query("COMMIT");return (await getPostgresAddresses(userPublicId)).find(entry=>entry.id===String(addressId));}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function deletePostgresAddress({userPublicId,addressId}){const client=await postgresPool.connect();try{await client.query("BEGIN");const owned=(await client.query("SELECT a.id,a.user_id,a.is_default FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.public_id=$2 FOR UPDATE",[addressId,userPublicId])).rows[0];if(!owned){const error=new Error("Dirección no encontrada");error.status=404;throw error;}await client.query("DELETE FROM addresses WHERE id=$1",[addressId]);if(owned.is_default){const replacement=(await client.query("UPDATE addresses SET is_default=true,updated_at=now() WHERE id=(SELECT id FROM addresses WHERE user_id=$1 ORDER BY created_at LIMIT 1) RETURNING formatted_address",[owned.user_id])).rows[0];await client.query("UPDATE users SET profile=jsonb_set(profile,'{defaultAddress}',to_jsonb($2::text),true),updated_at=now() WHERE public_id=$1",[userPublicId,replacement?.formatted_address||""]);}await client.query("COMMIT");return getPostgresAddresses(userPublicId);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function getPostgresPaymentMethods(){const result=await postgresPool.query(`SELECT pm.id::text,u.public_id user_id,pm.kind,pm.brand,pm.last4,pm.expiry_month,pm.expiry_year,pm.is_default FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.revoked_at IS NULL ORDER BY pm.created_at`);return result.rows.map(row=>({id:row.id,userId:row.user_id,type:row.kind,label:row.kind==="wallet"?"Flash Wallet":`${row.brand||row.kind} •••• ${row.last4||""}`.trim(),brand:row.brand||null,last4:row.last4||null,expiryMonth:row.expiry_month||null,expiryYear:row.expiry_year||null,isDefault:row.is_default}));}

export async function createSandboxPaymentMethod({userPublicId,providerToken,brand,last4,expiryMonth,expiryYear,isDefault=false}){const client=await postgresPool.connect();try{await client.query("BEGIN");const user=(await client.query("SELECT id FROM users WHERE public_id=$1 FOR UPDATE",[userPublicId])).rows[0];if(!user)throw Object.assign(new Error("Usuario no encontrado"),{status:404});const count=Number((await client.query("SELECT count(*)::int count FROM payment_methods WHERE user_id=$1 AND revoked_at IS NULL AND kind<>'wallet'",[user.id])).rows[0].count);if(count>=8)throw Object.assign(new Error("Alcanzaste el máximo de 8 métodos de pago"),{status:409});const makeDefault=Boolean(isDefault)||count===0;if(makeDefault)await client.query("UPDATE payment_methods SET is_default=false WHERE user_id=$1 AND revoked_at IS NULL",[user.id]);const row=(await client.query(`INSERT INTO payment_methods(user_id,provider,provider_payment_method_id,kind,brand,last4,expiry_month,expiry_year,is_default) VALUES($1,'sandbox',$2,'card',$3,$4,$5,$6,$7) RETURNING id::text`,[user.id,providerToken,brand,last4,expiryMonth,expiryYear,makeDefault])).rows[0];await client.query("COMMIT");return(await getPostgresPaymentMethods()).find(entry=>entry.id===row.id);}catch(error){await client.query("ROLLBACK");if(error.code==="23505")throw Object.assign(new Error("Ese método de pago ya fue registrado"),{status:409});throw error;}finally{client.release();}}

export async function setDefaultPostgresPaymentMethod({userPublicId,paymentMethodId}){const client=await postgresPool.connect();try{await client.query("BEGIN");const owned=(await client.query(`SELECT pm.id FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.id=$1 AND u.public_id=$2 AND pm.revoked_at IS NULL FOR UPDATE`,[paymentMethodId,userPublicId])).rows[0];if(!owned)throw Object.assign(new Error("Método de pago no encontrado"),{status:404});await client.query(`UPDATE payment_methods SET is_default=(id=$1) WHERE user_id=(SELECT id FROM users WHERE public_id=$2) AND revoked_at IS NULL`,[paymentMethodId,userPublicId]);await client.query("COMMIT");return(await getPostgresPaymentMethods()).find(entry=>entry.id===String(paymentMethodId));}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function revokePostgresPaymentMethod({userPublicId,paymentMethodId}){const client=await postgresPool.connect();try{await client.query("BEGIN");const owned=(await client.query(`SELECT pm.id,pm.user_id,pm.kind,pm.is_default FROM payment_methods pm JOIN users u ON u.id=pm.user_id WHERE pm.id=$1 AND u.public_id=$2 AND pm.revoked_at IS NULL FOR UPDATE`,[paymentMethodId,userPublicId])).rows[0];if(!owned)throw Object.assign(new Error("Método de pago no encontrado"),{status:404});if(owned.kind==="wallet")throw Object.assign(new Error("Flash Wallet no puede eliminarse"),{status:409});await client.query("UPDATE payment_methods SET revoked_at=now(),is_default=false WHERE id=$1",[paymentMethodId]);if(owned.is_default)await client.query(`UPDATE payment_methods SET is_default=true WHERE id=(SELECT id FROM payment_methods WHERE user_id=$1 AND revoked_at IS NULL ORDER BY CASE WHEN kind='wallet' THEN 0 ELSE 1 END,created_at LIMIT 1)`,[owned.user_id]);await client.query("COMMIT");return getPostgresPaymentMethods();}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

export async function registerAuthUser({ publicId, name, email, passwordHash, phone }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO users(public_id, name, email, password_hash, phone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [publicId, name, String(email).trim().toLowerCase(), passwordHash, phone || null]
    );
    await client.query("INSERT INTO user_roles(user_id, role) VALUES ($1, 'customer')", [inserted.rows[0].id]);
    await client.query("INSERT INTO payment_methods(user_id,provider,provider_payment_method_id,kind,is_default) VALUES($1,'flash_wallet',$2,'wallet',true)",[inserted.rows[0].id,`wallet:${publicId}`]);
    const verificationCode=await createEmailVerificationChallenge(client,{id:inserted.rows[0].id,publicId,email:String(email).trim().toLowerCase()});
    await client.query("COMMIT");
    return {...mapUser({ ...inserted.rows[0], roles: ["customer"] }),verificationCode};
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createEmailVerificationChallenge(client,user){
  await client.query("UPDATE email_verification_challenges SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND consumed_at IS NULL",[user.id]);
  const code=String(crypto.randomInt(100000,1000000)),expiresAt=new Date(Date.now()+10*60*1000);
  await client.query("INSERT INTO email_verification_challenges(user_id,code_hash,expires_at) VALUES($1,$2,$3)",[user.id,bcrypt.hashSync(code,12),expiresAt]);
  await client.query(`INSERT INTO notifications(public_id,user_id,channel,template,payload,sensitive_payload_ciphertext,deduplication_key,status)
    VALUES($1,$2,'email','email_verification',$3,$4,$5,'queued')`,[`NTF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,user.id,{expiresAt:expiresAt.toISOString()},encryptEmailVerificationCode(code),`email-verification:${user.id}:${Date.now()}`]);
  await client.query(`INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id,after_data) VALUES($1,ARRAY['customer']::user_role[],'auth.email_verification_requested','user',$2,$3)`,[user.id,user.publicId,{expiresAt:expiresAt.toISOString()}]);
  return{code,expiresAt:expiresAt.toISOString()};
}

export async function resendEmailVerification(email){
  const client=await postgresPool.connect();try{await client.query("BEGIN");const user=(await client.query("SELECT id,public_id FROM users WHERE email=$1 AND status='active' AND email_verified_at IS NULL FOR UPDATE",[String(email).trim().toLowerCase()])).rows[0];if(!user){await client.query("COMMIT");return null;}const challenge=await createEmailVerificationChallenge(client,{id:user.id,publicId:user.public_id,email});await client.query("COMMIT");return challenge;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function confirmEmailVerification({email,code}){
  const client=await postgresPool.connect();let committed=false;try{await client.query("BEGIN");const row=(await client.query(`SELECT c.*,u.public_id,u.email_verified_at FROM users u JOIN email_verification_challenges c ON c.user_id=u.id WHERE u.email=$1 AND u.status='active' AND c.consumed_at IS NULL ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c,u`,[String(email).trim().toLowerCase()])).rows[0];const valid=Boolean(row&&row.expires_at>new Date()&&row.failed_attempts<5&&bcrypt.compareSync(String(code),row.code_hash));if(!valid){if(row){const attempts=Math.min(5,Number(row.failed_attempts)+1);await client.query("UPDATE email_verification_challenges SET failed_attempts=$2::smallint,consumed_at=CASE WHEN $2::smallint>=5 THEN now() ELSE consumed_at END WHERE id=$1",[row.id,attempts]);}await client.query("COMMIT");committed=true;throw Object.assign(new Error("El código no existe, venció o agotó sus intentos"),{status:400});}await client.query("UPDATE email_verification_challenges SET consumed_at=now() WHERE id=$1",[row.id]);await client.query("UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1",[row.user_id]);await client.query(`INSERT INTO audit_events(actor_id,actor_roles,action,entity_type,entity_id) VALUES($1,ARRAY['customer']::user_role[],'auth.email_verified','user',$2)`,[row.user_id,row.public_id]);await client.query("COMMIT");committed=true;return findAuthUserByPublicId(row.public_id);}catch(error){if(!committed)await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function createPostgresSession(user, deviceName = "unknown") {
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + refreshLifetimeMs);
  await postgresPool.query(
    `INSERT INTO refresh_sessions(user_id, token_hash, device_name, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.internalId, tokenHash(refreshToken), String(deviceName).slice(0, 160), expiresAt]
  );
  return { refreshToken, expiresAt: expiresAt.toISOString() };
}

export async function rotatePostgresSession(refreshToken, deviceName = "unknown") {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id, user_id, device_name FROM refresh_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [tokenHash(refreshToken)]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query("UPDATE refresh_sessions SET revoked_at = now() WHERE id = $1", [current.rows[0].id]);
    const nextToken = crypto.randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + refreshLifetimeMs);
    await client.query(
      `INSERT INTO refresh_sessions(user_id, token_hash, device_name, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [current.rows[0].user_id, tokenHash(nextToken), String(deviceName || current.rows[0].device_name).slice(0, 160), expiresAt]
    );
    await client.query("COMMIT");
    const user = await findAuthUserByInternalId(current.rows[0].user_id);
    return user ? { user, refreshToken: nextToken, expiresAt: expiresAt.toISOString() } : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findAuthUserByInternalId(internalId) {
  const result = await postgresPool.query(`${userSelect} WHERE u.id = $1 GROUP BY u.id`, [internalId]);
  return mapUser(result.rows[0]);
}

export async function revokePostgresSession(refreshToken) {
  await postgresPool.query(
    "UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash(refreshToken)]
  );
}

export async function updatePostgresAuthProfile(publicId, { name, phone, defaultAddress }) {
  await postgresPool.query(
    `UPDATE users SET name = $2, phone = $3,
      profile = jsonb_set(profile, '{defaultAddress}', to_jsonb(COALESCE((SELECT formatted_address FROM addresses WHERE user_id=users.id AND is_default),$4)::text), true),
      updated_at = now()
     WHERE public_id = $1`,
    [publicId, name, phone || null, defaultAddress]
  );
  return findAuthUserByPublicId(publicId);
}
