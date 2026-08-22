import crypto from "node:crypto";
import {config} from "./config.js";
const key=crypto.createHash("sha256").update(config.kycDocumentEncryptionKey,"utf8").digest();
export function encryptDocument(buffer){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv),encrypted=Buffer.concat([cipher.update(buffer),cipher.final()]);return`${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;}
export function decryptDocument(envelope){const[iv,tag,data]=String(envelope).split(".").map(value=>Buffer.from(value,"base64url"));const decipher=crypto.createDecipheriv("aes-256-gcm",key,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]);}
