import { useEffect, useState, type ComponentType } from "react";
import { RefreshCw } from "lucide-react";

// El formulario de tarjeta de Mercado Pago, aparte del checkout (GTM-002/ARC-001).
//
// **Es el unico lugar del cliente que carga un SDK externo.** Vive en su propio
// archivo por eso: el `import()` dinamico, la inicializacion con la clave
// publica y la comparacion del monto que devuelve el brick son una
// responsabilidad completa, y mezclarla con el carrito hacia que cualquier
// cambio del checkout tuviera que leer tambien la integracion del proveedor.
//
// La tarjeta nunca toca Flash: el brick tokeniza contra Mercado Pago y lo que
// vuelve es un token de un solo uso. Esa es la razon de que el formulario sea
// del proveedor y no nuestro.

export type ProviderPaymentInput = {
  cardToken: string;
  paymentMethodId: string;
  installments: number;
};
type CardBrickForm = {
  token: string;
  payment_method_id: string;
  installments: number;
  transaction_amount: number;
};
type CardBrickProps = {
  initialization: { amount: number; payer: { email: string } };
  customization: {
    paymentMethods: {
      maxInstallments: number;
      types: { included: Array<"credit_card" | "debit_card" | "prepaid_card"> };
    };
    visual: { style: { theme: string } };
  };
  locale: "es-AR";
  onSubmit: (form: CardBrickForm) => Promise<void>;
  onReady: () => void;
  onError: (error: unknown) => void;
};

export function MercadoPagoCardCheckout({
  publicKey,
  amount,
  email,
  busy,
  onSubmit,
  onError,
}: {
  publicKey: string;
  amount: number;
  email: string;
  busy: boolean;
  onSubmit: (payment: ProviderPaymentInput) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [CardBrick, setCardBrick] = useState<ComponentType<CardBrickProps> | null>(null);
  useEffect(() => {
    let active = true;
    import("@mercadopago/sdk-react")
      .then((sdk) => {
        if (!active) return;
        sdk.initMercadoPago(publicKey, { locale: "es-AR" });
        setCardBrick(() => sdk.CardPayment as unknown as ComponentType<CardBrickProps>);
      })
      .catch(() => {
        if (active) onError("No se pudo cargar el formulario seguro de Mercado Pago");
      });
    return () => {
      active = false;
    };
  }, [onError, publicKey]);
  if (!CardBrick)
    return (
      <div className="payment-brick-loading">
        <RefreshCw size={16} />
        Cargando formulario seguro…
      </div>
    );
  return (
    <div className={busy ? "payment-brick busy" : "payment-brick"}>
      <CardBrick
        initialization={{ amount, payer: { email } }}
        customization={{
          paymentMethods: {
            maxInstallments: 12,
            types: { included: ["credit_card", "debit_card", "prepaid_card"] },
          },
          visual: { style: { theme: "default" } },
        }}
        locale="es-AR"
        onReady={() => onError("")}
        onError={() => onError("Mercado Pago no pudo preparar el formulario")}
        onSubmit={async (form) => {
          if (busy) throw new Error("El pago ya se está procesando");
          if (Math.abs(Number(form.transaction_amount) - amount) > 0.01)
            throw new Error("El total del formulario cambió; revisá el pedido");
          await onSubmit({
            cardToken: form.token,
            paymentMethodId: form.payment_method_id,
            installments: Number(form.installments) || 1,
          });
        }}
      />
    </div>
  );
}
