import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files=execFileSync("git",["ls-files","-co","--exclude-standard"],{encoding:"utf8"}).split(/\r?\n/).filter(Boolean).filter(file=>!file.endsWith("package-lock.json")&&!file.startsWith("dist/")&&!file.includes("node_modules/"));
const rules=[
  ["private key",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key",/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["GitHub token",/\bgh[opusr]_[A-Za-z0-9_]{30,255}\b/],
  ["Slack token",/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["Stripe live key",/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ["Google API key",/\bAIza[0-9A-Za-z_-]{35}\b/],
];
const findings=[];
for(const file of files){let content;try{content=fs.readFileSync(file,"utf8");}catch{continue;}for(const[name,pattern]of rules){const match=pattern.exec(content);if(match)findings.push(`${file}:${content.slice(0,match.index).split(/\r?\n/).length} ${name}`);}}
if(findings.length){console.error(findings.join("\n"));process.exitCode=1;}else console.log(`ok - ${files.length} archivos sin credenciales de proveedor ni claves privadas detectables`);
