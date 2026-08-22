import { spawn } from "node:child_process";
import { createClient } from "redis";

const redisUrl=process.env.TEST_REDIS_URL||"redis://127.0.0.1:6379/15",ports=[4215,4216],children=[];
const redis=createClient({url:redisUrl});await redis.connect();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  for await(const key of redis.scanIterator({MATCH:"flash:rate:*",COUNT:100}))await redis.del(key);
  for(const port of ports){const child=spawn(process.execPath,["server/start.js"],{cwd:process.cwd(),env:{...process.env,NODE_ENV:"test",LOG_LEVEL:"silent",PORT:String(port),REDIS_URL:redisUrl,REDIS_REQUIRED:"true",RATE_LIMIT_MAX:"100",AUTH_RATE_LIMIT_MAX:"3"},stdio:["ignore","ignore","pipe"]});child.stderr.on("data",data=>process.stderr.write(data));children.push(child);}
  for(const port of ports){let ready=false;for(let attempt=0;attempt<60;attempt++){try{if((await fetch(`http://127.0.0.1:${port}/api/ready`)).ok){ready=true;break;}}catch{}await sleep(200);}if(!ready)throw new Error(`Instancia ${port} no inició con Redis`);}
  const statuses=[];for(let index=0;index<4;index++){const port=ports[index%ports.length],response=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"missing@example.com",password:"incorrecta"})});statuses.push(response.status);}
  if(statuses.slice(0,3).some(status=>status===429)||statuses[3]!==429)throw new Error(`Límite no compartido entre réplicas: ${statuses.join(",")}`);
  console.log("ok - dos réplicas comparten el límite Redis y readiness distribuido");
}finally{for(const child of children)child.kill("SIGTERM");for await(const key of redis.scanIterator({MATCH:"flash:rate:*",COUNT:100}))await redis.del(key);await redis.quit();}
