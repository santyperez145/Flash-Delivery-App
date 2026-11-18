// Borrado de cuenta desde la app (LAN-001).
//
// Requisito de Apple y Google para publicar, y la parte técnica del derecho de
// supresión. El trabajo pesado lo hace `app.delete_customer_account` (migración
// 138), en una transacción y con los permisos de su dueño: este módulo verifica
// quién lo pide y traduce lo que la base rechaza a mensajes que se puedan
// mostrar.
//
// Vive aparte de `auth-repository.js` porque ese archivo es un monolito
// identificado en el hallazgo H-08.
import bcrypt from "bcryptjs";

import { postgresPool } from "./postgres.js";

const conflicto = (mensaje) => Object.assign(new Error(mensaje), { status: 409 });

/**
 * Lo que la función de la base rechaza, dicho para quien está borrando su cuenta.
 * Cada caso dice qué hacer, no sólo qué falta.
 */
const MOTIVOS = {
  FLASH_DELETE_ACTIVE_JOB: () =>
    conflicto("Tenés un pedido o envío en curso. Vas a poder eliminar la cuenta cuando termine."),
  FLASH_DELETE_WALLET_BALANCE: () =>
    conflicto(
      "Tenés saldo en tu Wallet. Escribinos desde Ayuda para devolvértelo antes de eliminar la cuenta.",
    ),
  // No es un error para quien lo pide: su borrado lo gestiona soporte. La ruta
  // lo convierte en una solicitud.
  FLASH_DELETE_ROLE: () =>
    Object.assign(new Error("La cuenta tiene roles que gestiona soporte"), {
      status: 409,
      requiereSoporte: true,
    }),
  FLASH_DELETE_NOT_FOUND: () => Object.assign(new Error("Cuenta no encontrada"), { status: 404 }),
};

/**
 * Borra (anonimiza) la cuenta de un cliente.
 *
 * **Pide la contraseña otra vez.** Una sesión abierta en un teléfono prestado o
 * perdido no alcanza para borrar una cuenta: es una acción que no se deshace.
 */
export async function deletePostgresCustomerAccount({ userPublicId, password }) {
  const usuario = (
    await postgresPool.query(
      "SELECT id, password_hash FROM users WHERE public_id=$1 AND status='active'",
      [userPublicId],
    )
  ).rows[0];
  if (!usuario) throw MOTIVOS.FLASH_DELETE_NOT_FOUND();
  if (!(await bcrypt.compare(String(password || ""), usuario.password_hash)))
    throw Object.assign(new Error("La contraseña no coincide"), { status: 403 });
  try {
    await postgresPool.query("SELECT app.delete_customer_account($1)", [usuario.id]);
  } catch (error) {
    const motivo = Object.keys(MOTIVOS).find((clave) => String(error.message).includes(clave));
    if (motivo) throw MOTIVOS[motivo]();
    throw error;
  }
}
