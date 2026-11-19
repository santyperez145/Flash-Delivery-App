// Segundo factor para acciones sensibles (SEG-08).
//
// Con la verificación en dos pasos activa, eliminar la cuenta, desvincular el
// cobro de un comercio o autorizar un retiro piden, además de la contraseña, un
// código de la app autenticadora. Con la contraseña sola (robada o adivinada) no
// alcanza para llevarse la plata ni para borrar la cuenta.
import { requireMfaCodeIfEnabled } from "../mfa-repository.js";
import { failFrom } from "./responses.js";

/** Lanza 403 con `mfaRequired` si falta el código, o el error de verificación. */
export const stepUpMfa = (req, code) =>
  requireMfaCodeIfEnabled({ userPublicId: req.auth.userId, code: code ? String(code) : "" });

/**
 * Como `failFrom`, pero un error que pide el código lleva `mfaRequired: true`:
 * es lo que el cliente usa para mostrar el campo en vez de un error genérico.
 */
export function failFromStepUp(res, error, fallback) {
  if (!error?.mfaRequired) return failFrom(res, error, fallback);
  return res.status(403).json({
    ok: false,
    requestId: res.locals.requestId,
    message: error.message,
    mfaRequired: true,
  });
}
