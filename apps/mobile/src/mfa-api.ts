import { request } from "./api";
import type { MfaEnrollment, MfaStatus } from "./types";

// Verificación en dos pasos de cualquier cuenta (SEG-08), aparte de `api.ts`
// porque ese archivo es un monolito identificado en el hallazgo H-08. El ingreso
// con código y la confirmación siguen en `api.ts`: son las que guardan la sesión.

export const getMfaStatus = () => request<{ mfa: MfaStatus }>("/auth/mfa/status");

export const enrollMfa = () =>
  request<{ enrollment: MfaEnrollment }>("/auth/mfa/enroll", { method: "POST", body: "{}" });

/** Pide un código vigente: con la sesión sola no se apaga la protección. */
export const disableMfa = (code: string) =>
  request<{ mfa: MfaStatus }>("/auth/mfa/disable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

/** Ocho códigos nuevos; los anteriores dejan de servir. */
export const regenerateMfaRecoveryCodes = (code: string) =>
  request<{ mfa: MfaStatus; recoveryCodes: string[] }>("/auth/mfa/recovery-codes", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
