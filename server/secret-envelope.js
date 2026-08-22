import crypto from "node:crypto";
import { config } from "./config.js";

const encryptionKey=crypto.createHash("sha256").update(config.pushTokenEncryptionKey,"utf8").digest();
const hashKey=crypto.createHmac("sha256",encryptionKey).update("flash-device-token-dedup-v1").digest();
const mfaKey=crypto.createHash("sha256").update(config.mfaEncryptionKey,"utf8").digest();
const recoveryKey=crypto.createHash("sha256").update(config.recoveryTokenEncryptionKey,"utf8").digest();
const trustedContactKey=crypto.createHmac("sha256",recoveryKey).update("flash-trusted-contact-v1").digest();
const serviceChatKey=crypto.createHmac("sha256",recoveryKey).update("flash-service-chat-v1").digest();
const serviceAttachmentKey=crypto.createHmac("sha256",recoveryKey).update("flash-service-attachment-v1").digest();
const shipmentClaimEvidenceKey=crypto.createHmac("sha256",recoveryKey).update("flash-shipment-claim-evidence-v1").digest();

export function hashDeviceToken(value){return crypto.createHmac("sha256",hashKey).update(String(value),"utf8").digest("hex");}

export function encryptDeviceToken(value){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey,iv);
  const ciphertext=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();
  return ["v1",iv.toString("base64url"),tag.toString("base64url"),ciphertext.toString("base64url")].join(".");
}

export function decryptDeviceToken(envelope){
  const [version,iv,tag,ciphertext]=String(envelope||"").split(".");
  if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid device token envelope");
  const decipher=crypto.createDecipheriv("aes-256-gcm",encryptionKey,Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}

export function deriveDeliveryPin(publicId){const digest=crypto.createHmac("sha256",config.deliveryPinSecret).update(`shipment:${publicId}`,"utf8").digest();return String(1000+(digest.readUInt32BE(0)%9000));}
export function deriveRidePickupPin(publicId){const digest=crypto.createHmac("sha256",config.deliveryPinSecret).update(`ride-pickup:${publicId}`,"utf8").digest();return String(1000+(digest.readUInt32BE(0)%9000));}

export function encryptMfaSecret(value){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",mfaKey,iv);cipher.setAAD(Buffer.from("flash-admin-mfa-v1"));
  const ciphertext=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();
  return ["v1",iv.toString("base64url"),tag.toString("base64url"),ciphertext.toString("base64url")].join(".");
}
export function decryptMfaSecret(envelope){
  const [version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid MFA secret envelope");
  const decipher=crypto.createDecipheriv("aes-256-gcm",mfaKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-admin-mfa-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}
export function encryptRecoveryToken(value){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",recoveryKey,iv);cipher.setAAD(Buffer.from("flash-password-recovery-v1"));const ciphertext=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();return["v1",iv.toString("base64url"),tag.toString("base64url"),ciphertext.toString("base64url")].join(".");
}
export function decryptRecoveryToken(envelope){
  const[version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid recovery token envelope");const decipher=crypto.createDecipheriv("aes-256-gcm",recoveryKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-password-recovery-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}
export function encryptEmailVerificationCode(value){
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",recoveryKey,iv);cipher.setAAD(Buffer.from("flash-email-verification-v1"));const ciphertext=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();return["v1",iv.toString("base64url"),tag.toString("base64url"),ciphertext.toString("base64url")].join(".");
}
export function decryptEmailVerificationCode(envelope){
  const[version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid verification code envelope");const decipher=crypto.createDecipheriv("aes-256-gcm",recoveryKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-email-verification-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");
}
export function hashTrustedContactPhone(value){return crypto.createHmac("sha256",trustedContactKey).update(String(value),"utf8").digest("hex");}
export function encryptTrustedContactPhone(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",trustedContactKey,iv);cipher.setAAD(Buffer.from("flash-trusted-contact-phone-v1"));const ciphertext=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();return["v1",iv.toString("base64url"),tag.toString("base64url"),ciphertext.toString("base64url")].join(".");}
export function decryptTrustedContactPhone(envelope){const[version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid trusted contact envelope");const decipher=crypto.createDecipheriv("aes-256-gcm",trustedContactKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-trusted-contact-phone-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");}
export function encryptServiceMessage(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",serviceChatKey,iv);cipher.setAAD(Buffer.from("flash-service-message-v1"));const ciphertext=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]),tag=cipher.getAuthTag();return["v1",iv.toString("base64url"),tag.toString("base64url"),ciphertext.toString("base64url")].join(".");}
export function decryptServiceMessage(envelope){const[version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid service message envelope");const decipher=crypto.createDecipheriv("aes-256-gcm",serviceChatKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-service-message-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8");}
export function encryptServiceAttachment(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",serviceAttachmentKey,iv);cipher.setAAD(Buffer.from("flash-service-attachment-v1"));const ciphertext=Buffer.concat([cipher.update(value),cipher.final()]);return["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(".");}
export function decryptServiceAttachment(envelope){const[version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid service attachment envelope");const decipher=crypto.createDecipheriv("aes-256-gcm",serviceAttachmentKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-service-attachment-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]);}
export function encryptShipmentClaimEvidence(value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",shipmentClaimEvidenceKey,iv);cipher.setAAD(Buffer.from("flash-shipment-claim-evidence-v1"));const ciphertext=Buffer.concat([cipher.update(value),cipher.final()]);return["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(".");}
export function decryptShipmentClaimEvidence(envelope){const[version,iv,tag,ciphertext]=String(envelope||"").split(".");if(version!=="v1"||!iv||!tag||!ciphertext)throw new Error("Invalid shipment claim evidence envelope");const decipher=crypto.createDecipheriv("aes-256-gcm",shipmentClaimEvidenceKey,Buffer.from(iv,"base64url"));decipher.setAAD(Buffer.from("flash-shipment-claim-evidence-v1"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]);}
