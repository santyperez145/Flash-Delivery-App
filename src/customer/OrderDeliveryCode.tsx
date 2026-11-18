import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

import { api } from "../api";
import type { Order } from "../types";

// Código de entrega (SEG-03), como el PIN de Uber Eats. Un pedido de valor alto, o
// de quien tuvo un reclamo aprobado, se entrega con un código: el cliente lo ve en
// el seguimiento y quien reparte lo ingresa antes de cerrarlo. Mismo comportamiento
// que la app móvil.

const pendiente = (order: Order) =>
  Boolean(order.deliveryCode?.required && !order.deliveryCode.verified);

export const faltaCodigoDeEntrega = (order: Order) =>
  pendiente(order) && order.status === "delivering";

/** Lo que ve el cliente: el código para dárselo a quien reparte. */
export function OrderDeliveryCodeView({ order }: { order: Order }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activo = pendiente(order) && !["delivered", "cancelled"].includes(order.status);
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    api
      .getOrderDeliveryCode(order.id)
      .then((respuesta) => vigente && setCodigo(respuesta.deliveryCode))
      .catch(
        (requestError) =>
          vigente &&
          setError(requestError instanceof Error ? requestError.message : "No se pudo leer"),
      );
    return () => {
      vigente = false;
    };
  }, [activo, order.id]);
  if (!activo) return null;
  return (
    <section className="delivery-code" aria-label="Código de entrega">
      <KeyRound size={22} aria-hidden="true" />
      <div>
        <strong>Código de entrega</strong>
        <p>Dáselo a quien te entregue el pedido. No lo compartas antes de recibirlo.</p>
        {codigo && <span className="delivery-code-digits">{codigo}</span>}
        {error && <small role="status">{error}</small>}
      </div>
    </section>
  );
}

/** Lo que ve quien reparte: ingresa el código y recién ahí cierra el pedido. */
export function OrderDeliveryCodeEntry({
  order,
  busy,
  runAction,
}: {
  order: Order;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [pin, setPin] = useState("");
  if (!faltaCodigoDeEntrega(order)) return null;
  return (
    <form
      className="delivery-code"
      onSubmit={(event) => {
        event.preventDefault();
        runAction(async () => {
          await api.verifyOrderDeliveryCode(order.id, pin);
          await api.advanceOrder(order.id);
          setPin("");
        }, "Código verificado; pedido entregado");
      }}
    >
      <KeyRound size={22} aria-hidden="true" />
      <div>
        <strong>Pedí el código de entrega</strong>
        <p>Este pedido se entrega con el código que tiene el cliente.</p>
        <div className="delivery-code-entry">
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={4}
            placeholder="••••"
            aria-label="Código de entrega"
          />
          <button type="submit" disabled={busy || pin.length !== 4}>
            Verificar y entregar
          </button>
        </div>
      </div>
    </form>
  );
}
