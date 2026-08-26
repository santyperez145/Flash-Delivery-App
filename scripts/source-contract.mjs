// Contratos sobre código fuente, independientes del formato (ticket ARC-001).
//
// Varias suites afirman que cierta lógica existe en el código leyendo el archivo
// y buscando substrings literales. La intención es buena: impide que una
// pantalla vuelva a inicializarse con datos ficticios, o que un checkout
// confirme una cotización distinta de la que mostró.
//
// El problema es cómo estaba implementado. `app.includes("entry.lat!==null")`
// falla en cuanto un formateador escribe `entry.lat !== null`, así que el
// contrato quedaba acoplado al espaciado del archivo. Eso convierte a estas
// suites en un obstáculo para cualquier refactor —incluido el reformateo que
// ARC-001 necesita como primer paso— en lugar de una protección.
//
// `contains` compara ignorando todo el espaciado, de los dos lados. El contrato
// sigue afirmando lo mismo; deja de afirmar cómo está escrito.

/** Quita todo el espaciado para comparar sólo la forma del código. */
export const squeeze = (source) => String(source).replace(/\s+/g, "");

/** ¿La fuente contiene este fragmento, sin importar el espaciado? */
export const contains = (source, needle) => squeeze(source).includes(squeeze(needle));

/** ¿Contiene todos estos fragmentos? */
export const containsAll = (source, needles) => needles.every((needle) => contains(source, needle));

/** ¿No contiene ninguno? Útil para prohibir datos ficticios o rutas semilla. */
export const containsNone = (source, needles) => needles.every((needle) => !contains(source, needle));

/**
 * Recorta la sección entre dos marcadores, tolerando el espaciado.
 *
 * Devuelve el fragmento ya comprimido: sólo sirve para usarlo con `contains`,
 * nunca para mostrarlo ni para contar líneas.
 */
export function section(source, from, to) {
  const squeezed = squeeze(source);
  const start = squeezed.indexOf(squeeze(from));
  if (start === -1) return "";
  const end = to ? squeezed.indexOf(squeeze(to), start) : -1;
  return end === -1 ? squeezed.slice(start) : squeezed.slice(start, end);
}
