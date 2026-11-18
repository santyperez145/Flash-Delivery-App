import type { ReactNode } from "react";
import { Bell, Flame, Grid2x2, Home, ListChecks, MapPin, Search } from "lucide-react";
import { ShoppingBag, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { IconButton } from "../ui/panels";
import type { CustomerTab } from "../types";
import type { Ambito } from "./CustomerScope";

// Navegación del cliente web. Pedidos y Viajes (FE-01) tienen cada uno sus secciones,
// como Uber Eats (Inicio · Explorar · Pedidos · Cuenta) y Uber (Inicio · Servicios ·
// Actividad · Cuenta). La Wallet vive dentro de Cuenta y marca Cuenta en la barra.

export function CustomerHeader({
  address,
  selector,
  unread,
  cartCount,
  onNotifications,
  onCart,
}: {
  /** Sólo en Pedidos: a dónde llega. Un viaje elige su origen en el mapa. */
  address?: string;
  /** El selector Pedidos | Viajes. */
  selector: ReactNode;
  unread: number;
  cartCount: number;
  onNotifications: () => void;
  /** Sin carrito en Viajes. */
  onCart?: () => void;
}) {
  return (
    <header className="home-header">
      {/* La marca sólo se ve en escritorio, donde el encabezado es la barra del sitio. */}
      <span className="customer-brand" aria-hidden="true">
        <Flame size={18} /> Flash
      </span>
      {selector}
      {address !== undefined && (
        <div className="customer-address">
          <span className="muted-label">Enviar a</span>
          <span className="location-button">
            <MapPin size={15} /> {address || "Definir dirección"}
          </span>
        </div>
      )}
      <div className="header-actions">
        <IconButton icon={Bell} label="Notificaciones" badge={unread} onClick={onNotifications} />
        {onCart && (
          <IconButton icon={ShoppingBag} label="Carrito" badge={cartCount} onClick={onCart} />
        )}
      </div>
    </header>
  );
}

export function CustomerBottomNav({
  ambito,
  tab,
  onTabChange,
}: {
  ambito: Ambito;
  tab: CustomerTab;
  onTabChange: (tab: CustomerTab) => void;
}) {
  const pedidos = ambito === "pedidos";
  const tabs: Array<{ id: CustomerTab; label: string; icon: LucideIcon }> = [
    { id: "home", label: "Inicio", icon: Home },
    { id: "services", label: pedidos ? "Explorar" : "Servicios", icon: pedidos ? Search : Grid2x2 },
    { id: "activity", label: pedidos ? "Pedidos" : "Actividad", icon: ListChecks },
    { id: "profile", label: "Cuenta", icon: UserRound },
  ];
  return (
    <nav className="bottom-nav" data-ambito={ambito}>
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
