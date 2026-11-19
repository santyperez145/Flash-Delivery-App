import { useEffect, useState } from "react";
import {
  Check,
  CreditCard,
  LogOut,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { AccountDeletion } from "../ui/AccountDeletion";
import { LegalLinks } from "../ui/LegalLinks";
import { TwoStepVerification } from "../ui/TwoStepVerification";

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
  onLogout,
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
  onLogout: () => void;
}) {
  const [name, setName] = useState(user?.name || "");
  // Cerrar sesión pide confirmación, con «Volver» como opción por omisión: en una
  // computadora compartida, salir por error obliga a ingresar de nuevo.
  const [confirmarSalida, setConfirmarSalida] = useState(false);
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
            <strong>Teléfono</strong>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </label>
        <label className="settings-row">
          <MapPin size={18} />
          <div>
            <strong>Dirección principal</strong>
            <input
              value={defaultAddress}
              onChange={(event) => setDefaultAddress(event.target.value)}
            />
          </div>
        </label>
        <div className="settings-row">
          <CreditCard size={18} />
          <div>
            <strong>Medios de pago</strong>
            <span>
              {paymentMethods.length
                ? paymentMethods.map((method) => method.label).join(", ")
                : "Sin medios configurados"}
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
      <TwoStepVerification />
      {/* FE-05: quien pide también puede tener un local; la postulación es /comercios. */}
      <a className="profile-partner-link" href="/comercios">
        <Store size={17} aria-hidden="true" /> ¿Tenés un comercio? Sumalo a Flash
      </a>
      <LegalLinks />
      {confirmarSalida ? (
        <div
          className="profile-logout-confirm"
          role="group"
          aria-label="Confirmar cierre de sesión"
        >
          <p>¿Cerrar sesión en este navegador?</p>
          <button
            type="button"
            className="profile-logout"
            autoFocus
            onClick={() => setConfirmarSalida(false)}
          >
            Volver
          </button>
          <button type="button" className="profile-logout profile-logout-danger" onClick={onLogout}>
            <LogOut size={17} /> Cerrar sesión
          </button>
        </div>
      ) : (
        <button
          className="secondary-button profile-logout"
          type="button"
          onClick={() => setConfirmarSalida(true)}
        >
          <LogOut size={17} /> Cerrar sesión
        </button>
      )}
      <AccountDeletion />
    </div>
  );
}
