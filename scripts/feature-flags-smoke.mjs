import { spawn } from "node:child_process";
import { createPool } from "./db-client.mjs";

const port=4211,base=`http://127.0.0.1:${port}/api`,pool=createPool();
const api=spawn(process.execPath,["server/start.js"],{cwd:process.cwd(),env:{...process.env,NODE_ENV:"test",LOG_LEVEL:"silent",PORT:String(port),REQUIRE_ADMIN_MFA:"false"},stdio:["ignore","ignore","pipe"]});
api.stderr.on("data",data=>process.stderr.write(data));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=async(path,{token,method="GET",body}={})=>{const response=await fetch(`${base}${path}`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{}),...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});return{response,body:await response.json()};};
const login=async(email)=>(await call("/auth/login",{method:"POST",body:{email,password:"demo123",deviceName:"feature-flags-smoke"}})).body.token;
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
let adminToken;
try{
  for(let attempt=0;attempt<50;attempt+=1){try{if((await fetch(`${base}/health`)).ok)break;}catch{}await sleep(200);}
  const customerToken=await login("cliente@flash.app");adminToken=await login("ops@flash.app");
  const customer=await call("/features",{token:customerToken});
  assert(customer.response.status===200&&customer.body.features.delivery_beta.active===true&&customer.body.features.public_rides.active===false,"La evaluación inicial no respeta los gates");
  assert(!JSON.stringify(customer.body).includes("rolloutPercentage")&&!JSON.stringify(customer.body).includes("allowedRoles"),"El cliente recibió configuración interna");
  const forbidden=await call("/operations/feature-flags",{token:customerToken});assert(forbidden.response.status===403,"El cliente pudo enumerar flags internos");
  const flags=await call("/operations/feature-flags",{token:adminToken});const delivery=flags.body.flags.find(flag=>flag.key==="delivery_beta");assert(delivery,"Falta delivery_beta");
  const disabled=await call(`/operations/feature-flags/${delivery.id}`,{token:adminToken,method:"PATCH",body:{rolloutPercentage:0}});assert(disabled.response.ok,"No se pudo reducir rollout");
  const evaluated=await call("/features",{token:customerToken});assert(evaluated.body.features.delivery_beta.active===false,"Rollout 0 no desactivó el flag");
  const audit=(await pool.query("SELECT action FROM audit_events WHERE action='feature_flag.updated' ORDER BY occurred_at DESC LIMIT 1")).rows[0];assert(audit,"El cambio no quedó auditado");
  console.log("ok - flags por rol/ciudad, rollout, privacidad y auditoría verificados");
}finally{
  if(adminToken){const delivery=(await call("/operations/feature-flags",{token:adminToken})).body.flags?.find(flag=>flag.key==="delivery_beta");if(delivery)await call(`/operations/feature-flags/${delivery.id}`,{token:adminToken,method:"PATCH",body:{enabled:true,rolloutPercentage:100}});}
  api.kill("SIGTERM");await pool.end();
}
