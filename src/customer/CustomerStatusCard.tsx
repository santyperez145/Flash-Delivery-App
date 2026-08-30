import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { money } from "../format";

export function CustomerStatusCard({
  icon: Icon,
  title,
  subtitle,
  amount,
  status,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  disabled,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  amount: number;
  status: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  disabled: boolean;
  /** Controles propios del servicio, debajo del cuerpo y encima de las acciones.
   *  Hoy: reprogramar una reserva. */
  children?: ReactNode;
}) {
  return (
    <article className="status-card">
      <span className="status-icon">
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <small>
          {status} · {money.format(amount)}
        </small>
        {children}
      </div>
      {(actionLabel || secondaryActionLabel) && (
        <div className="status-card-actions">
          {secondaryActionLabel && (
            <button
              className="secondary"
              type="button"
              onClick={onSecondaryAction}
              disabled={disabled}
            >
              {secondaryActionLabel}
            </button>
          )}
          {actionLabel && (
            <button type="button" onClick={onAction} disabled={disabled}>
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
