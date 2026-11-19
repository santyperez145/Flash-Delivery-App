import { request } from "./api";

// Borrado de cuenta (LAN-001), aparte de `api.ts` porque ese archivo es un
// monolito identificado en el hallazgo H-08.
//
// `deleted`: la cuenta se anonimizó y las sesiones se cerraron.
// `requested`: la cuenta tiene roles con pagos u obligaciones pendientes, y
// quedó una solicitud a soporte.
// `mfaCode`: con la verificación en dos pasos activa (SEG-08), además de la contraseña.
export const deleteAccount = (password: string, mfaCode?: string) =>
  request<{ status: "deleted" | "requested" }>("/me/delete", {
    method: "POST",
    body: JSON.stringify({ password, ...(mfaCode ? { mfaCode } : {}) }),
  });
