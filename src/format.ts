// Formateo compartido de la superficie web (ticket ARC-001, paso 9).
//
// Dos funciones que usa todo el frente: `money` en 47 lugares, `initials` en 6.
// Vivían en `src/App.tsx`, y ese es el motivo por el que hubo que sacarlas
// primero: al mover la consola de backoffice a su propio módulo, éste las
// necesitaba, y exportarlas desde `App.tsx` habría creado un import circular
// —`App` importa la consola, la consola importa `App`—.
//
// Es el mismo patrón que en el servidor: **el núcleo compartido sale antes que
// las superficies que lo consumen**, no después.

/**
 * Pesos argentinos sin decimales.
 *
 * Sin decimales a propósito: los importes se guardan y se calculan en centavos
 * en el backend, y mostrar centavos en pesos sólo agrega ruido a cifras que en
 * la práctica se redondean.
 */
export const money = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

/**
 * Iniciales para un avatar, de a lo sumo dos letras.
 *
 * Un nombre de una sola palabra devuelve una letra, y eso está bien: es
 * preferible a rellenar con algo que el usuario no escribió.
 */
export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
