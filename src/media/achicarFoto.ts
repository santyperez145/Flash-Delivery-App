// Una foto de cámara pesa varios MB y el servidor acepta JSON de hasta 1 MB: se achica en
// el navegador (lado mayor de 1280 px, JPEG) bajando la calidad hasta que entre con
// margen. Es lo mismo que hace la app nativa con `quality: 0.55`. La usan la foto de la
// puerta (P-02b) y los documentos del legajo (FE-06).
const LIMITE_BASE64 = 700_000;

export async function achicarFoto(archivo: File) {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, 1280 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext("2d")?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  for (const calidad of [0.7, 0.55, 0.4, 0.3]) {
    const base64 = lienzo.toDataURL("image/jpeg", calidad).split(",")[1] || "";
    if (base64.length <= LIMITE_BASE64) return base64;
  }
  throw new Error("La foto es demasiado grande. Probá de nuevo con menos luz o más cerca.");
}
