import crypto from "node:crypto";
import {config} from "./config.js";

const key=crypto.createHash("sha256").update(`flash:shipment-delivery-proof:v1:${config.deliveryProofEncryptionKey}`,"utf8").digest();

export function encryptDeliveryProof(buffer){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(buffer),cipher.final()]);
  return`${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptDeliveryProof(envelope){
  const parts=String(envelope).split(".");
  if(parts.length!==3)throw new Error("Sobre de evidencia inválido");
  const[iv,tag,data]=parts.map(value=>Buffer.from(value,"base64url")),decipher=crypto.createDecipheriv("aes-256-gcm",key,iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data),decipher.final()]);
}
