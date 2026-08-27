// La proyección segura de un usuario (ticket ARC-001, paso 2).
//
// Vivía suelta en `server/index.js` y la usan cinco lugares: la cuenta propia,
// el registro, el login, el dashboard administrativo y el listado operativo de
// usuarios. El primero de esos cinco que se extrajera a un router la habría
// duplicado, y una redacción duplicada es una redacción que en algún momento
// deja de coincidir.
//
// Quita tres campos y ninguno es cosmético: `password` es el hash, `internalId`
// es la clave primaria de la base —que expuesta permite enumerar filas— y
// `loginLockedUntil` le diría a un atacante si acertó el usuario.
//
// Es una lista de exclusión y no de inclusión, con lo que eso implica: **una
// columna nueva en `users` sale por omisión**. La alternativa —enumerar lo que
// sí se expone— rompería cada vez que alguien agrega un campo, que es
// justamente lo que la volvería incómoda de mantener y fácil de vaciar.
export function sanitizeUser(user) {
  if (!user) return null;
  const { password, internalId, loginLockedUntil, ...safeUser } = user;
  return safeUser;
}

/**
 * La misma proyección para el respaldo SQLite.
 *
 * Saca sólo `password` y es correcto: en ese runtime los usuarios no tienen
 * `internalId` ni `loginLockedUntil`, porque son columnas de PostgreSQL. Por eso
 * `test:user-view` busca la redacción de los tres campos y no cualquier
 * `{ password, ... }`: tratarlas como copias obligaría a unificarlas, y el
 * resultado leería campos que en SQLite no existen.
 *
 * Viven juntas para que la diferencia sea visible. Separadas, la siguiente
 * persona que toque una no tiene forma de saber que la otra existe.
 */
export function publicUser(db, userId) {
  const user = db.users.find((entry) => entry.id === userId);
  if (!user) return null;
  const { password: _password, ...safeUser } = user;
  return safeUser;
}
