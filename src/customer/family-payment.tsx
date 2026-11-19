import { useEffect, useState } from "react";

import { getFamilyProfile } from "../family-profile-api";
import { money } from "../format";
import type { FamilyPaymentLabel, FamilyProfile } from "../types";

// Perfil familiar (PAG-05) como medio de pago. Lo comparten el checkout de comida,
// el pedido de viaje y el de envío: los tres ofrecen la opción con la misma regla y
// el mismo texto, y mandan exactamente la misma etiqueta que valida el servidor.

/** La etiqueta que viaja a la API. Cualquier otra variante el servidor la rechaza. */
export const FAMILY_PAYMENT: FamilyPaymentLabel = "Perfil familiar";

export type FamilyMembership = NonNullable<FamilyProfile["membership"]>;

/**
 * La membresía activa de la persona, o `null`. Sólo con una membresía se ofrece la
 * opción: si la lectura falla, tampoco, porque ofrecer un medio que el servidor
 * rechaza deja a la persona trabada en el último paso. `activo` permite leerla
 * recién al abrir el checkout, así lo que queda del mes está al día.
 */
export function useFamilyPayment(activo = true): FamilyMembership | null {
  const [membresia, setMembresia] = useState<FamilyMembership | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    getFamilyProfile()
      .then(({ family }) => {
        // Con el tope del mes agotado no se ofrece: el cobro respondería 402.
        if (vigente)
          setMembresia(
            family.membership && family.membership.remaining !== 0 ? family.membership : null,
          );
      })
      .catch(() => {
        if (vigente) setMembresia(null);
      });
    return () => {
      vigente = false;
    };
  }, [activo]);
  return membresia;
}

/** Quién paga y cuánto queda. Nunca el saldo de quien organiza: no es de la persona. */
export const familyPaymentDetail = (membresia: FamilyMembership) =>
  membresia.remaining === null
    ? `Paga ${membresia.organizerName} · sin tope`
    : `Paga ${membresia.organizerName} · te quedan ${money.format(membresia.remaining)} este mes`;
