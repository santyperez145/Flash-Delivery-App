import { DoorOpen, MessageSquareText, Utensils, UtensilsCrossed } from "lucide-react";

import type { DeliveryPreferencesView } from "../types";

// Preferencias de entrega como etiquetas, según quién mira (P-02).
//
// - `cocina`: el comercio arma el pedido; le sirve saber si lleva cubiertos. Es
//   lo único que el servidor le manda.
// - `reparto`: quien entrega; ve si es sin contacto y las indicaciones de la
//   casa. Sólo las recibe el repartidor asignado.

export function DeliveryPreferenceTags({
  preferences,
  audience,
}: {
  preferences?: DeliveryPreferencesView;
  audience: "cocina" | "reparto";
}) {
  if (!preferences) return null;
  if (audience === "cocina")
    return (
      <p className={preferences.cutlery ? "delivery-tag" : "delivery-tag muted"}>
        {preferences.cutlery ? <Utensils size={14} /> : <UtensilsCrossed size={14} />}
        {preferences.cutlery ? "Incluir cubiertos" : "Sin cubiertos"}
      </p>
    );
  const sinContacto = preferences.dropoff === "leave_at_door";
  const indicaciones = preferences.instructions?.trim();
  if (!sinContacto && !indicaciones && !preferences.hasInstructions) return null;
  return (
    <div className="delivery-tags">
      {sinContacto && (
        <p className="delivery-tag strong">
          <DoorOpen size={14} /> Dejar en la puerta
        </p>
      )}
      {indicaciones ? (
        <p className="delivery-tag">
          <MessageSquareText size={14} /> {indicaciones}
        </p>
      ) : preferences.hasInstructions ? (
        <p className="delivery-tag muted">
          <MessageSquareText size={14} /> Con indicaciones al aceptar
        </p>
      ) : null}
    </div>
  );
}
