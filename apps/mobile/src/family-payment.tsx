import { useCallback, useEffect, useRef, useState } from "react";

import { getFamilyProfile } from "./family-profile-api";
import { money } from "./format";
import type { FamilyPaymentLabel, FamilyProfile } from "./types";

// «Perfil familiar» como medio de pago (PAG-05): lo comparten el checkout de comida,
// el pedido de viaje y el de envío. La opción existe sólo para quien es miembro
// activo de un perfil; si la lectura falla no se ofrece: sin saber quién paga ni
// cuánto queda no se puede elegir a sabiendas. Mismo comportamiento que la web.

/** La etiqueta exacta que espera la API como `paymentMethod`. */
export const FAMILY_PAYMENT: FamilyPaymentLabel = "Perfil familiar";

/**
 * El id con que la lista de medios de la comida marca «Perfil familiar». No es un
 * medio guardado: al pedir se manda la etiqueta sin `paymentMethodId`, que el
 * servidor rechaza junto a ella.
 */
export const FAMILY_PAYMENT_ID = "perfil-familiar";

export type FamilyMembership = NonNullable<FamilyProfile["membership"]>;

/** Quién paga y cuánto queda. Nunca el saldo de quien organiza: la API no lo manda. */
export const familyPaymentNote = (membership: FamilyMembership) =>
  membership.remaining === null
    ? `Paga ${membership.organizerName} · sin tope`
    : `Paga ${membership.organizerName} · te quedan ${money.format(membership.remaining)} este mes`;

/**
 * La membresía activa, o `null` si no hay (o no se pudo leer). `reload` la vuelve a
 * pedir: lo que queda del mes cambia con cada compra y quien organiza puede sacar a
 * la persona en cualquier momento.
 */
export function useFamilyPayment() {
  const [membership, setMembership] = useState<FamilyMembership | null>(null);
  // Una respuesta que llega después de cerrar la pantalla no actualiza nada.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const reload = useCallback(
    () =>
      getFamilyProfile()
        // Con el tope del mes agotado no se ofrece: el cobro respondería 402.
        .then(({ family }) =>
          family.membership && family.membership.remaining !== 0 ? family.membership : null,
        )
        .catch(() => null)
        .then((actual) => {
          if (montado.current) setMembership(actual);
        }),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { membership, reload };
}
