import { Store } from "lucide-react";

/**
 * El interruptor de retiro en el local, por sucursal (GTM-002).
 *
 * **Lo decide el comercio y no Flash.** Entregar en mano a alguien que entra al
 * local exige mostrador, alguien que atienda y lugar para esperar: la columna
 * `pickup_enabled` arranca apagada, y encenderla por omisión mandaría clientes
 * a locales que no pueden recibirlos.
 *
 * Es un componente propio y no un bloque de la consola porque la consola ya es
 * un archivo monolítico: sumarle superficie es la deuda que ARC-001 está
 * pagando. Acá además queda dicho, en un solo lugar, qué cambia al encenderlo.
 */
export function MerchantPickupSwitch({
  pickupEnabled,
  busy,
  onChange,
}: {
  pickupEnabled: boolean;
  busy: boolean;
  onChange: (pickupEnabled: boolean) => void;
}) {
  return (
    <label className="branch-pickup-switch">
      <input
        type="checkbox"
        checked={pickupEnabled}
        disabled={busy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>
          <Store size={15} /> Retiro en el local
        </strong>
        <small>
          {pickupEnabled
            ? "El cliente puede pedir y venir a buscarlo. Sin envío ni propina de reparto: lo entregás vos en el mostrador contra el número de pedido."
            : "Apagado. Los pedidos de esta sucursal sólo salen con repartidor."}
        </small>
      </span>
    </label>
  );
}
