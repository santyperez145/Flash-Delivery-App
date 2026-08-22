import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {createPool} from "./db-client.mjs";
const base=process.env.API_URL||"http://127.0.0.1:4000/api",pool=createPool(),email=`verify-${crypto.randomUUID()}@flash.test`,password="Verify123!";let userId=null,internalId=null;
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
async function call(path,body){const response=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};}
try{
 const registration=await call("/auth/register",{name:"Email Verification",email,password,deviceName:"email-verification-smoke"});userId=registration.body.user?.id;const code=registration.body.developmentCode;assert(registration.status===200&&userId&&registration.body.verificationRequired&&code&&!registration.body.token,"registration creates no session before email verification");
 const user=(await pool.query("SELECT id,email_verified_at FROM users WHERE public_id=$1",[userId])).rows[0];internalId=user.id;const challenge=(await pool.query("SELECT code_hash,failed_attempts FROM email_verification_challenges WHERE user_id=$1 AND consumed_at IS NULL",[internalId])).rows[0];assert(!user.email_verified_at&&challenge&&bcrypt.compareSync(code,challenge.code_hash)&&!challenge.code_hash.includes(code),"database stores only a bcrypt OTP hash for an unverified account");
 const outbox=(await pool.query("SELECT payload,sensitive_payload_ciphertext FROM notifications WHERE user_id=$1 AND template='email_verification' ORDER BY created_at DESC LIMIT 1",[internalId])).rows[0];assert(outbox?.sensitive_payload_ciphertext&&!JSON.stringify(outbox.payload).includes(code)&&!outbox.sensitive_payload_ciphertext.includes(code),"verification email stores its OTP only inside the encrypted worker payload");
 const blocked=await call("/auth/login",{email,password});assert(blocked.status===403&&blocked.body.verificationRequired,"valid credentials cannot authenticate an unverified account");
 for(let attempt=0;attempt<5;attempt+=1){const wrong=await call("/auth/email-verification/confirm",{email,code:"000000"});assert(wrong.status===400,`invalid OTP attempt ${attempt+1} is rejected (${wrong.status}: ${wrong.body.message||"no message"})`);}
 const locked=(await pool.query("SELECT failed_attempts,consumed_at FROM email_verification_challenges WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",[internalId])).rows[0];assert(locked.failed_attempts===5&&locked.consumed_at,"five failures consume the challenge");
 const resent=await call("/auth/email-verification/resend",{email}),expiredCode=resent.body.developmentCode;await pool.query("UPDATE email_verification_challenges SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 minute' WHERE user_id=$1 AND consumed_at IS NULL",[internalId]);const expired=await call("/auth/email-verification/confirm",{email,code:expiredCode});assert(expired.status===400,"expired OTP cannot activate the account");
 const finalChallenge=await call("/auth/email-verification/resend",{email}),verified=await call("/auth/email-verification/confirm",{email,code:finalChallenge.body.developmentCode});assert(verified.status===200&&verified.body.verified,"fresh OTP verifies the email exactly once");
 const replay=await call("/auth/email-verification/confirm",{email,code:finalChallenge.body.developmentCode}),login=await call("/auth/login",{email,password});assert(replay.status===400&&login.status===200&&login.body.token,"verified account authenticates and consumed OTP cannot replay");
 const redundant=await call("/auth/email-verification/resend",{email});assert(redundant.status===200&&!redundant.body.developmentCode,"resend response is generic and creates nothing for an already verified account");
}finally{
 if(internalId){await pool.query("DELETE FROM audit_events WHERE actor_id=$1 OR (entity_type='user' AND entity_id=$2)",[internalId,userId]);await pool.query("DELETE FROM users WHERE id=$1",[internalId]);}
 await pool.end();
}
