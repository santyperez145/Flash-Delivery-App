import { useEffect, useState, type ComponentType } from "react";
import {
  Check,
  CreditCard,
  MapPin,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  TicketPercent,
  TriangleAlert,
  WalletCards,
} from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import type {
  AppState,
  CartLine,
  FoodCheckoutQuote,
  FoodCheckoutSelection,
  Restaurant,
  UserAddress,
} from "../types";
import { TopBar } from "../ui/panels";
import { EmptyState } from "./EmptyState";
import { QuantityCounter } from "./QuantityCounter";
import { SchedulePicker } from "./SchedulePicker";
import { TipSelector } from "./TipSelector";

export function CartScreen({
  cart,
  onCartChange,
  totals,
  promotions,
  promotionCode,
  setPromotionCode,
  restaurant,
  checkoutOpen,
  setCheckoutOpen,
  onBack,
  onCreateOrder,
  addresses,
  paymentMethods,
  customerEmail,
  busy,
}: {
  cart: CartLine[];
  onCartChange: (cart: CartLine[]) => void;
  totals: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount: number;
    total: number;
  };
  promotions: AppState["promotions"];
  promotionCode: string;
  setPromotionCode: (code: string) => void;
  restaurant: Restaurant | null;
  checkoutOpen: boolean;
  setCheckoutOpen: (open: boolean) => void;
  onBack: () => void;
  onCreateOrder: (
    checkout: FoodCheckoutSelection,
    providerPayment?: { cardToken: string; paymentMethodId: string; installments: number },
  ) => Promise<void>;
  addresses: UserAddress[];
  paymentMethods: AppState["paymentMethods"];
  customerEmail: string;
  busy: boolean;
}) {
  const [paymentMode, setPaymentMode] = useState<"wallet" | "mercadopago">("wallet"),
    [paymentConfiguration, setPaymentConfiguration] = useState<{
      provider: "mercadopago" | "disabled";
      publicKey: string | null;
      merchantReady: boolean;
    } | null>(null),
    [paymentConfigurationError, setPaymentConfigurationError] = useState("");
  const geocodedAddresses = addresses.filter(
    (entry) => !entry.id.startsWith("profile-") && entry.lat !== null && entry.lng !== null,
  );
  const walletMethod =
    paymentMethods.find((entry) => entry.type === "wallet" && entry.isDefault) ||
    paymentMethods.find((entry) => entry.type === "wallet");
  const [selectedAddressId, setSelectedAddressId] = useState(
    () => geocodedAddresses.find((entry) => entry.isDefault)?.id || geocodedAddresses[0]?.id || "",
  );
  // Propina del checkout (GTM-001). En centavos, como viaja a la API.
  const [tipCents, setTipCents] = useState(0);
  // Reserva de horario (GTM-001). `null` es «lo antes posible», que es el camino
  // normal y por eso es el valor inicial.
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [checkoutQuote, setCheckoutQuote] = useState<FoodCheckoutQuote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState(""),
    [quoteRevision, setQuoteRevision] = useState(0),
    [quoteClock, setQuoteClock] = useState(Date.now());
  const selectedAddress = geocodedAddresses.find((entry) => entry.id === selectedAddressId) || null;
  useEffect(() => {
    if (!checkoutOpen || !restaurant) {
      setPaymentMode("wallet");
      setPaymentConfiguration(null);
      return;
    }
    let active = true;
    setPaymentConfigurationError("");
    api
      .getPaymentClientConfiguration(restaurant.id)
      .then((configuration) => {
        if (active) setPaymentConfiguration(configuration);
      })
      .catch((error) => {
        if (active)
          setPaymentConfigurationError(
            error instanceof Error ? error.message : "No se pudo consultar Mercado Pago",
          );
      });
    return () => {
      active = false;
    };
  }, [checkoutOpen, restaurant]);
  useEffect(() => {
    setSelectedAddressId((current) =>
      geocodedAddresses.some((entry) => entry.id === current)
        ? current
        : geocodedAddresses.find((entry) => entry.isDefault)?.id || geocodedAddresses[0]?.id || "",
    );
  }, [addresses]);
  useEffect(() => {
    if (!checkoutQuote) return;
    setQuoteClock(Date.now());
    const timer = window.setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [checkoutQuote]);
  const mercadoPagoReady =
    paymentConfiguration?.provider === "mercadopago" &&
    paymentConfiguration.merchantReady &&
    Boolean(paymentConfiguration.publicKey);
  useEffect(() => {
    if (!checkoutOpen) {
      setCheckoutQuote(null);
      setQuoteError("");
      setQuoteBusy(false);
      return;
    }
    if (!restaurant || !selectedAddress) {
      setCheckoutQuote(null);
      setQuoteError("Agregá una dirección con ubicación verificada desde Cuenta para continuar.");
      setQuoteBusy(false);
      return;
    }
    if (paymentMode === "wallet" && !walletMethod) {
      setCheckoutQuote(null);
      setQuoteError("Tu cuenta no tiene una Wallet habilitada.");
      setQuoteBusy(false);
      return;
    }
    let active = true;
    setCheckoutQuote(null);
    setQuoteError("");
    setQuoteBusy(true);
    const timer = window.setTimeout(() => {
      api
        .quoteFoodCheckout({
          customerId: selectedAddress.userId,
          restaurantId: restaurant.id,
          branchId: restaurant.branches?.find((branch) => branch.isPrimary)?.id,
          deliveryAddressId: selectedAddress.id,
          paymentMethod:
            paymentMode === "wallet" ? walletMethod?.label || "Flash Wallet" : "Mercado Pago",
          paymentMethodId: paymentMode === "wallet" ? walletMethod?.id : undefined,
          promotionCode: promotionCode.trim().toUpperCase() || undefined,
          items: cart.map((line) => ({
            menuItemId: line.item.id,
            quantity: line.quantity,
            extras: line.extras,
            note: line.note,
          })),
        })
        .then((result) => {
          if (active) {
            setCheckoutQuote(result.quote);
            setQuoteClock(Date.now());
          }
        })
        .catch((error) => {
          if (active)
            setQuoteError(
              error instanceof Error ? error.message : "No se pudo actualizar el precio final",
            );
        })
        .finally(() => {
          if (active) setQuoteBusy(false);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    cart,
    checkoutOpen,
    paymentMode,
    promotionCode,
    quoteRevision,
    restaurant,
    selectedAddress,
    walletMethod,
  ]);
  const quoteExpired = Boolean(
    checkoutQuote && new Date(checkoutQuote.expiresAt).getTime() <= quoteClock,
  );
  const checkoutSelection: FoodCheckoutSelection | null =
    checkoutQuote && selectedAddress
      ? {
          deliveryAddressId: selectedAddress.id,
          deliveryAddress: checkoutQuote.deliveryAddress,
          paymentMethod: checkoutQuote.paymentMethod,
          paymentMethodId: checkoutQuote.paymentMethodId || undefined,
          quoteToken: checkoutQuote.quoteToken,
          tipCents,
          scheduledFor,
        }
      : null;
  // Los mismos topes que aplica el servidor. Duplicarlos acá evita ofrecer un
  // monto que el confirmar va a rechazar; el que manda sigue siendo el servidor.
  const propinaMin = 10000;
  const propinaMax = checkoutQuote
    ? Math.min(10000000, Math.max(propinaMin, Math.floor(checkoutQuote.total * 100 * 0.5)))
    : 0;
  const displayedTotals =
    checkoutOpen && checkoutQuote
      ? { ...checkoutQuote, tip: tipCents / 100, total: checkoutQuote.total + tipCents / 100 }
      : totals;
  return (
    <div className="screen">
      <TopBar
        title={checkoutOpen ? "Checkout" : "Carrito"}
        onBack={onBack}
        actionIcon={TicketPercent}
      />
      {!cart.length ? (
        <EmptyState
          icon={ShoppingBag}
          title="Carrito vacio"
          text="Agrega un producto para generar un pedido real."
        />
      ) : (
        <>
          <div className="context-card">
            <Store size={17} />
            <div>
              <strong>{restaurant?.name}</strong>
              <span>
                {restaurant?.etaMin} min · envio {money.format(restaurant?.deliveryFee || 0)}
              </span>
            </div>
          </div>
          <div className="cart-items">
            {cart.map((line, index) => (
              <div className="cart-row" key={`${line.item.id}-${index}`}>
                <img src={line.item.image} alt={line.item.name} />
                <div>
                  <strong>{line.item.name}</strong>
                  <span>{line.extras.length ? `${line.extras.length} extras` : "Sin extras"}</span>
                  <small>{line.note || "Sin nota"}</small>
                </div>
                <QuantityCounter
                  value={line.quantity}
                  min={0}
                  onChange={(quantity) =>
                    onCartChange(
                      quantity <= 0
                        ? cart.filter((_, lineIndex) => lineIndex !== index)
                        : cart.map((entry, lineIndex) =>
                            lineIndex === index ? { ...entry, quantity } : entry,
                          ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          {checkoutOpen && (
            <section className="checkout-card">
              <div className="checkout-section-heading">
                <div>
                  <span className="muted-label">Entrega</span>
                  <strong>Elegí dónde recibir</strong>
                </div>
                <MapPin size={18} />
              </div>
              <div
                className="checkout-address-list"
                role="radiogroup"
                aria-label="Dirección de entrega"
              >
                {geocodedAddresses.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="radio"
                    aria-checked={entry.id === selectedAddressId}
                    className={
                      entry.id === selectedAddressId
                        ? "checkout-address active"
                        : "checkout-address"
                    }
                    onClick={() => setSelectedAddressId(entry.id)}
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
                      Necesitás una dirección guardada con coordenadas GPS. Cerrá el carrito y
                      agregala desde Cuenta.
                    </span>
                  </div>
                )}
              </div>
              <div className="checkout-section-heading">
                <div>
                  <span className="muted-label">Pago</span>
                  <strong>Elegí cómo pagar</strong>
                </div>
                <CreditCard size={18} />
              </div>
              <div className="payment-choice" role="radiogroup" aria-label="Método de pago">
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentMode === "wallet"}
                  className={paymentMode === "wallet" ? "active" : ""}
                  disabled={!walletMethod}
                  onClick={() => setPaymentMode("wallet")}
                >
                  <WalletCards size={18} />
                  <span>
                    <strong>{walletMethod?.label || "Flash Wallet"}</strong>
                    <small>
                      {walletMethod
                        ? `Saldo ${money.format(walletMethod.balance)}`
                        : "No disponible"}
                    </small>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentMode === "mercadopago"}
                  className={paymentMode === "mercadopago" ? "active" : ""}
                  disabled={!mercadoPagoReady}
                  onClick={() => setPaymentMode("mercadopago")}
                >
                  <CreditCard size={18} />
                  <span>
                    <strong>Tarjeta</strong>
                    <small>
                      {mercadoPagoReady
                        ? "Tokenización segura con Mercado Pago"
                        : paymentConfiguration
                          ? "No disponible para este comercio"
                          : "Consultando disponibilidad…"}
                    </small>
                  </span>
                </button>
              </div>
              {paymentConfigurationError && (
                <small className="payment-provider-error">{paymentConfigurationError}</small>
              )}
              {quoteBusy && (
                <div className="checkout-quote-status" role="status">
                  <RefreshCw size={16} />
                  Recalculando precio y disponibilidad…
                </div>
              )}
              {quoteError && (
                <div className="checkout-quote-error" role="alert">
                  <TriangleAlert size={16} />
                  <span>{quoteError}</span>
                  <button type="button" onClick={() => setQuoteRevision((value) => value + 1)}>
                    Reintentar
                  </button>
                </div>
              )}
              {checkoutQuote && !quoteBusy && (
                <div
                  className={quoteExpired ? "checkout-quote-proof expired" : "checkout-quote-proof"}
                >
                  <ShieldCheck size={17} />
                  <span>
                    <strong>
                      {quoteExpired ? "Cotización vencida" : "Precio verificado por Flash"}
                    </strong>
                    <small>
                      {checkoutQuote.distanceKm} km · llega en aproximadamente{" "}
                      {checkoutQuote.etaMin} min · {checkoutQuote.pricingVersion}
                    </small>
                  </span>
                  {quoteExpired ? (
                    <button type="button" onClick={() => setQuoteRevision((value) => value + 1)}>
                      Actualizar
                    </button>
                  ) : (
                    <small>
                      Vence{" "}
                      {new Date(checkoutQuote.expiresAt).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  )}
                </div>
              )}
              {paymentMode === "mercadopago" &&
                mercadoPagoReady &&
                paymentConfiguration?.publicKey &&
                checkoutQuote &&
                !quoteExpired &&
                checkoutSelection && (
                  <MercadoPagoCardCheckout
                    publicKey={paymentConfiguration.publicKey}
                    amount={checkoutQuote.total}
                    email={customerEmail}
                    busy={busy || quoteBusy}
                    onSubmit={(providerPayment) =>
                      onCreateOrder(checkoutSelection, providerPayment)
                    }
                    onError={setPaymentConfigurationError}
                  />
                )}
              <label className="checkout-line">
                <TicketPercent size={18} />
                <div>
                  <strong>Código promocional</strong>
                  <input
                    aria-label="Código promocional"
                    list="food-promotions"
                    placeholder="Ej. FLASH40"
                    value={promotionCode}
                    onChange={(event) => setPromotionCode(event.target.value.toUpperCase())}
                  />
                  <datalist id="food-promotions">
                    {promotions
                      .filter((entry) => entry.service === "food" && entry.active && entry.code)
                      .map((entry) => (
                        <option key={entry.id} value={entry.code}>
                          {entry.title}
                        </option>
                      ))}
                  </datalist>
                </div>
              </label>
            </section>
          )}
          {/* Antes del resumen, para que el total que se lee ya incluya lo que
              se acaba de elegir. Después del total sería pedir una decisión que
              cambia una cifra que la persona ya dio por buena. */}
          {/* El horario antes que la propina: primero cuándo llega, después
              cuánto se deja. Al revés obligaría a repensar la propina después de
              descubrir que el pedido es para mañana. */}
          {checkoutOpen && checkoutQuote && (
            <SchedulePicker
              scheduledFor={scheduledFor}
              onChange={setScheduledFor}
              disabled={busy || quoteBusy}
            />
          )}
          {checkoutOpen && checkoutQuote && (
            <TipSelector
              subtotal={checkoutQuote.subtotal}
              tipCents={tipCents}
              onChange={setTipCents}
              minCents={propinaMin}
              maxCents={propinaMax}
              disabled={busy || quoteBusy}
            />
          )}
          <SummaryBlock totals={displayedTotals} />
          {paymentMode === "wallet" && (
            <button
              className="primary-button sticky-action"
              type="button"
              onClick={() =>
                checkoutOpen && checkoutSelection
                  ? void onCreateOrder(checkoutSelection)
                  : setCheckoutOpen(true)
              }
              disabled={
                busy ||
                (checkoutOpen &&
                  (quoteBusy || !checkoutSelection || quoteExpired || Boolean(quoteError)))
              }
            >
              <ReceiptText size={17} />
              {checkoutOpen
                ? quoteBusy
                  ? "Verificando total…"
                  : quoteExpired
                    ? "Actualizá el precio"
                    : "Confirmar pedido"
                : "Ir a pagar"}
            </button>
          )}
          {paymentMode === "mercadopago" && !checkoutOpen && (
            <button
              className="primary-button sticky-action"
              type="button"
              onClick={() => setCheckoutOpen(true)}
            >
              <ReceiptText size={17} />
              Ir a pagar
            </button>
          )}
        </>
      )}
    </div>
  );
}

type ProviderPaymentInput = { cardToken: string; paymentMethodId: string; installments: number };
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

function MercadoPagoCardCheckout({
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

function SummaryBlock({
  totals,
}: {
  totals: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount?: number;
    subscriptionDiscount?: number;
    tip?: number;
    total: number;
  };
}) {
  return (
    <section className="summary-block">
      <div>
        <span>Subtotal</span>
        <strong>{money.format(totals.subtotal)}</strong>
      </div>
      <div>
        <span>Envio</span>
        <strong>{money.format(totals.deliveryFee)}</strong>
      </div>
      <div>
        <span>Servicio</span>
        <strong>{money.format(totals.serviceFee)}</strong>
      </div>
      {!!totals.discount && (
        <div>
          <span>Promoción</span>
          <strong>-{money.format(totals.discount)}</strong>
        </div>
      )}
      {/* Se nombra el beneficio en lugar de sumarlo al descuento. Quien paga una
          suscripción tiene que ver qué le devolvió en cada pedido: es lo único
          que sostiene la renovación, y esconderlo en «Promoción» lo borra. */}
      {!!totals.subscriptionDiscount && (
        <div className="summary-suscripcion">
          <span>Envío con Flash Más</span>
          <strong>-{money.format(totals.subscriptionDiscount)}</strong>
        </div>
      )}
      {/* Suma, no resta. Es la única línea del resumen que sube el total por
          decisión de la persona, y por eso se muestra por separado: verla dentro
          del total sin nombrarla es la forma más rápida de que se sienta un
          cargo que nadie eligió. */}
      {!!totals.tip && (
        <div>
          <span>Propina</span>
          <strong>{money.format(totals.tip)}</strong>
        </div>
      )}
      <div className="total-line">
        <span>Total</span>
        <strong>{money.format(totals.total)}</strong>
      </div>
    </section>
  );
}
