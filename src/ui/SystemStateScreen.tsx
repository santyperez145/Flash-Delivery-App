import {
  ArrowRight,
  Flame,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";

import { roleLabel } from "../labels";
import type { User } from "../types";
import { AccountDeletion } from "./AccountDeletion";
import { TwoStepVerification } from "./TwoStepVerification";
import { LegalLinks } from "./LegalLinks";

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

export function DesktopAccessGate({
  user,
  onLogout,
  onComercios,
}: {
  user: User | null;
  onLogout: () => void;
  /** Abre «Sumá tu comercio» sin recargar; sin él, el enlace navega a /comercios. */
  onComercios?: () => void;
}) {
  // Un comercio llega acá sólo si su local no vino en el estado (recién aprobado o un
  // error al cargarlo): decirle «no tenés comercio» sería falso.
  const esComercio = Boolean(user?.roles.includes("merchant"));
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
          <h1>Este portal es para comercios y operaciones</h1>
          {/* FE-05: antes esto era un callejón sin salida («continúa en la app móvil»).
              Quien llega acá con un comercio ahora puede postularlo; el resto sigue en la
              app de Flash, donde están pedir, viajar y repartir. */}
          <p>
            {user?.name || "Tu cuenta"},{" "}
            {esComercio
              ? "no encontramos el comercio de esta cuenta. Si tu solicitud se aprobó hace un momento, recargá la página o revisá su estado."
              : "esta cuenta todavía no administra un comercio. Si tenés uno, sumalo a Flash desde acá. Para pedir, viajar o repartir, usá la app de Flash."}
          </p>
        </div>
        <div className="role-gate-actions">
          <a
            className="role-gate-partner"
            href="/comercios"
            onClick={(event) => {
              if (!onComercios || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              onComercios();
            }}
          >
            <span>
              <Store size={17} aria-hidden="true" />{" "}
              {esComercio ? "Ver el estado de mi solicitud" : "Sumá tu comercio"}
            </span>
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <span>
            {user?.roles.map((role) => roleLabel[role]).join(" · ") || "Sin rol operativo"}
          </span>
          <button type="button" onClick={onLogout}>
            <LogIn size={17} /> Cambiar de cuenta
          </button>
        </div>
        {/* El camino web para eliminar la cuenta, que Google Play exige además
            del de la app: un cliente en escritorio llega acá. */}
        {/* La seguridad de la cuenta también se maneja desde la web (SEG-08). */}
        <TwoStepVerification />
        <LegalLinks />
        <AccountDeletion />
      </section>
    </main>
  );
}
