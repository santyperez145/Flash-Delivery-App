import { useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CreditCard,
  Home,
  Leaf,
  MapPin,
  MessageCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Store,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";

import { api } from "../api";
import { allergenOptions, dietOptions } from "../dietary";
import { initials } from "../format";
import type { AppState, DietaryPreferences, User, UserAddress } from "../types";

export function CustomerProfileScreen({
  user,
  address,
  paymentMethods,
  addresses,
  onSave,
  onCreateAddress,
  onUpdateAddress,
  onSetDefaultAddress,
  onDeleteAddress,
  dietaryPreferences,
  onDietaryPreferencesChange,
}: {
  user: User | null;
  address?: string;
  paymentMethods: AppState["paymentMethods"];
  addresses: UserAddress[];
  onSave: (payload: { name: string; phone: string; defaultAddress: string }) => void;
  onCreateAddress: (payload: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    isDefault: boolean;
    validationToken: string;
  }) => Promise<boolean>;
  onUpdateAddress: (
    addressId: string,
    payload: {
      label: string;
      address: string;
      lat: number;
      lng: number;
      isDefault: boolean;
      validationToken: string;
    },
  ) => Promise<boolean>;
  onSetDefaultAddress: (addressId: string) => Promise<boolean>;
  onDeleteAddress: (addressId: string) => Promise<boolean>;
  dietaryPreferences: DietaryPreferences | null;
  onDietaryPreferencesChange: (preferences: DietaryPreferences) => void;
}) {
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [defaultAddress, setDefaultAddress] = useState(address || user?.defaultAddress || "");
  const [dietary, setDietary] = useState<DietaryPreferences | null>(dietaryPreferences),
    [dietaryBusy, setDietaryBusy] = useState(false),
    [dietaryError, setDietaryError] = useState("");
  const [addressDraft, setAddressDraft] = useState({
    label: "Casa",
    address: "",
    lat: null as number | null,
    lng: null as number | null,
    isDefault: addresses.length === 0,
    validationToken: "",
  });
  const [addressMatches, setAddressMatches] = useState<
      Array<{
        label: string;
        point: { lat: number; lng: number };
        type: string;
        placeId: string | null;
        validationToken: string;
      }>
    >([]),
    [addressValidationBusy, setAddressValidationBusy] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressStatus, setAddressStatus] = useState("");
  const [addressStatusTone, setAddressStatusTone] = useState<"ready" | "denied" | "">("");
  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
    setDefaultAddress(address || user?.defaultAddress || "");
  }, [address, user?.defaultAddress, user?.name, user?.phone]);
  useEffect(() => setDietary(dietaryPreferences), [dietaryPreferences]);
  const toggleDiet = (code: string) =>
    setDietary((current) =>
      current
        ? {
            ...current,
            dietaryLabels: current.dietaryLabels.some((item) => item.code === code)
              ? current.dietaryLabels.filter((item) => item.code !== code)
              : [
                  ...current.dietaryLabels,
                  { code, name: dietOptions.find((item) => item.code === code)?.name || code },
                ],
          }
        : current,
    );
  const toggleAllergen = (code: string) =>
    setDietary((current) =>
      current
        ? {
            ...current,
            avoidedAllergens: current.avoidedAllergens.some((item) => item.code === code)
              ? current.avoidedAllergens.filter((item) => item.code !== code)
              : [
                  ...current.avoidedAllergens,
                  { code, name: allergenOptions.find((item) => item.code === code)?.name || code },
                ],
          }
        : current,
    );
  const saveDietary = async () => {
    if (!dietary) return;
    setDietaryBusy(true);
    setDietaryError("");
    try {
      const result = await api.updateDietaryPreferences({
        dietaryLabels: dietary.dietaryLabels.map((item) => item.code),
        avoidedAllergens: dietary.avoidedAllergens.map((item) => item.code),
        hideIncompatible: dietary.hideIncompatible,
      });
      setDietary(result.preferences);
      onDietaryPreferencesChange(result.preferences);
    } catch (error) {
      setDietaryError(
        error instanceof Error ? error.message : "No se pudieron guardar tus preferencias",
      );
    } finally {
      setDietaryBusy(false);
    }
  };
  const resetAddressDraft = () => {
    setEditingAddressId(null);
    setAddressDraft({
      label: "Casa",
      address: "",
      lat: null,
      lng: null,
      isDefault: addresses.length === 0,
      validationToken: "",
    });
    setAddressMatches([]);
    setAddressStatus("");
    setAddressStatusTone("");
  };
  const editAddress = (entry: UserAddress) => {
    setEditingAddressId(entry.id);
    setAddressDraft({
      label: entry.label,
      address: entry.address,
      lat: entry.lat,
      lng: entry.lng,
      isDefault: entry.isDefault,
      validationToken: "",
    });
    setAddressMatches([]);
    setAddressStatus("");
    setAddressStatusTone("");
  };
  const validateAddress = async () => {
    const query = addressDraft.address.trim();
    if (query.length < 3) return;
    setAddressValidationBusy(true);
    setAddressStatus("Buscando coincidencias verificables...");
    setAddressStatusTone("");
    try {
      const response = await api.geocode(query);
      setAddressMatches(response.results.slice(0, 5));
      if (!response.results.length) {
        setAddressStatus("No encontramos una dirección precisa. Agregá calle, número y ciudad.");
        setAddressStatusTone("denied");
      } else {
        setAddressStatus("Elegí la coincidencia correcta antes de guardar.");
      }
    } catch (error) {
      setAddressMatches([]);
      setAddressStatus(
        error instanceof Error ? error.message : "No pudimos validar la dirección ahora.",
      );
      setAddressStatusTone("denied");
    } finally {
      setAddressValidationBusy(false);
    }
  };
  const selectAddressMatch = (match: (typeof addressMatches)[number]) => {
    setAddressDraft((current) => ({
      ...current,
      address: match.label,
      lat: match.point.lat,
      lng: match.point.lng,
      validationToken: match.validationToken,
    }));
    setAddressMatches([]);
    setAddressStatus("Dirección validada por el proveedor. Ya podés guardarla.");
    setAddressStatusTone("ready");
  };
  const saveAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !addressDraft.address.trim() ||
      addressDraft.lat === null ||
      addressDraft.lng === null ||
      !addressDraft.validationToken
    ) {
      setAddressStatus("Buscá la dirección y elegí una coincidencia antes de guardarla.");
      setAddressStatusTone("denied");
      return;
    }
    const payload = {
      label: addressDraft.label.trim() || "Otro",
      address: addressDraft.address.trim(),
      lat: addressDraft.lat,
      lng: addressDraft.lng,
      isDefault: addressDraft.isDefault,
      validationToken: addressDraft.validationToken,
    };
    const saved = editingAddressId
      ? await onUpdateAddress(editingAddressId, payload)
      : await onCreateAddress(payload);
    if (saved) resetAddressDraft();
  };
  return (
    <div className="activity-stack">
      <section className="profile-hero">
        <div className="avatar large">{initials(user?.name || "FD")}</div>
        <div>
          <h2>{user?.name}</h2>
          <span>{user?.email}</span>
        </div>
      </section>
      <div className="settings-list">
        <label className="settings-row">
          <UserRound size={18} />
          <div>
            <strong>Nombre</strong>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </label>
        <label className="settings-row">
          <MessageCircle size={18} />
          <div>
            <strong>Telefono</strong>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </label>
        <label className="settings-row">
          <MapPin size={18} />
          <div>
            <strong>Direccion principal</strong>
            <input
              value={defaultAddress}
              onChange={(event) => setDefaultAddress(event.target.value)}
            />
          </div>
        </label>
        <div className="settings-row">
          <CreditCard size={18} />
          <div>
            <strong>Metodos de pago</strong>
            <span>
              {paymentMethods.length
                ? paymentMethods.map((method) => method.label).join(", ")
                : "Sin metodos configurados"}
            </span>
          </div>
        </div>
        <div className="settings-row">
          <ShieldCheck size={18} />
          <div>
            <strong>Cuenta autenticada</strong>
            <span>{user?.email}</span>
          </div>
        </div>
      </div>
      <section className="address-book-card" aria-labelledby="address-book-title">
        <div className="address-book-heading">
          <div>
            <span className="muted-label">Checkout mas rapido</span>
            <h3 id="address-book-title">Mis direcciones</h3>
            <p>
              Guarda destinos frecuentes y usa coordenadas reales para entregar o pedir un viaje.
            </p>
          </div>
          <MapPin size={22} />
        </div>
        {addresses.length > 0 ? (
          <div className="saved-address-list">
            {addresses.map((entry) => (
              <article className="saved-address-row" key={entry.id}>
                <span
                  className={entry.isDefault ? "saved-address-icon default" : "saved-address-icon"}
                >
                  {entry.label.toLowerCase().includes("trab") ? (
                    <Store size={17} />
                  ) : (
                    <Home size={17} />
                  )}
                </span>
                <div className="saved-address-copy">
                  <div>
                    <strong>{entry.label}</strong>
                    {entry.isDefault && (
                      <span className="default-address-badge">Predeterminada</span>
                    )}
                  </div>
                  <span>{entry.address}</span>
                  <small>
                    {entry.lat !== null && entry.lng !== null
                      ? entry.isValidated
                        ? `Validada${entry.geocodingProvider ? ` · ${entry.geocodingProvider}` : ""}`
                        : "Requiere volver a validarse"
                      : "Sin coordenadas"}
                  </small>
                </div>
                <div className="saved-address-actions">
                  {!entry.isDefault && (
                    <button
                      type="button"
                      className="icon-button"
                      title="Usar como predeterminada"
                      aria-label={`Usar ${entry.label} como predeterminada`}
                      onClick={() => void onSetDefaultAddress(entry.id)}
                    >
                      <Check size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    title="Editar direccion"
                    aria-label={`Editar ${entry.label}`}
                    onClick={() => editAddress(entry)}
                  >
                    <Settings size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Eliminar direccion"
                    aria-label={`Eliminar ${entry.label}`}
                    onClick={() => void onDeleteAddress(entry.id)}
                  >
                    <X size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="address-empty">
            <MapPin size={17} />
            <span>Aun no tienes destinos guardados.</span>
          </div>
        )}
        <form className="address-form" onSubmit={saveAddress}>
          <div className="address-form-heading">
            <strong>{editingAddressId ? "Editar destino" : "Nuevo destino"}</strong>
            {editingAddressId && (
              <button type="button" className="text-button" onClick={resetAddressDraft}>
                Cancelar
              </button>
            )}
          </div>
          <div className="address-form-grid">
            <label>
              <span>Etiqueta</span>
              <select
                value={addressDraft.label}
                onChange={(event) =>
                  setAddressDraft((current) => ({ ...current, label: event.target.value }))
                }
              >
                <option>Casa</option>
                <option>Trabajo</option>
                <option>Otro</option>
              </select>
            </label>
            <label className="address-form-wide">
              <span>Direccion</span>
              <input
                value={addressDraft.address}
                onChange={(event) =>
                  setAddressDraft((current) => ({
                    ...current,
                    address: event.target.value,
                    lat: null,
                    lng: null,
                    validationToken: "",
                  }))
                }
                placeholder="Ej. Av. Corrientes 1234"
              />
            </label>
          </div>
          <button
            type="button"
            className="location-action"
            onClick={() => void validateAddress()}
            disabled={addressDraft.address.trim().length < 3 || addressValidationBusy}
          >
            {addressValidationBusy ? <RefreshCw size={15} /> : <Search size={15} />}
            {addressValidationBusy ? " Validando..." : " Validar dirección"}
          </button>
          {addressMatches.length > 0 && (
            <div className="address-suggestion-list" aria-label="Coincidencias de dirección">
              {addressMatches.map((match) => (
                <button
                  type="button"
                  key={`${match.placeId || match.label}:${match.point.lat}:${match.point.lng}`}
                  onClick={() => selectAddressMatch(match)}
                >
                  <MapPin size={15} />
                  <span>{match.label}</span>
                </button>
              ))}
            </div>
          )}
          {addressStatus && (
            <small className={`location-message ${addressStatusTone}`}>{addressStatus}</small>
          )}
          <label className="address-default-toggle">
            <input
              type="checkbox"
              checked={addressDraft.isDefault}
              onChange={(event) =>
                setAddressDraft((current) => ({ ...current, isDefault: event.target.checked }))
              }
            />
            <span>Usar para próximos pedidos y viajes</span>
          </label>
          <button
            type="submit"
            className="secondary-button"
            disabled={
              !addressDraft.address.trim() ||
              addressDraft.lat === null ||
              addressDraft.lng === null ||
              !addressDraft.validationToken
            }
          >
            <MapPin size={16} /> {editingAddressId ? "Actualizar direccion" : "Guardar direccion"}
          </button>
        </form>
      </section>
      <section className="dietary-profile-card" aria-labelledby="dietary-profile-title">
        <div className="dietary-profile-heading">
          <span>
            <Leaf size={19} />
          </span>
          <div>
            <h3 id="dietary-profile-title">Mi alimentación</h3>
            <p>Personalizá el catálogo usando declaraciones verificables del comercio.</p>
          </div>
        </div>
        {!dietary && !dietaryError && (
          <p className="dietary-loading" role="status">
            <RefreshCw size={15} /> Cargando preferencias…
          </p>
        )}
        {dietary && (
          <>
            <strong>Apto para</strong>
            <div className="dietary-chip-list">
              {dietOptions.map((option) => {
                const selected = dietary.dietaryLabels.some((item) => item.code === option.code);
                return (
                  <button
                    type="button"
                    key={option.code}
                    className={selected ? "dietary-chip selected" : "dietary-chip"}
                    aria-pressed={selected}
                    onClick={() => toggleDiet(option.code)}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
            <strong>Evito estos alérgenos</strong>
            <div className="dietary-chip-list">
              {allergenOptions.map((option) => {
                const selected = dietary.avoidedAllergens.some((item) => item.code === option.code);
                return (
                  <button
                    type="button"
                    key={option.code}
                    className={
                      selected ? "dietary-chip allergen selected" : "dietary-chip allergen"
                    }
                    aria-pressed={selected}
                    onClick={() => toggleAllergen(option.code)}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="dietary-filter-toggle"
              role="switch"
              aria-checked={dietary.hideIncompatible}
              onClick={() =>
                setDietary((current) =>
                  current ? { ...current, hideIncompatible: !current.hideIncompatible } : current,
                )
              }
            >
              <span>
                <strong>Ocultar incompatibles</strong>
                <small>“Sin datos” nunca significa que un producto sea seguro.</small>
              </span>
              <i aria-hidden="true" className={dietary.hideIncompatible ? "active" : ""} />
            </button>
            <div className="dietary-caution">
              <TriangleAlert size={17} />
              <span>
                Ante una alergia severa, confirmá con el comercio. Las indicaciones no eliminan
                contaminación cruzada.
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={dietaryBusy}
              onClick={() => void saveDietary()}
            >
              {dietaryBusy ? "Guardando…" : "Guardar preferencias alimentarias"}
            </button>
          </>
        )}
        {dietaryError && (
          <p className="form-error" role="alert">
            {dietaryError}
          </p>
        )}
      </section>
      <button
        className="primary-button"
        type="button"
        disabled={!name.trim() || !defaultAddress.trim()}
        onClick={() =>
          onSave({
            name: name.trim(),
            phone: phone.trim(),
            defaultAddress: defaultAddress.trim(),
          })
        }
      >
        <Check size={17} /> Guardar cambios
      </button>
    </div>
  );
}
