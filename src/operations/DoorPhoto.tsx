import { Camera, ShieldCheck } from "lucide-react";

import { request } from "../api";
import { achicarFoto } from "../media/achicarFoto";
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

const subir = async (orderId: string, archivo: File) => {
  const contentBase64 = await achicarFoto(archivo);
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
