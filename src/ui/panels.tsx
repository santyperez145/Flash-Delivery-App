// Primitivas de panel compartidas (ticket ARC-001, paso 9).
//
// El prefijo `Admin` es un nombre heredado y equivocado: `AdminKpi` se usa en 4
// lugares fuera del backoffice y `AdminSectionHeader` en 10. Se conservan los
// nombres para que la extracción no mezcle mover con renombrar, y queda anotado
// como deuda: renombrarlas es un cambio mecánico separado.
//
// Están acá y no en la consola porque un módulo compartido que importara de
// vuelta a la consola —o a `App.tsx`— cerraría un ciclo de imports.
import { PackageCheck, ReceiptText } from "lucide-react";

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
