import { Banknote } from "lucide-react";

/**
 * El interruptor de efectivo, por sucursal (PAG-01).
 *
 * **Lo decide el comercio y no Flash**, como el retiro: aceptar efectivo es tener
 * cambio en el mostrador para los retiros y aceptar que el repartidor cobre en mano
 * en las entregas. Arranca apagado; encenderlo por omisión le sumaría a un local
 * cobros que no eligió.
 */
export function MerchantCashSwitch({
  cashEnabled,
  busy,
  onChange,
}: {
  cashEnabled: boolean;
  busy: boolean;
  onChange: (cashEnabled: boolean) => void;
}) {
  return (
    <label className="branch-pickup-switch">
      <input
        type="checkbox"
        checked={cashEnabled}
        disabled={busy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>
          <Banknote size={15} /> Acepta efectivo
        </strong>
        <small>
          {cashEnabled
            ? "El cliente puede pagar en efectivo: al repartidor cuando llega o en el mostrador si retira. Lo que cobrás en el mostrador se descuenta de tu saldo."
            : "Apagado. Los pedidos de esta sucursal se pagan con Wallet o tarjeta."}
        </small>
      </span>
    </label>
  );
}
