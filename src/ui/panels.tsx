// Primitivas de panel compartidas (ticket ARC-001, paso 9).
//
// El prefijo `Admin` es un nombre heredado y equivocado: `AdminKpi` se usa en 4
// lugares fuera del backoffice y `AdminSectionHeader` en 10. Se conservan los
// nombres para que la extracción no mezcle mover con renombrar, y queda anotado
// como deuda: renombrarlas es un cambio mecánico separado.
//
// Están acá y no en la consola porque un módulo compartido que importara de
// vuelta a la consola —o a `App.tsx`— cerraría un ciclo de imports.
import { ArrowLeft, PackageCheck, ReceiptText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { money } from "../format";
import { orderStatusLabel } from "../labels";
import type { Driver, Order, Restaurant } from "../types";

export function AdminKpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: string;
}) {
  return (
    <article className={`admin-kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function AdminSectionHeader({ title, action }: { title: string; action: string }) {
  return (
    <div className="admin-section-header">
      <h2>{title}</h2>
      <span>{action}</span>
    </div>
  );
}

/**
 * Una orden en una consola operativa.
 *
 * Vive acá y no en la superficie de comercio porque la usan tres audiencias:
 * el comercio en su consola de escritorio, el conductor en su cola y
 * operaciones en el tablero. Se verificó contando usos, no por el nombre.
 */
export function OrderOpsCard({
  order,
  restaurant,
  driver,
  onAdvance,
  canAdvance,
  onDetails,
  busy,
}: {
  order: Order;
  restaurant?: Restaurant;
  driver?: Driver;
  onAdvance: () => void;
  canAdvance?: boolean;
  onDetails?: () => void;
  busy: boolean;
}) {
  const showAdvance =
    canAdvance ?? !["ready_for_pickup", "delivered", "cancelled"].includes(order.status);
  return (
    <article className="work-card">
      <div className="work-card-top">
        <span>{order.id}</span>
        <strong>{orderStatusLabel[order.status]}</strong>
      </div>
      <h3>{restaurant?.name || "Restaurante"}</h3>
      <p>{order.items.map((item) => `${item.quantity} ${item.name}`).join(", ")}</p>
      <div className="work-meta">
        <span>{money.format(order.total)}</span>
        <span>{driver?.name || "Sin repartidor"}</span>
      </div>
      {(onDetails || showAdvance) && (
        <div className="work-card-actions">
          {onDetails && (
            <button className="secondary" type="button" onClick={onDetails}>
              <ReceiptText size={15} /> Ver comanda
            </button>
          )}
          {showAdvance && (
            <button type="button" onClick={onAdvance} disabled={busy}>
              <PackageCheck size={15} /> Avanzar
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// --- Primitivas de navegación --------------------------------------------
//
// Las tres las usan el cliente y las consolas de operaciones: `SectionTitle` en
// 11 lugares, `TopBar` en 4, y `IconButton` tanto suelto como dentro de
// `TopBar`. Se clasificaron contando usos por zona del archivo, que es como se
// decidió cada corte de ARC-001 en el frente.

export function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action && <span className="section-action">{action}</span>}
    </div>
  );
}

export function TopBar({
  title,
  onBack,
  actionIcon,
}: {
  title: string;
  onBack?: () => void;
  actionIcon?: LucideIcon;
}) {
  const ActionIcon = actionIcon;
  return (
    <header className="topbar">
      {onBack ? (
        <IconButton icon={ArrowLeft} label="Volver" onClick={onBack} />
      ) : (
        <span className="topbar-spacer" />
      )}
      <h1>{title}</h1>
      {ActionIcon ? (
        <IconButton icon={ActionIcon} label={title} />
      ) : (
        <span className="topbar-spacer" />
      )}
    </header>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onClick,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={18} />
      {!!badge && <span className="mini-badge">{badge}</span>}
    </button>
  );
}
