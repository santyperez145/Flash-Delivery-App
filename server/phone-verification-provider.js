import crypto from "node:crypto";
import { config } from "./config.js";

const twilioBase = "https://verify.twilio.com/v2/Services";

async function twilioRequest(path, values) {
  const credentials = Buffer.from(
    `${config.phoneVerification.accountSid}:${config.phoneVerification.authToken}`,
  ).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${twilioBase}/${config.phoneVerification.serviceSid}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(values),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(new Error("El proveedor no pudo procesar la verificación"), {
        status: response.status === 429 ? 429 : 502,
        providerStatus: response.status,
        providerCode: body.code,
      });
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function startPhoneVerification(phone) {
  if (config.phoneVerification.provider === "disabled")
    throw Object.assign(new Error("Verificación telefónica no configurada"), { status: 503 });
  if (config.phoneVerification.provider === "sandbox")
    return {
      providerReference: `sandbox-${crypto.randomUUID()}`,
      developmentCode: String(crypto.randomInt(100000, 1000000)),
    };
  const result = await twilioRequest("/Verifications", { To: phone, Channel: "sms" });
  return { providerReference: result.sid };
}

export async function checkPhoneVerification(phone, code) {
  if (config.phoneVerification.provider !== "twilio") return false;
  try {
    const result = await twilioRequest("/VerificationCheck", { To: phone, Code: code });
    return result.status === "approved";
  } catch (error) {
    if (error.providerStatus === 404 || error.providerCode === 20404) return false;
    throw error;
  }
}
