import { authenticator } from "otplib";
import { createPool } from "./db-client.mjs";

const base=process.env.API_URL||"http://127.0.0.1:4000/api",pool=createPool();
let token="";
const assert=(condition,label)=>{if(!condition)throw new Error(`failed: ${label}`);console.log(`ok - ${label}`);};
async function request(path,init={}){const response=await fetch(`${base}${path}`,{...init,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{}) ,...(init.headers||{})}});return {status:response.status,body:await response.json()};}

try{
  await pool.query(`DELETE FROM user_mfa WHERE user_id=(SELECT id FROM users WHERE public_id='usr_admin')`);
  const login=await request("/auth/login",{method:"POST",body:JSON.stringify({email:"ops@flash.app",password:"demo123"})});token=login.body.token;
  assert(login.status===200&&token&&!login.body.mfaRequired,"admin can bootstrap MFA while it is not enabled");
  const enrollment=await request("/auth/mfa/enroll",{method:"POST",body:"{}"});
  assert(enrollment.status===200&&enrollment.body.enrollment?.secret&&enrollment.body.enrollment.recoveryCodes?.length===8,"enrollment returns TOTP URI and one-time recovery codes");
  const secret=enrollment.body.enrollment.secret,recovery=enrollment.body.enrollment.recoveryCodes[0],oldToken=token;
  const stored=(await pool.query(`SELECT secret_ciphertext,recovery_code_hashes FROM user_mfa WHERE user_id=(SELECT id FROM users WHERE public_id='usr_admin')`)).rows[0];
  assert(stored.secret_ciphertext!==secret&&!stored.secret_ciphertext.includes(secret)&&stored.recovery_code_hashes.every(hash=>!hash.includes(recovery)),"TOTP secret is AES-GCM encrypted and recovery codes are one-way hashes at rest");
  const confirmation=await request("/auth/mfa/confirm",{method:"POST",body:JSON.stringify({code:authenticator.generate(secret)})});
  assert(confirmation.status===200&&confirmation.body.mfa?.enabled&&confirmation.body.token,"valid TOTP activates MFA and issues stepped-up session");
  token=oldToken;assert((await request("/admin/dashboard")).status===403,"pre-MFA access token loses administrative privileges");
  const unprivilegedState=await request("/operations/audit-events");assert(unprivilegedState.status===403,"pre-MFA token cannot read administrative audit resources");
  token="";const challenged=await request("/auth/login",{method:"POST",body:JSON.stringify({email:"ops@flash.app",password:"demo123"})});
  assert(challenged.status===200&&challenged.body.mfaRequired&&!challenged.body.token&&challenged.body.mfaChallenge,"password alone only issues a short MFA challenge");
  const completed=await request("/auth/mfa/complete",{method:"POST",body:JSON.stringify({challenge:challenged.body.mfaChallenge,code:recovery})});token=completed.body.token;
  assert(completed.status===200&&token&&completed.body.verification?.recoveryCodeUsed,"recovery code can complete MFA once");
  assert((await request("/admin/dashboard")).status===200,"stepped-up token can access administration");
  token="";const challengedAgain=await request("/auth/login",{method:"POST",body:JSON.stringify({email:"ops@flash.app",password:"demo123"})});
  const reused=await request("/auth/mfa/complete",{method:"POST",body:JSON.stringify({challenge:challengedAgain.body.mfaChallenge,code:recovery})});
  assert(reused.status===401,"consumed recovery code cannot be reused");
}finally{
  await pool.query(`DELETE FROM user_mfa WHERE user_id=(SELECT id FROM users WHERE public_id='usr_admin')`);
  await pool.end();
}
