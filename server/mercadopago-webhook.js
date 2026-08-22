import crypto from "node:crypto";

export function verifyMercadoPagoWebhook({xSignature,xRequestId,dataId,secret,now=Date.now,maxAgeMs=10*60*1000}){
  if(!xSignature||!xRequestId||!dataId||!secret)return false;
  const parts=new Map(String(xSignature).split(",").map(part=>part.trim().split("=",2)));
  const ts=parts.get("ts"),received=parts.get("v1");
  if(!ts||!received||!/^[0-9a-f]{64}$/i.test(received)||!/^\d{10,13}$/.test(ts))return false;
  const timestamp=Number(ts.length===10?`${ts}000`:ts);
  if(!Number.isFinite(timestamp)||Math.abs(now-timestamp)>maxAgeMs)return false;
  const normalizedId=/[a-z]/i.test(String(dataId))?String(dataId).toLowerCase():String(dataId);
  const manifest=`id:${normalizedId};request-id:${xRequestId};ts:${ts};`;
  const expected=crypto.createHmac("sha256",secret).update(manifest).digest();
  const candidate=Buffer.from(received,"hex");
  return candidate.length===expected.length&&crypto.timingSafeEqual(candidate,expected);
}
