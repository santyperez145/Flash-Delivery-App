import { useEffect, useState } from "react";
import { Check, CreditCard, MapPin, MessageCircle, ShieldCheck, UserRound } from "lucide-react";

import { initials } from "../format";
import type { AppState, DietaryPreferences, User, UserAddress } from "../types";
import { CustomerAddressBook, type CustomerAddressPayload } from "./CustomerAddressBook";
import { CustomerDietaryPreferences } from "./CustomerDietaryPreferences";

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
  onCreateAddress: (payload: CustomerAddressPayload) => Promise<boolean>;
  onUpdateAddress: (addressId: string, payload: CustomerAddressPayload) => Promise<boolean>;
  onSetDefaultAddress: (addressId: string) => Promise<boolean>;
  onDeleteAddress: (addressId: string) => Promise<boolean>;
  dietaryPreferences: DietaryPreferences | null;
  onDietaryPreferencesChange: (preferences: DietaryPreferences) => void;
}) {
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [defaultAddress, setDefaultAddress] = useState(address || user?.defaultAddress || "");

  useEffect(() => {
    setName(user?.name || "");
    setPhone(user?.phone || "");
    setDefaultAddress(address || user?.defaultAddress || "");
  }, [address, user?.defaultAddress, user?.name, user?.phone]);

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
      <CustomerAddressBook
        addresses={addresses}
        onCreateAddress={onCreateAddress}
        onUpdateAddress={onUpdateAddress}
        onSetDefaultAddress={onSetDefaultAddress}
        onDeleteAddress={onDeleteAddress}
      />
      <CustomerDietaryPreferences
        dietaryPreferences={dietaryPreferences}
        onDietaryPreferencesChange={onDietaryPreferencesChange}
      />
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
