import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createPool } from "./db-client.mjs";

const port=4212,base=`http://127.0.0.1:${port}/api`,pool=createPool(),ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
const api=spawn(process.execPath,["server/start.js"],{cwd:process.cwd(),env:{...process.env,NODE_ENV:"test",LOG_LEVEL:"silent",PORT:String(port),REQUIRE_ADMIN_MFA:"false"},stdio:["ignore","ignore","pipe"]});api.stderr.on("data",data=>process.stderr.write(data));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),assert=(value,message)=>{if(!value)throw new Error(message);};
const call=async(path,{token,method="GET",body}={})=>{const response=await fetch(`${base}${path}`,{method,headers:{...(token?{authorization:`Bearer ${token}`}:{"x-test":"none"}),...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});let payload;try{payload=await response.json();}catch{payload={};}return{response,payload};};
const login=async email=>(await call("/auth/login",{method:"POST",body:{email,password:"demo123",deviceName:"analytics-smoke"}})).payload.token;
try{
  for(let i=0;i<50;i+=1){try{if((await fetch(`${base}/health`)).ok)break;}catch{}await sleep(200);}
  const customer=await login("cliente@flash.app"),admin=await login("ops@flash.app"),sessionId=crypto.randomUUID(),occurredAt=new Date().toISOString();
  const events=ids.map((id,index)=>({id,name:["home_viewed","checkout_started","job_created"][index],surface:"customer_app",sessionId,occurredAt,properties:{vertical:"food"}}));
  const first=await call("/analytics/events",{token:customer,method:"POST",body:{events}});assert(first.response.status===202&&first.payload.accepted===3,"No se aceptó el lote válido");
  const duplicate=await call("/analytics/events",{token:customer,method:"POST",body:{events}});assert(duplicate.payload.accepted===0&&duplicate.payload.duplicates===3,"La deduplicación no es idempotente");
  const pii=await call("/analytics/events",{token:customer,method:"POST",body:{events:[{...events[0],id:crypto.randomUUID(),properties:{email:"persona@example.com"}}]}});assert(pii.response.status===400,"Analytics aceptó una propiedad sensible");
  const forbidden=await call("/operations/product-metrics",{token:customer});assert(forbidden.response.status===403,"Cliente pudo consultar agregados operativos");
  const metrics=await call("/operations/product-metrics?days=7",{token:admin});assert(metrics.response.ok&&metrics.payload.metrics.funnel.checkoutToCreatedPercent>=0,"No se calculó el embudo");
  console.log("ok - analytics first-party, dedupe, privacidad, RBAC y funnel verificados");
}finally{await pool.query("DELETE FROM product_events WHERE public_id=ANY($1::uuid[])",[ids]);api.kill("SIGTERM");await pool.end();}
