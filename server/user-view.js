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
