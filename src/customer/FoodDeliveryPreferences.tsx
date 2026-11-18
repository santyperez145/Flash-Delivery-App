import { DoorOpen, Hand, MessageSquareText, Utensils } from "lucide-react";

import type { DeliveryPreferences, MerchantVertical } from "../types";

// Preferencias de entrega en el checkout (P-02).
//
// Uber Eats y PedidosYa dejan elegir en el checkout cómo llega el pedido. Las tres
// decisiones van juntas y después de la dirección, porque dependen de ella:
// «dejar en la puerta» y las indicaciones sólo existen si hay a dónde llevar.

export const PREFERENCIAS_INICIALES: DeliveryPreferences = {
  dropoff: "hand_to_me",
  instructions: "",
  cutlery: false,
};
const MAX_INDICACIONES = 300;
// Las mismas que rechaza el servidor (`delivery-preferences.js`): un producto de
// valor o de cuidado personal no se deja sin que alguien lo reciba.
const RUBROS_SIN_PUERTA: MerchantVertical[] = ["pharmacy", "retail"];

export function FoodDeliveryPreferences({
  value,
  onChange,
  pickup,
  vertical,
  disabled,
}: {
  value: DeliveryPreferences;
  onChange: (value: DeliveryPreferences) => void;
  /** En retiro no hay reparto: sólo queda la elección de cubiertos. */
  pickup: boolean;
  vertical: MerchantVertical;
  disabled: boolean;
}) {
  const sinPuerta = RUBROS_SIN_PUERTA.includes(vertical);
  const cambiar = (parcial: Partial<DeliveryPreferences>) => onChange({ ...value, ...parcial });
  return (
    <section className="delivery-preferences" aria-label="Preferencias de entrega">
      {!pickup && (
        <>
          <div className="payment-choice" role="radiogroup" aria-label="Cómo te lo entregamos">
            <button
              type="button"
              role="radio"
              aria-checked={value.dropoff === "hand_to_me"}
              className={value.dropoff === "hand_to_me" ? "active" : ""}
              disabled={disabled}
              onClick={() => cambiar({ dropoff: "hand_to_me" })}
            >
              <Hand size={18} />
              <span>
                <strong>En mano</strong>
                <small>Te lo entregan en la puerta</small>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value.dropoff === "leave_at_door"}
              className={value.dropoff === "leave_at_door" ? "active" : ""}
              disabled={disabled || sinPuerta}
              onClick={() => cambiar({ dropoff: "leave_at_door" })}
            >
              <DoorOpen size={18} />
              <span>
                <strong>Dejar en la puerta</strong>
                <small>{sinPuerta ? "No disponible en este comercio" : "Sin contacto"}</small>
              </span>
            </button>
          </div>
          <label className="delivery-instructions">
            <span>
              <MessageSquareText size={16} /> Indicaciones para quien reparte
            </span>
            <textarea
              value={value.instructions}
              maxLength={MAX_INDICACIONES}
              rows={2}
              disabled={disabled}
              placeholder="Piso, timbre, cómo encontrar la entrada"
              onChange={(event) => cambiar({ instructions: event.target.value })}
            />
            {/* Sólo las ven quien reparte, vos y soporte: el comercio no. Decirlo
                acá es lo que hace que alguien escriba el timbre sin dudar. */}
            <small>
              Las ve sólo quien reparte · {value.instructions.length}/{MAX_INDICACIONES}
            </small>
          </label>
        </>
      )}
      <label className="delivery-cutlery">
        <input
          type="checkbox"
          checked={value.cutlery}
          disabled={disabled}
          onChange={(event) => cambiar({ cutlery: event.target.checked })}
        />
        <Utensils size={16} />
        <span>Incluir cubiertos y servilletas</span>
      </label>
    </section>
  );
}
