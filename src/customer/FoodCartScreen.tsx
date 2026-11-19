import { useEffect, useState, type ComponentType } from "react";
import {
  Banknote,
  Bike,
  Check,
  CreditCard,
  MapPin,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  TicketPercent,
  TriangleAlert,
  WalletCards,
} from "lucide-react";

import { api } from "../api";
import { CASH_PAYMENT } from "../cash-payment";
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
import { DishPhoto } from "./FoodCatalogComponents";
import { FAMILY_PAYMENT, familyPaymentDetail, useFamilyPayment } from "./family-payment";
import { MercadoPagoCardCheckout } from "./FoodCardPayment";
import { FoodDeliveryPreferences, PREFERENCIAS_INICIALES } from "./FoodDeliveryPreferences";
import { FoodFulfillmentPicker } from "./FoodFulfillmentPicker";
import { QuantityCounter } from "./QuantityCounter";
import { SchedulePicker } from "./SchedulePicker";
import { SummaryBlock } from "./FoodCheckoutSummary";
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
  customerId,
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
  customerId: string;
  customerEmail: string;
  busy: boolean;
}) {
  // PAG-05: «family» paga con la Wallet de quien organiza el perfil familiar.
  // PAG-01: «cash» paga en efectivo al recibir o al retirar.
  const [paymentMode, setPaymentMode] = useState<"wallet" | "mercadopago" | "family" | "cash">(
      "wallet",
    ),
    [paymentConfiguration, setPaymentConfiguration] = useState<{
      provider: "mercadopago" | "disabled";
      publicKey: string | null;
      merchantReady: boolean;
    } | null>(null),
    [paymentConfigurationError, setPaymentConfigurationError] = useState("");
  // Se lee al abrir el checkout, así lo que queda del mes está al día.
  const familia = useFamilyPayment(checkoutOpen);
  useEffect(() => {
    // Si la membresía deja de estar (la sacaron o la lectura falló), el pago vuelve
    // a la Wallet propia: cotizar con el perfil terminaría en un rechazo seguro.
    if (!familia) setPaymentMode((modo) => (modo === "family" ? "wallet" : modo));
  }, [familia]);
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
  // Preferencias de entrega (P-02). Fuera de la cotización a propósito: no
  // cambian el precio, y escribir una indicación no tiene que volver a cotizar.
  const [preferencias, setPreferencias] = useState(PREFERENCIAS_INICIALES);
  const [checkoutQuote, setCheckoutQuote] = useState<FoodCheckoutQuote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState(""),
    [quoteRevision, setQuoteRevision] = useState(0),
    [quoteClock, setQuoteClock] = useState(Date.now());
  const selectedAddress = geocodedAddresses.find((entry) => entry.id === selectedAddressId) || null;
  // Retiro en el local (GTM-002). Arranca en `delivery` porque es lo que elige
  // la enorme mayoría: el retiro se ofrece, no se asume.
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const primaryBranch = restaurant?.branches?.find((branch) => branch.isPrimary) || null;
  // El retiro se habilita sucursal por sucursal. Si la principal no lo ofrece y
  // otra sí, el retiro va a esa: se manda su id explícito, así que la sucursal
  // que se muestra es la misma que cotiza el servidor.
  const pickupBranch = primaryBranch?.pickupEnabled
    ? primaryBranch
    : restaurant?.branches?.find((branch) => branch.pickupEnabled) || null;
  const pickupAvailable = Boolean(pickupBranch);
  const esRetiro = fulfillment === "pickup";
  const checkoutBranch = esRetiro ? pickupBranch : primaryBranch;
  // PAG-01: el efectivo lo acepta cada sucursal. Se mira la que cotiza, que en un
  // retiro puede no ser la principal.
  const efectivoDisponible = checkoutBranch?.cashEnabled === true;
  const enEfectivo = paymentMode === "cash";
  // «¿Con cuánto pagás?», en pesos enteros tal como se escribe. Vacío es «pago justo».
  const [conCuanto, setConCuanto] = useState("");
  useEffect(() => {
    // Si la sucursal deja de aceptarlo —o se pasa a una que no— el pago vuelve al
    // medio por omisión: cotizar en efectivo terminaría en un 409 seguro.
    if (!efectivoDisponible) setPaymentMode((modo) => (modo === "cash" ? "wallet" : modo));
  }, [efectivoDisponible]);
  useEffect(() => {
    if (!enEfectivo) return;
    // En efectivo no hay cobro en el que viaje la propina, y alguien tiene que
    // recibir la plata: el servidor rechaza las dos cosas con 409.
    setTipCents(0);
    setPreferencias((actual) =>
      actual.dropoff === "leave_at_door" ? { ...actual, dropoff: "hand_to_me" } : actual,
    );
  }, [enEfectivo]);
  useEffect(() => {
    // Si el local deja de ofrecerlo —o se cambia de local— el modo vuelve a
    // entrega. Quedarse en retiro mostraría un checkout que el servidor rechaza.
    if (!pickupAvailable) setFulfillment("delivery");
  }, [pickupAvailable]);
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
    if (!restaurant) {
      setCheckoutQuote(null);
      setQuoteError("");
      setQuoteBusy(false);
      return;
    }
    // La dirección sólo hace falta cuando Flash lleva el pedido. Exigirla en
    // retiro bloquearía el modo entero por un dato que no se usa — y es
    // justamente el cliente sin dirección guardada el que más lo necesita.
    if (!esRetiro && !selectedAddress) {
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
          customerId,
          restaurantId: restaurant.id,
          branchId: checkoutBranch?.id,
          fulfillment,
          deliveryAddressId: esRetiro ? undefined : selectedAddress?.id,
          paymentMethod:
            paymentMode === "wallet"
              ? walletMethod?.label || "Flash Wallet"
              : paymentMode === "family"
                ? FAMILY_PAYMENT
                : paymentMode === "cash"
                  ? CASH_PAYMENT
                  : "Mercado Pago",
          // El perfil familiar y el efectivo no son métodos guardados: el servidor
          // rechaza un id con ellos.
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
    customerId,
    // Sin esto, cambiar de modo dejaría en pantalla el precio del modo
    // anterior: el envío cobrado de un pedido que el cliente va a retirar.
    fulfillment,
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
  // PAG-01: si es efectivo lo dice la cotización firmada, igual que el modo.
  const cotizoEfectivo = checkoutQuote?.paymentMethod === CASH_PAYMENT;
  // El servidor exige que alcance para el total (400 si no). Se valida acá para no
  // ofrecer un confirmar que va a fallar; el que decide sigue siendo el servidor.
  const conCuantoPesos = conCuanto.trim() === "" ? null : Number(conCuanto);
  const totalCents = checkoutQuote ? Math.round(checkoutQuote.total * 100) : 0;
  const conCuantoInvalido =
    cotizoEfectivo &&
    conCuantoPesos !== null &&
    (!Number.isInteger(conCuantoPesos) || conCuantoPesos * 100 < totalCents);
  const efectivoEntregado =
    cotizoEfectivo && conCuantoPesos !== null && !conCuantoInvalido
      ? { cashTenderedCents: conCuantoPesos * 100 }
      : {};
  // **El modo lo dicta la cotización firmada, no el botón.** El servidor
  // compara el `fulfillment` del pedido contra el del token y rechaza el que no
  // coincida; construir la elección desde el estado local permitiría mandar un
  // modo que el precio no respalda.
  const checkoutSelection: FoodCheckoutSelection | null = !checkoutQuote
    ? null
    : checkoutQuote.fulfillment === "pickup"
      ? {
          fulfillment: "pickup",
          deliveryAddress: checkoutQuote.pickupAddress,
          paymentMethod: checkoutQuote.paymentMethod,
          paymentMethodId: checkoutQuote.paymentMethodId || undefined,
          quoteToken: checkoutQuote.quoteToken,
          // Sin reparto no hay a quién darle propina, y el servidor devuelve 409
          // si llega una. Se manda en cero en lugar de omitirla para que no
          // dependa de que el selector se haya ocultado.
          tipCents: 0,
          scheduledFor,
          // En retiro sólo vale la elección de cubiertos: modo e indicaciones
          // de reparto no existen, y el servidor rechaza el pedido que las lleve.
          deliveryPreferences: { ...PREFERENCIAS_INICIALES, cutlery: preferencias.cutlery },
          ...efectivoEntregado,
        }
      : selectedAddress
        ? {
            fulfillment: "delivery",
            deliveryAddressId: selectedAddress.id,
            deliveryAddress: checkoutQuote.deliveryAddress,
            paymentMethod: checkoutQuote.paymentMethod,
            paymentMethodId: checkoutQuote.paymentMethodId || undefined,
            quoteToken: checkoutQuote.quoteToken,
            // En efectivo la propina se da en mano: el servidor rechaza una con 409.
            tipCents: cotizoEfectivo ? 0 : tipCents,
            scheduledFor,
            deliveryPreferences: preferencias,
            ...efectivoEntregado,
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
                {restaurant?.etaMin} min ·{" "}
                {esRetiro
                  ? "retirás en el local"
                  : `envio ${money.format(restaurant?.deliveryFee || 0)}`}
              </span>
            </div>
          </div>
          <div className="cart-items">
            {cart.map((line, index) => (
              <div className="cart-row" key={`${line.item.id}-${index}`}>
                {/* FE-04: un plato sin foto ya no hereda la del local; «Sin foto» y no
                    un <img> vacío que el navegador muestra roto. */}
                <DishPhoto item={line.item} size={68} />
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
              <FoodFulfillmentPicker
                fulfillment={fulfillment}
                onChange={setFulfillment}
                onTipReset={() => setTipCents(0)}
                pickupAvailable={pickupAvailable}
                deliveryFee={restaurant?.deliveryFee || 0}
                branchName={checkoutBranch?.name || restaurant?.name || "El local"}
                branchAddress={checkoutBranch?.address || ""}
                quotedPickupAddress={
                  checkoutQuote?.fulfillment === "pickup" ? checkoutQuote.pickupAddress : null
                }
                addresses={geocodedAddresses}
                selectedAddressId={selectedAddressId}
                onSelectAddress={setSelectedAddressId}
              />
              <FoodDeliveryPreferences
                value={preferencias}
                onChange={setPreferencias}
                pickup={esRetiro}
                vertical={restaurant?.vertical ?? "restaurant"}
                disabled={busy}
                cash={enEfectivo}
              />
              <div className="checkout-section-heading">
                <div>
                  <span className="muted-label">Pago</span>
                  <strong>Elegí cómo pagar</strong>
                </div>
                <CreditCard size={18} />
              </div>
              <div
                className={[
                  "payment-choice",
                  familia ? "with-family" : "",
                  efectivoDisponible ? "with-cash" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="radiogroup"
                aria-label="Método de pago"
              >
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
                {/* PAG-05: sólo para quien es miembro activo de un perfil familiar. */}
                {familia && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={paymentMode === "family"}
                    className={paymentMode === "family" ? "active family-option" : "family-option"}
                    onClick={() => setPaymentMode("family")}
                  >
                    <Users size={18} />
                    <span>
                      <strong>{FAMILY_PAYMENT}</strong>
                      <small>{familyPaymentDetail(familia)}</small>
                    </span>
                  </button>
                )}
                {/* PAG-01: sólo donde la sucursal que cotiza acepta efectivo. */}
                {efectivoDisponible && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={enEfectivo}
                    className={enEfectivo ? "active cash-option" : "cash-option"}
                    onClick={() => setPaymentMode("cash")}
                  >
                    <Banknote size={18} />
                    <span>
                      <strong>{CASH_PAYMENT}</strong>
                      <small>
                        {esRetiro
                          ? "Pagás en el mostrador al retirar"
                          : "Le pagás al repartidor cuando llega"}
                      </small>
                    </span>
                  </button>
                )}
              </div>
              {enEfectivo && (
                <label className="cash-tendered">
                  <span>¿Con cuánto pagás?</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Opcional"
                    aria-invalid={conCuantoInvalido}
                    aria-describedby="cash-tendered-hint"
                    value={conCuanto}
                    disabled={busy}
                    onChange={(event) => setConCuanto(event.target.value.replace(/\D/g, ""))}
                  />
                  <small
                    id="cash-tendered-hint"
                    className={conCuantoInvalido ? "invalid" : undefined}
                  >
                    {conCuantoInvalido && checkoutQuote
                      ? `Tiene que ser al menos ${money.format(checkoutQuote.total)}`
                      : esRetiro
                        ? "En pesos, así el local tiene listo tu vuelto. Si pagás justo, dejalo vacío."
                        : "En pesos, así el repartidor lleva tu vuelto. Si pagás justo, dejalo vacío."}
                  </small>
                </label>
              )}
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
                      {checkoutQuote.fulfillment === "pickup"
                        ? `Listo para retirar en aproximadamente ${checkoutQuote.etaMin} min · ${checkoutQuote.pricingVersion}`
                        : `${checkoutQuote.distanceKm} km · llega en aproximadamente ${checkoutQuote.etaMin} min · ${checkoutQuote.pricingVersion}`}
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
          {/* La propina es para el repartidor. En retiro no hay ninguno, y el
              servidor devuelve 409 al pedido que la lleve: ofrecerla sería
              ofrecer un camino que termina en error. */}
          {/* PAG-01: en efectivo no hay cobro en el que viaje la propina. */}
          {checkoutOpen &&
            checkoutQuote &&
            enEfectivo &&
            checkoutQuote.fulfillment !== "pickup" && (
              <p className="cash-tip-note" role="note">
                La propina se la das en mano
              </p>
            )}
          {checkoutOpen &&
            checkoutQuote &&
            !enEfectivo &&
            checkoutQuote.fulfillment !== "pickup" && (
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
          {/* Con el perfil familiar y en efectivo también se confirma acá: no hay
              pasarela de tarjeta. */}
          {(paymentMode === "wallet" || paymentMode === "family" || paymentMode === "cash") && (
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
                  (quoteBusy ||
                    !checkoutSelection ||
                    quoteExpired ||
                    Boolean(quoteError) ||
                    conCuantoInvalido))
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
