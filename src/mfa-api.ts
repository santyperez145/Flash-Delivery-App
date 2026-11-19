import { request } from "./api";
import type { MfaStatus } from "./types";

// Verificación en dos pasos de cualquier cuenta (SEG-08), aparte de `api.ts`
// porque ese archivo es un monolito identificado en el hallazgo H-08. Estado,
// activación y confirmación siguen en `api.ts`, donde ya estaban para el MFA
// administrativo y donde se guarda la sesión que emite la confirmación.

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
