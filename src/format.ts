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

/**
 * Una duración en minutos, dicha como la diría una persona.
 *
 * Escala de minutos a horas a días y omite el resto cuando es cero: «2 h» y no
 * «2 h 0 min». Un valor negativo se trata como cero, porque un ETA en el pasado
 * es un dato viejo, no un tiempo negativo.
 */
export function compactMinutes(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60),
    remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24),
    remainingHours = hours % 24;
  return remainingHours ? `${days} d ${remainingHours} h` : `${days} d`;
}
