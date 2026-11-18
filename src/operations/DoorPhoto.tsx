import { Camera, ShieldCheck } from "lucide-react";

import { request } from "../api";
import type { Order } from "../types";

// Foto de un pedido dejado en la puerta, desde la web del repartidor (P-02b).
//
// El servidor no deja cerrar sin ella, así que la web tiene que poder sacarla: en
// el celular, el selector de archivos abre la cámara (`capture="environment"`).

/** El pedido va a la puerta, está en camino y todavía no tiene foto. */
export const faltaFotoEnPuerta = (order: Order) =>
  order.status === "delivering" &&
  order.fulfillment !== "pickup" &&
  order.deliveryPreferences?.dropoff === "leave_at_door" &&
  !order.deliveryPhoto;

// Una foto de cámara pesa varios MB y el servidor acepta JSON de hasta 1 MB: se
// achica en el navegador (lado mayor de 1280 px, JPEG) bajando la calidad hasta que
// entre con margen. Es lo mismo que hace la app nativa con `quality: 0.55`.
const LIMITE_BASE64 = 700_000;
const achicar = async (archivo: File) => {
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
};

const subir = async (orderId: string, archivo: File) => {
  const contentBase64 = await achicar(archivo);
  await request(`/orders/${orderId}/delivery-photo`, {
    method: "POST",
    body: JSON.stringify({
      mimeType: "image/jpeg",
      contentBase64,
      capturedAt: new Date().toISOString(),
    }),
  });
};

export function DoorPhoto({
  order,
  busy,
  runAction,
}: {
  order: Order;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  if (order.deliveryPhoto)
    return (
      <p className="door-photo door-photo-ready">
        <ShieldCheck size={16} /> Foto de la puerta guardada. Ya podés marcarlo entregado.
      </p>
    );
  if (!faltaFotoEnPuerta(order)) return null;
  return (
    <label className="door-photo">
      <Camera size={16} /> El cliente pidió que lo dejes en la puerta: sacá una foto.
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        disabled={busy}
        onChange={(event) => {
          const archivo = event.target.files?.[0];
          if (archivo) runAction(() => subir(order.id, archivo), "Foto guardada");
        }}
      />
    </label>
  );
}
