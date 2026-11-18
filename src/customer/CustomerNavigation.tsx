import { Bell, Grid2x2, Home, ListChecks, MapPin, ShoppingBag, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { money } from "../format";
import { IconButton } from "../ui/panels";
import type { CustomerTab } from "../types";

// Navegación del cliente web (RES-02): Inicio · Servicios · Actividad · Cuenta,
// la misma estructura que el móvil. La Wallet vive dentro de Cuenta, como en las
// apps de varios servicios; sigue teniendo su vista, que marca Cuenta en la barra.
// Los interruptores de servicio (`public_rides`, `shipment_beta`) los aplica el
// inicio (`CustomerHome.tsx`): si la lectura falla, no se interpreta como apagado.

export function CustomerHeader({
  address,
  unread,
  cartCount,
  onNotifications,
  onCart,
}: {
  address: string;
  unread: number;
  cartCount: number;
  onNotifications: () => void;
  onCart: () => void;
}) {
  return (
    <header className="home-header">
      <div>
        <span className="muted-label">Enviar a</span>
        <span className="location-button">
          <MapPin size={15} /> {address || "Definir direccion"}
        </span>
      </div>
      <div className="header-actions">
        <IconButton icon={Bell} label="Notificaciones" badge={unread} onClick={onNotifications} />
        <IconButton icon={ShoppingBag} label="Carrito" badge={cartCount} onClick={onCart} />
      </div>
    </header>
  );
}

/** La Wallet vive dentro de Cuenta: un acceso, con el saldo a la vista. */
export function WalletLink({ wallet, onOpen }: { wallet: number; onOpen: () => void }) {
  return (
    <button type="button" className="customer-wallet-link" onClick={onOpen}>
      Wallet · {money.format(wallet)}
    </button>
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
    { id: "services", label: "Servicios", icon: Grid2x2 },
    { id: "activity", label: "Actividad", icon: ListChecks },
    { id: "profile", label: "Cuenta", icon: UserRound },
  ];
  return (
    <nav className="bottom-nav">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          className={
            tab === id || (tab === "wallet" && id === "profile") ? "nav-item active" : "nav-item"
          }
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
