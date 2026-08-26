// Espera de arranque compartida (ticket ARC-001, paso 9).
//
// Diez suites levantan la API y esperan a que responda. Cada una escribía su
// propio bucle, y **todas contaban intentos en lugar de tiempo**: entre 10 y 12
// segundos de presupuesto contra un arranque en frío medido en 22 sobre Windows
// con la caché de módulos fría.
//
// El efecto no es una suite que falla: es una que **pasa en el runner de CI, que
// está caliente, y falla en la máquina de quien la corre**. Eso entrena a
// ignorar el rojo, que es peor que no tener la prueba. En una sola sesión de
// trabajo costó cuatro verificaciones perdidas, una de ellas reportada como
// regresión inexistente.
//
// Varias además dormían **dentro del `catch`**: una respuesta distinta de 200
// que no lanzara quemaba los intentos de corrido, sin esperar nada.
//
// Un solo lugar, un solo presupuesto, y un error que dice qué respondió último.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 90 s cubre un arranque en frío con margen; un cuelgue real igual se corta. */
export const STARTUP_BUDGET_MS = 90000;

/**
 * Espera a que un endpoint de salud responda 200.
 *
 * Lanza al agotar el presupuesto, nombrando la última respuesta observada: un
 * `ECONNREFUSED` y un `HTTP 503` significan cosas distintas, y sin eso los dos
 * se ven igual desde el mensaje de error.
 */
export async function waitForHealthy(url, { budgetMs = STARTUP_BUDGET_MS, headers } = {}) {
  const deadline = Date.now() + budgetMs;
  let lastStatus = "sin respuesta";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, headers ? { headers } : undefined);
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error.cause?.code || error.message;
    }
    await sleep(250);
  }
  throw new Error(`${url} no respondió en ${budgetMs / 1000}s (última respuesta: ${lastStatus})`);
}
