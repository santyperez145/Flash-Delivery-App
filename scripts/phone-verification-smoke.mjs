import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createPool } from "./db-client.mjs";

const base=process.env.API_URL||"http://127.0.0.1:4000/api",pool=createPool(),email=`phone-${crypto.randomUUID()}@flash.test`,password="Phone123!",phone=`+54911${crypto.randomInt(10000000,99999999)}`;let token="",userId=null,internalId=null;
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
async function call(path,body,authenticated=false){const response=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json",...(authenticated?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return{status:response.status,headers:response.headers,body:await response.json()};}
try{
 const registration=await call("/auth/register",{name:"Phone Verification",email,password,phone});userId=registration.body.user.id;const emailCode=registration.body.developmentCode;await call("/auth/email-verification/confirm",{email,code:emailCode});const login=await call("/auth/login",{email,password});token=login.body.token;assert(login.status===200&&token,"verified account authenticates before phone enrollment");
 const user=(await pool.query("SELECT id,phone_verified_at FROM users WHERE public_id=$1",[userId])).rows[0];internalId=user.id;assert(!user.phone_verified_at,"new phone starts unverified");
 const requested=await call("/me/phone-verification/request",{},true),code=requested.body.developmentCode;assert(requested.status===200&&/^\d{6}$/.test(code)&&requested.body.retryAfterSeconds===30,"sandbox issues a six-digit OTP with explicit retry buffer");
 const stored=(await pool.query("SELECT code_hash,provider,expires_at FROM phone_verification_challenges WHERE user_id=$1 AND consumed_at IS NULL",[internalId])).rows[0];assert(stored.provider==="sandbox"&&bcrypt.compareSync(code,stored.code_hash)&&!stored.code_hash.includes(code),"database stores only the bcrypt sandbox OTP hash");
 const throttled=await call("/me/phone-verification/request",{},true);assert(throttled.status===429&&throttled.headers.get("retry-after")==="30","immediate resend is throttled with Retry-After");
 for(let attempt=0;attempt<5;attempt+=1){const wrong=await call("/me/phone-verification/confirm",{code:"000000"},true);assert(wrong.status===400,`wrong phone OTP attempt ${attempt+1} is rejected`);}
 const exhausted=(await pool.query("SELECT failed_attempts,consumed_at FROM phone_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",[internalId])).rows[0];assert(exhausted.failed_attempts===5&&exhausted.consumed_at,"five failures consume the phone challenge");
 await pool.query("UPDATE phone_verification_challenges SET created_at=now()-interval '31 seconds' WHERE user_id=$1",[internalId]);const fresh=await call("/me/phone-verification/request",{},true),verified=await call("/me/phone-verification/confirm",{code:fresh.body.developmentCode},true);assert(verified.status===200&&verified.body.verified,"fresh phone OTP verifies ownership");
 const persisted=(await pool.query("SELECT phone_verified_at FROM users WHERE id=$1",[internalId])).rows[0];assert(persisted.phone_verified_at,"verification timestamp persists on the user");
}finally{if(internalId){await pool.query("DELETE FROM audit_events WHERE actor_id=$1 OR (entity_type='user' AND entity_id=$2)",[internalId,userId]);await pool.query("DELETE FROM users WHERE id=$1",[internalId]);}await pool.end();}
