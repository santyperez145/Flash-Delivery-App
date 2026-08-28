import { ArrowRight, Flame, LogIn, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";

import type { User } from "../types";

type SystemStateScreenProps = {
  tone: "loading" | "error";
  eyebrow: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SystemStateScreen({
  tone,
  eyebrow,
  title,
  message,
  actionLabel,
  onAction,
}: SystemStateScreenProps) {
  const Icon = tone === "loading" ? RefreshCw : TriangleAlert;
  return (
    <main className={`system-state-shell system-state-${tone}`} aria-busy={tone === "loading"}>
      <section className="system-state-card" role={tone === "error" ? "alert" : "status"}>
        <div className="system-state-brand" aria-hidden="true">
          <span>
            <Flame size={22} />
          </span>
          <strong>Flash</strong>
        </div>
        <span className="system-state-icon" aria-hidden="true">
          <Icon className={tone === "loading" ? "spin" : undefined} size={24} />
        </span>
        <div>
          <small>{eyebrow}</small>
          <h1>{title}</h1>
          <p>{message}</p>
        </div>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction}>
            <span>{actionLabel}</span>
            <ArrowRight size={18} />
          </button>
        )}
      </section>
    </main>
  );
}

export function DesktopAccessGate({ user, onLogout }: { user: User | null; onLogout: () => void }) {
  return (
    <main className="role-gate-shell">
      <section className="role-gate-card">
        <div className="system-state-brand" aria-hidden="true">
          <span>
            <Flame size={22} />
          </span>
          <strong>Flash</strong>
        </div>
        <span className="role-gate-icon" aria-hidden="true">
          <ShieldCheck size={25} />
        </span>
        <div>
          <small>Acceso por audiencia</small>
          <h1>Esta cuenta continúa en la app móvil</h1>
          <p>
            {user?.name || "Tu cuenta"}, este portal web está reservado para operaciones y negocios.
            Abrí Flash mobile para usar los servicios habilitados para tu cuenta.
          </p>
        </div>
        <div className="role-gate-actions">
          <span>{user?.roles.join(" · ") || "Sin rol operativo"}</span>
          <button type="button" onClick={onLogout}>
            <LogIn size={17} /> Cambiar de cuenta
          </button>
        </div>
      </section>
    </main>
  );
}
