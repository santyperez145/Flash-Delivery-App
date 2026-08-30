import {
  Car,
  Home,
  ListChecks,
  PackageCheck,
  ShoppingBag,
  UserRound,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { CustomerTab, Service } from "../types";

export function ServiceToggle({
  service,
  setService,
  features,
}: {
  service: Service;
  setService: (service: Service) => void;
  features: Record<string, { active: boolean; variant: Record<string, unknown> }> | null;
}) {
  // Un fallo al cargar flags no es una decisión operativa de apagar producto.
  const shipmentsEnabled = features?.shipment_beta?.active ?? true;
  const ridesEnabled = features?.public_rides?.active ?? true;
  return (
    <div className="service-toggle">
      <button
        className={service === "food" ? "active" : ""}
        onClick={() => setService("food")}
        type="button"
      >
        <ShoppingBag size={16} /> Comida
      </button>
      {ridesEnabled && (
        <button
          className={service === "ride" ? "active" : ""}
          onClick={() => setService("ride")}
          type="button"
        >
          <Car size={16} /> Taxi
        </button>
      )}
      {shipmentsEnabled && (
        <button
          className={service === "shipment" ? "active" : ""}
          onClick={() => setService("shipment")}
          type="button"
        >
          <PackageCheck size={16} /> Envíos
        </button>
      )}
    </div>
  );
}

export function CustomerBottomNav({
  tab,
  onTabChange,
}: {
  tab: CustomerTab;
  onTabChange: (tab: CustomerTab) => void;
}) {
  const tabs: Array<{ id: CustomerTab; label: string; icon: LucideIcon }> = [
    { id: "home", label: "Inicio", icon: Home },
    { id: "activity", label: "Actividad", icon: ListChecks },
    { id: "wallet", label: "Wallet", icon: WalletCards },
    { id: "profile", label: "Perfil", icon: UserRound },
  ];
  return (
    <nav className="bottom-nav">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          className={tab === id ? "nav-item active" : "nav-item"}
          key={id}
          onClick={() => onTabChange(id)}
          type="button"
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
