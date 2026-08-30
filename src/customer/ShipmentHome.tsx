import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  Clock3,
  LocateFixed,
  PackageCheck,
  ShieldCheck,
  TriangleAlert,
  Truck,
  WalletCards,
} from "lucide-react";

import { api } from "../api";
import { money } from "../format";
import type {
  AppState,
  GeoPoint,
  Shipment,
  ShipmentCreatePayload,
  ShipmentOptions,
  ShipmentQuote,
  User,
} from "../types";

export function ShipmentHome({
  state,
  user,
  busy,
  onCreateShipment,
}: {
  state: AppState;
  user: User | null;
  busy: boolean;
  onCreateShipment: (payload: ShipmentCreatePayload) => Promise<void>;
}) {
  const savedAddresses = state.addresses.filter(
    (address) =>
      address.userId === user?.id &&
      !address.id.startsWith("profile-") &&
      address.lat !== null &&
      address.lng !== null,
  );
  const [options, setOptions] = useState<ShipmentOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [pickup, setPickup] = useState(user?.defaultAddress || savedAddresses[0]?.address || "");
  const [destination, setDestination] = useState("");
  const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>(null);
  const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(null);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [description, setDescription] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [packageSize, setPackageSize] = useState<Shipment["packageSize"]>("small");
  const [weightKg, setWeightKg] = useState("1");
  const [declaredValue, setDeclaredValue] = useState("0");
  const [protection, setProtection] = useState<NonNullable<Shipment["protection"]>>("none");
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [itemCategory, setItemCategory] =
    useState<NonNullable<Shipment["itemCategory"]>>("standard");
  const [serviceLevel, setServiceLevel] =
    useState<NonNullable<Shipment["serviceLevel"]>>("standard");
  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [quoteClock, setQuoteClock] = useState(() => Date.now());
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!quote?.expiresAt) return;
    setQuoteClock(Date.now());
    const timer = window.setInterval(() => setQuoteClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quote?.expiresAt]);

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(null);
    void api
      .getShipmentOptions()
      .then((response) => {
        if (cancelled) return;
        setOptions(response);
        const activeCategory = response.categories.find((entry) => entry.active !== false);
        const activeServiceLevel = response.serviceLevels.find((entry) => entry.active !== false);
        if (
          !response.categories.some(
            (entry) => entry.code === itemCategory && entry.active !== false,
          ) &&
          activeCategory
        )
          setItemCategory(activeCategory.code);
        if (
          !response.serviceLevels.some(
            (entry) => entry.code === serviceLevel && entry.active !== false,
          ) &&
          activeServiceLevel
        )
          setServiceLevel(activeServiceLevel.code);
      })
      .catch((error) => {
        if (!cancelled)
          setOptionsError(
            error instanceof Error ? error.message : "No se pudieron cargar las opciones de envío",
          );
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCategories = options?.categories.filter((entry) => entry.active !== false) || [];
  const activeServiceLevels =
    options?.serviceLevels.filter((entry) => entry.active !== false) || [];
  const selectedCategory = activeCategories.find((entry) => entry.code === itemCategory);
  const selectedServiceLevel = activeServiceLevels.find((entry) => entry.code === serviceLevel);
  const quoteExpired = Boolean(
    quote?.expiresAt && new Date(quote.expiresAt).getTime() <= quoteClock,
  );

  const clearQuote = () => {
    setQuote(null);
    setQuoteError(null);
    setSubmitError(null);
  };

  const chooseSavedPickup = (addressId: string) => {
    const address = savedAddresses.find((entry) => entry.id === addressId);
    if (!address || address.lat === null || address.lng === null) return;
    setPickup(address.address);
    setPickupCoords({ lat: address.lat, lng: address.lng });
    clearQuote();
  };

  const quoteShipment = async () => {
    setQuoteBusy(true);
    setQuoteError(null);
    setSubmitError(null);
    try {
      if (optionsLoading) throw new Error("Esperá a que carguemos las opciones de envío");
      if (!options || !selectedCategory || !selectedServiceLevel)
        throw new Error("La configuración de envíos no está disponible");
      if (pickup.trim().length < 3 || destination.trim().length < 3)
        throw new Error("Completá origen y destino");
      if (recipientName.trim().length < 2) throw new Error("Indicá quién recibe el paquete");
      if (recipientPhone.trim().length < 6)
        throw new Error("Indicá un teléfono de contacto válido");
      if (description.trim().length < 2)
        throw new Error("Describí brevemente el contenido del paquete");
      const parsedWeight = Number(weightKg);
      const parsedDeclaredValue = Number(declaredValue || 0);
      if (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || parsedWeight > 20)
        throw new Error("El peso debe estar entre 0,1 y 20 kg");
      if (!Number.isFinite(parsedDeclaredValue) || parsedDeclaredValue < 0)
        throw new Error("El valor declarado no es válido");
      if (protection === "standard" && parsedDeclaredValue <= 0)
        throw new Error("Indicá el valor declarado para contratar protección");

      const pickupMatch = pickupCoords
        ? { label: pickup, point: pickupCoords }
        : (await api.geocode(pickup.trim())).results[0];
      const destinationMatch = (await api.geocode(destination.trim())).results[0];
      if (!pickupMatch?.point || !destinationMatch?.point)
        throw new Error("No pudimos ubicar una de las direcciones");

      const normalizedPickup = pickupMatch.label || pickup.trim();
      const normalizedDestination = destinationMatch.label || destination.trim();
      setPickup(normalizedPickup);
      setDestination(normalizedDestination);
      setPickupCoords(pickupMatch.point);
      setDestinationCoords(destinationMatch.point);
      const response = await api.quoteShipment({
        pickup: normalizedPickup,
        destination: normalizedDestination,
        packageSize,
        weightKg: parsedWeight,
        declaredValue: parsedDeclaredValue,
        protection,
        signatureRequired,
        itemCategory,
        serviceLevel,
        pickupCoords: pickupMatch.point,
        destinationCoords: destinationMatch.point,
      });
      setQuote(response.quote);
    } catch (error) {
      setQuote(null);
      setQuoteError(error instanceof Error ? error.message : "No se pudo cotizar el envío");
    } finally {
      setQuoteBusy(false);
    }
  };

  const submitShipment = async () => {
    setSubmitError(null);
    if (!quote?.quoteToken || quoteExpired) {
      setSubmitError("La cotización venció. Calculá una nueva antes de solicitar.");
      return;
    }
    if (!termsAccepted) {
      setSubmitError("Aceptá las restricciones y condiciones del envío");
      return;
    }
    if (!pickupCoords || !destinationCoords) {
      setSubmitError("Volvé a cotizar para validar las coordenadas reales");
      return;
    }
    try {
      await onCreateShipment({
        pickup,
        destination,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        packageSize,
        description: description.trim(),
        weightKg: Number(weightKg),
        declaredValue: Number(declaredValue || 0),
        protection,
        signatureRequired,
        itemCategory,
        serviceLevel,
        deliveryNotes: deliveryNotes.trim(),
        paymentMethod: "Flash Wallet",
        termsAccepted: true,
        pickupCoords,
        destinationCoords,
        quoteToken: quote.quoteToken,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo solicitar el envío");
    }
  };

  return (
    <div className="shipment-home">
      <section className="shipment-hero">
        <div className="shipment-hero-icon">
          <PackageCheck size={23} />
        </div>
        <div>
          <span className="muted-label">Flash Envíos</span>
          <h1>Mandá un paquete hoy</h1>
          <p>Retiro, seguimiento y entrega con PIN desde una sola app.</p>
        </div>
      </section>
      <section className="shipment-form-card">
        <div className="shipment-section-heading">
          <div>
            <span className="muted-label">Ruta</span>
            <h2>¿De dónde a dónde?</h2>
          </div>
          <span className="shipment-live-chip">
            <LocateFixed size={13} /> Geocodificación real
          </span>
        </div>
        {savedAddresses.length > 0 && (
          <label>
            <span>Usar dirección guardada como origen</span>
            <select defaultValue="" onChange={(event) => chooseSavedPickup(event.target.value)}>
              <option value="">Elegir una dirección</option>
              {savedAddresses.map((address) => (
                <option value={address.id} key={address.id}>
                  {address.label} · {address.address}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="shipment-address-grid">
          <label>
            <span>Origen</span>
            <input
              value={pickup}
              onChange={(event) => {
                setPickup(event.target.value);
                setPickupCoords(null);
                clearQuote();
              }}
              placeholder="Calle, número y ciudad"
              autoComplete="street-address"
            />
          </label>
          <label>
            <span>Destino</span>
            <input
              value={destination}
              onChange={(event) => {
                setDestination(event.target.value);
                setDestinationCoords(null);
                clearQuote();
              }}
              placeholder="Calle, número y ciudad"
              autoComplete="shipping street-address"
            />
          </label>
        </div>
        <div className="shipment-section-heading compact">
          <div>
            <span className="muted-label">Paquete</span>
            <h2>Características del envío</h2>
          </div>
        </div>
        <div className="shipment-size-grid">
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              type="button"
              key={size}
              className={packageSize === size ? "active" : ""}
              onClick={() => {
                setPackageSize(size);
                clearQuote();
              }}
            >
              <PackageCheck size={16} />
              <strong>
                {size === "small" ? "Pequeño" : size === "medium" ? "Mediano" : "Grande"}
              </strong>
              <small>
                {size === "small" ? "Hasta 2 kg" : size === "medium" ? "Hasta 8 kg" : "Hasta 20 kg"}
              </small>
            </button>
          ))}
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>Categoría</span>
            <select
              value={itemCategory}
              disabled={optionsLoading}
              onChange={(event) => {
                setItemCategory(event.target.value as typeof itemCategory);
                clearQuote();
              }}
            >
              {activeCategories.map((categoryOption) => (
                <option value={categoryOption.code} key={categoryOption.code}>
                  {categoryOption.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Nivel de servicio</span>
            <select
              value={serviceLevel}
              disabled={optionsLoading}
              onChange={(event) => {
                setServiceLevel(event.target.value as typeof serviceLevel);
                clearQuote();
              }}
            >
              {activeServiceLevels.map((level) => (
                <option value={level.code} key={level.code}>
                  {level.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Peso en kg</span>
            <input
              type="number"
              min="0.1"
              max="20"
              step="0.1"
              value={weightKg}
              onChange={(event) => {
                setWeightKg(event.target.value);
                clearQuote();
              }}
            />
          </label>
          <label>
            <span>Valor declarado</span>
            <input
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={declaredValue}
              onChange={(event) => {
                setDeclaredValue(event.target.value);
                clearQuote();
              }}
            />
          </label>
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>¿Qué enviás?</span>
            <input
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                clearQuote();
              }}
              maxLength={180}
              placeholder="Ej. Documentos, regalo, electrónica"
            />
          </label>
          <label>
            <span>Protección</span>
            <select
              value={protection}
              onChange={(event) => {
                setProtection(event.target.value as typeof protection);
                clearQuote();
              }}
            >
              <option value="none">Sin protección adicional</option>
              <option value="standard">Protección estándar</option>
            </select>
          </label>
        </div>
        <label className="shipment-check-row">
          <input
            type="checkbox"
            checked={signatureRequired}
            onChange={(event) => {
              setSignatureRequired(event.target.checked);
              clearQuote();
            }}
          />
          <span>
            <strong>Solicitar firma del destinatario</strong>
            <small>La entrega conservará firma y consentimiento cifrados.</small>
          </span>
        </label>
        <div className="shipment-section-heading compact">
          <div>
            <span className="muted-label">Entrega</span>
            <h2>¿Quién recibe?</h2>
          </div>
        </div>
        <div className="shipment-fields-grid">
          <label>
            <span>Nombre del destinatario</span>
            <input
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              autoComplete="name"
              placeholder="Nombre y apellido"
            />
          </label>
          <label>
            <span>Teléfono</span>
            <input
              value={recipientPhone}
              onChange={(event) => setRecipientPhone(event.target.value)}
              autoComplete="tel"
              placeholder="Código de área y número"
            />
          </label>
        </div>
        <label>
          <span>
            Indicaciones para el retiro o entrega <small>(opcional)</small>
          </span>
          <textarea
            value={deliveryNotes}
            onChange={(event) => setDeliveryNotes(event.target.value)}
            maxLength={300}
            placeholder="Piso, horario o referencia útil"
          />
        </label>
        {selectedCategory?.handlingInstructions && (
          <p className="shipment-rule-note">
            <ShieldCheck size={15} /> {selectedCategory.handlingInstructions}
          </p>
        )}
        {optionsError && (
          <p className="form-error">
            <TriangleAlert size={15} /> {optionsError}
          </p>
        )}
        {quoteError && (
          <p className="form-error">
            <TriangleAlert size={15} /> {quoteError}
          </p>
        )}
        <button
          className="primary-button shipment-quote-button"
          type="button"
          onClick={() => void quoteShipment()}
          disabled={busy || quoteBusy || optionsLoading}
        >
          <BadgeDollarSign size={17} /> {quoteBusy ? "Ubicando y calculando…" : "Cotizar envío"}
        </button>
      </section>
      {quote && (
        <section className="shipment-quote-card">
          <div className="shipment-quote-topline">
            <div>
              <span className="muted-label">Cotización vigente</span>
              <strong>{money.format(quote.fare)}</strong>
            </div>
            <span className="shipment-quote-eta">
              <Clock3 size={14} /> {quote.etaMin} min estimados
            </span>
          </div>
          <div className="shipment-quote-details">
            <span>{quote.distanceKm} km de recorrido</span>
            <span>
              {quote.itemCategoryName || selectedCategory?.name || "Categoría configurada"}
            </span>
            <span>{quote.serviceLevelName || selectedServiceLevel?.name || "SLA configurado"}</span>
            {quote.protectionPremium ? (
              <span>Protección {money.format(quote.protectionPremium)}</span>
            ) : null}
          </div>
          <small>
            Vence{" "}
            {quote.expiresAt
              ? new Date(quote.expiresAt).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "en 5 minutos"}
            . Si cambiás un dato, deberás cotizar de nuevo.
          </small>
        </section>
      )}
      <section className="shipment-confirm-card">
        <div className="shipment-payment-row">
          <div>
            <span className="muted-label">Medio de pago</span>
            <strong>Flash Wallet</strong>
            <small>Saldo disponible: {money.format(user?.wallet || 0)}</small>
          </div>
          <WalletCards size={20} />
        </div>
        <label className="shipment-check-row terms">
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => {
              setTermsAccepted(event.target.checked);
              setSubmitError(null);
            }}
          />
          <span>
            Acepto las restricciones de artículos, los términos de entrega y el uso del PIN o firma
            para verificar la recepción.
          </span>
        </label>
        {submitError && (
          <p className="form-error">
            <TriangleAlert size={15} /> {submitError}
          </p>
        )}
        <button
          className="primary-button"
          type="button"
          onClick={() => void submitShipment()}
          disabled={busy || !quote?.quoteToken || quoteExpired || !termsAccepted}
        >
          <Truck size={17} /> {busy ? "Solicitando…" : "Solicitar envío"}
        </button>
      </section>
    </div>
  );
}
