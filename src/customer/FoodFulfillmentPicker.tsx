import { Bike, Check, MapPin, ShoppingBag, Store, TriangleAlert } from "lucide-react";

import { money } from "../format";
import type { UserAddress } from "../types";

/**
 * Como recibe el cliente su pedido de comida: envio a domicilio o retiro en el
 * local (GTM-002).
 *
 * **Es un componente y no un bloque del checkout** porque decide tres cosas que
 * el resto de la pantalla da por supuestas: si la direccion hace falta, si hay
 * envio en el total y si se puede dejar propina. Tenerlo aparte deja esas tres
 * en un solo lugar — y mantiene el checkout dentro del limite de tamanio que
 * `test:web-checkout` vigila.
 *
 * El selector solo aparece cuando la sucursal habilito el retiro. Ofrecer un
 * modo que el servidor rechaza es peor que no ofrecerlo.
 */
export function FoodFulfillmentPicker({
  fulfillment,
  onChange,
  onTipReset,
  pickupAvailable,
  deliveryFee,
  branchName,
  branchAddress,
  quotedPickupAddress,
  addresses,
  selectedAddressId,
  onSelectAddress,
}: {
  fulfillment: "delivery" | "pickup";
  onChange: (fulfillment: "delivery" | "pickup") => void;
  /** Se llama al pasar a retiro: la propina de un reparto no sobrevive al
   *  cambio de modo, y el servidor rechaza el pedido que la lleve. */
  onTipReset: () => void;
  pickupAvailable: boolean;
  deliveryFee: number;
  branchName: string;
  branchAddress: string;
  /** La direccion del local tal como la firmo la cotizacion. Mientras no haya
   *  cotizacion se muestra la de la sucursal, que es la misma. */
  quotedPickupAddress: string | null;
  addresses: UserAddress[];
  selectedAddressId: string;
  onSelectAddress: (addressId: string) => void;
}) {
  const esRetiro = fulfillment === "pickup";
  const geocodedAddresses = addresses;
  return (
    <>
      {/* El modo primero: decide si la dirección hace falta, si hay
              envío en el total y si se puede dejar propina. Preguntarlo
              después obligaría a rehacer las tres decisiones. */}
      {pickupAvailable && (
        <>
          <div className="checkout-section-heading">
            <div>
              <span className="muted-label">Modo</span>
              <strong>¿Te lo llevamos o lo retirás?</strong>
            </div>
            <ShoppingBag size={18} />
          </div>
          <div className="payment-choice" role="radiogroup" aria-label="Modo de entrega">
            <button
              type="button"
              role="radio"
              aria-checked={!esRetiro}
              className={!esRetiro ? "active" : ""}
              onClick={() => onChange("delivery")}
            >
              <Bike size={18} />
              <span>
                <strong>Envío a domicilio</strong>
                <small>Envío {money.format(deliveryFee)}</small>
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={esRetiro}
              className={esRetiro ? "active" : ""}
              onClick={() => {
                onChange("pickup");
                // La propina elegida para un reparto no sobrevive al
                // cambio de modo: en retiro no hay repartidor y el
                // servidor rechaza el pedido que la lleve.
                onTipReset();
              }}
            >
              <Store size={18} />
              <span>
                <strong>Retirar en el local</strong>
                <small>Sin envío ni servicio</small>
              </span>
            </button>
          </div>
        </>
      )}
      <div className="checkout-section-heading">
        <div>
          <span className="muted-label">{esRetiro ? "Retiro" : "Entrega"}</span>
          <strong>{esRetiro ? "Retirás en el local" : "Elegí dónde recibir"}</strong>
        </div>
        {esRetiro ? <Store size={18} /> : <MapPin size={18} />}
      </div>
      {esRetiro ? (
        <div className="checkout-address-list">
          <div className="checkout-address active">
            <span className="saved-address-icon">
              <Store size={16} />
            </span>
            <span>
              <strong>{branchName}</strong>
              <small>{quotedPickupAddress || branchAddress}</small>
            </span>
            <Check size={17} />
          </div>
          {/* Lo que reemplaza al código de retiro que esta migración
                  decidió no crear: el número de pedido, dicho donde el
                  cliente lo va a necesitar. */}
          <small className="checkout-pickup-note">
            Mostrá el número de pedido en el mostrador. El pedido no sale del local: no hay
            repartidor asignado.
          </small>
        </div>
      ) : (
        <div className="checkout-address-list" role="radiogroup" aria-label="Dirección de entrega">
          {geocodedAddresses.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={entry.id === selectedAddressId}
              className={
                entry.id === selectedAddressId ? "checkout-address active" : "checkout-address"
              }
              onClick={() => onSelectAddress(entry.id)}
            >
              <span className="saved-address-icon">
                <MapPin size={16} />
              </span>
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.address}</small>
              </span>
              {entry.id === selectedAddressId ? <Check size={17} /> : null}
            </button>
          ))}
          {!geocodedAddresses.length && (
            <div className="checkout-missing-state">
              <TriangleAlert size={17} />
              <span>
                {pickupAvailable
                  ? "Necesitás una dirección guardada con coordenadas GPS, o elegí retirar en el local."
                  : "Necesitás una dirección guardada con coordenadas GPS. Cerrá el carrito y agregala desde Cuenta."}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
