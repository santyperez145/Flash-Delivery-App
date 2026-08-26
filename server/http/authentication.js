// Autenticación HTTP (ticket ARC-001, paso 5).
//
// Cuarto módulo compartido extraído de `server/index.js`, y el último de los
// siete que un grupo de rutas necesitaba del archivo grande. Con éste, un router
// nuevo ya no recibe nada por factory: importa lo que usa.
//
// La división con [`authorization.js`](authorization.js) es deliberada y no es
// cosmética. Este archivo responde **quién sos** —verifica el token, resuelve el
// usuario y arma `req.auth`—; el otro responde **qué podés hacer** con esa
// identidad. Son las dos preguntas que el hallazgo H-08 dejaba mezcladas en un
// archivo de 9.500 líneas, y separarlas es lo que permite que la segunda sea
// pura y verificable sin levantar nada.
//
// Este módulo, en cambio, **no puede ser puro**: tiene que consultar el usuario
// y, si es administrador, su estado de MFA. Esa asimetría es la razón de que la
// autorización se haya extraído primero.
import jwt from "jsonwebtoken";

import { findAuthUserByPublicId, usesPostgresAuth } from "../auth-repository.js";
import { config } from "../config.js";
import { readDb } from "../fallback-runtime.js";
import { getAdminMfaStatus } from "../mfa-repository.js";
import { fail } from "./responses.js";

/**
 * Token del header `Authorization`.
 *
 * Devuelve cadena vacía ante cualquier forma que no sea `Bearer <token>`, en
 * lugar de intentar rescatar algo: un header mal armado es un pedido sin token,
 * no un pedido con un token raro.
 */
export function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

/**
 * Verifica el token y arma `req.auth`.
 *
 * Un token válido cuyo usuario ya no existe se rechaza igual. Ese caso no es
 * teórico: una cuenta dada de baja conserva tokens firmados hasta que expiran, y
 * confiar en el `sub` del token sin comprobar la cuenta los mantendría vivos.
 *
 * `mfa` se resuelve acá y no en cada handler para que
 * [`isAdmin`](authorization.js) pueda ser una función pura: la consulta de
 * estado ocurre una vez por request, y la decisión de permisos ninguna.
 *
 * Toda respuesta autenticada sale con `no-store`. Sin eso, un intermediario
 * puede servirle a un usuario la respuesta cacheada de otro.
 */
export async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return fail(res, 401, "Token requerido");
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const db = usesPostgresAuth() ? null : readDb();
    const user = usesPostgresAuth()
      ? await findAuthUserByPublicId(payload.sub)
      : db.users.find((entry) => entry.id === payload.sub);
    if (!user) return fail(res, 401, "Usuario no existe");
    req.auth = {
      userId: user.id,
      roles: Array.isArray(user.roles) ? user.roles : [],
      user,
      mfaVerified: payload.mfa === true,
      mfa:
        usesPostgresAuth() && user.roles?.includes("admin")
          ? await getAdminMfaStatus(user.id)
          : { enabled: false },
    };
    res.set("Cache-Control", "no-store, private");
    res.set("Pragma", "no-cache");
    return next();
  } catch (_error) {
    // Un token expirado y uno con firma inválida devuelven el mismo mensaje: la
    // diferencia sólo le sirve a quien está probando firmas.
    return fail(res, 401, "Token invalido o expirado");
  }
}
