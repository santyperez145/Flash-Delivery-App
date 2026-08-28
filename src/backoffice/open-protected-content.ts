// Abrir un archivo protegido que llega en base64 (ARC-001).
//
// La evidencia de un siniestro y el documento de un conductor viajan igual: el
// servidor los devuelve en base64 en lugar de servir una URL, porque una URL
// firmada que se pueda compartir deja de estar protegida en cuanto alguien la
// pega en un chat.
//
// El panel de siniestros ya tenía esta conversión escrita a mano. Al cablear la
// apertura de documentos de conductor hacía falta la misma, así que se extrae en
// vez de copiarla: dos copias de una conversión de bytes divergen en silencio, y
// la que se olvida de revocar el object URL filtra memoria por cada apertura.
const MILISEGUNDOS_ANTES_DE_REVOCAR = 60_000;

/**
 * Convierte el contenido a un blob y lo abre en una pestaña nueva.
 *
 * El object URL se revoca al minuto. Sin eso, cada archivo abierto queda
 * retenido en memoria hasta que se recarga la página, y un operador que revisa
 * cincuenta legajos en un turno los acumula todos.
 */
export function abrirContenidoProtegido(contentBase64: string, mimeType: string) {
  const binario = atob(contentBase64);
  const bytes = Uint8Array.from(binario, (caracter) => caracter.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.target = "_blank";
  // `noopener` es obligatorio con `target="_blank"`: sin él la pestaña abierta
  // recibe una referencia a la que la abrió y puede navegarla.
  enlace.rel = "noopener";
  enlace.click();
  window.setTimeout(() => URL.revokeObjectURL(url), MILISEGUNDOS_ANTES_DE_REVOCAR);
}
