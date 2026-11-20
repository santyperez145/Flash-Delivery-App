// Consola de backoffice (ticket ARC-001).
//
// Shell de navegación. Todas las secciones viven en módulos propios.
import {
  BadgeDollarSign,
  Bike,
  ClipboardCheck,
  CreditCard,
  Flag,
  Flame,
  KeyRound,
  LineChart,
  LocateFixed,
  LogIn,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useState } from "react";

import type { AdminDashboard, AppState } from "../types";

import { AdminApplications } from "./AdminApplications";
import { AdminDriverApplications } from "./AdminDriverApplications";
import { ShipmentReturnsPanel } from "./ShipmentReturnsPanel";
import { PaymentReconciliationPanel } from "./AdminFinancePanels";
import { AdminFinanceOverview } from "./AdminFinanceOverview";
import { AdminInvestorPanels } from "./AdminInvestorPanels";
import { RealtimeStatus } from "./AdminOverviewBoards";
import { AdminOverviewHome } from "./AdminOverviewHome";
import {
  AdminDispatchPanel,
  AdminDriversSupplyPanel,
  AdminMerchantsPanel,
} from "./AdminMarketplacePanels";
import {
  AdminInfraPanel,
  AdminPricingOpsPanel,
  AdminProductOpsPanel,
} from "./AdminReleaseControls";
import { ShipmentClaimsPanel, ShipmentConfigurationPanel } from "./AdminShipmentPanels";
import { ServiceQuickReplyPanel, SupportOperationsPanel } from "./AdminSupportPanels";
import { AdminSecurityPanel, AdminUserModeration } from "./AdminTrustPanels";
import { WorkQueueNavigation } from "./WorkQueueBoard";

type AdminSection =
  | "overview"
  | "dispatch"
  | "applications"
  | "merchants"
  | "drivers"
  | "shipments"
  | "claims"
  | "payments"
  | "pricing"
  | "messages"
  | "users"
  | "finance"
  | "investors"
  | "product"
  | "support"
  | "security"
  | "infra";

// Qué sección atiende cada cola del tablero (FE-05). Sólo las que tienen una
// pantalla donde se resuelven: una fila que lleva a una sección que no la
// atiende sería un atajo a ninguna parte.
const SECCION_DE_COLA: Partial<Record<string, AdminSection>> = {
  merchant_applications: "applications",
};

export function SuperAdminConsole({
  state,
  currentUserId,
  dashboard,
  busy,
  realtimeStatus,
  runAction,
  onSwitchPortal,
  onLogout,
  isSupport = false,
}: {
  state: AppState;
  currentUserId: string;
  dashboard: AdminDashboard | null;
  busy: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onSwitchPortal: () => void;
  onLogout: () => void;
  isSupport?: boolean;
}) {
  const [section, setSection] = useState<AdminSection>(isSupport ? "support" : "overview");
  // FE-06: Altas tiene dos colas, comercios y repartidores.
  const [altas, setAltas] = useState<"comercios" | "repartidores">("comercios");
  const activeOrders = state.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
  const cancellationCount =
    state.orders.filter((order) => order.status === "cancelled").length +
    state.rides.filter((ride) => ride.status === "cancelled").length;
  const marketplace = dashboard?.marketplace;
  // El volumen sale sólo del tablero, que lo lee del ledger. Antes se sumaba
  // acá cada pedido y viaje del estado cargado, cancelados incluidos: una cifra
  // distinta a la del ledger y más alta que lo realmente vendido. Sin tablero
  // no hay cifra (null), y cada panel muestra su estado vacío en lugar de $0.
  const grossVolume = marketplace?.grossVolume ?? null;
  const platformRevenue = marketplace?.estimatedPlatformRevenue ?? null;
  const nav = [
    ["overview", "Resumen", LineChart],
    ["dispatch", "Dispatch", LocateFixed],
    ["applications", "Altas", ClipboardCheck],
    ["merchants", "Comercios", Store],
    ["drivers", "Drivers", Bike],
    ["shipments", "Envíos", PackageCheck],
    ["claims", "Siniestros", ShieldCheck],
    ["payments", "Pagos", CreditCard],
    ["pricing", "Tarifas", SlidersHorizontal],
    ["messages", "Mensajes", MessageCircle],
    ["users", "Usuarios", UserRound],
    ["finance", "Finanzas", WalletCards],
    ["investors", "Inversion", BadgeDollarSign],
    ["product", "Producto", Flag],
    ["support", "Soporte", MessageCircle],
    ["security", "Seguridad", KeyRound],
    ["infra", "Infra", ShieldCheck],
  ] as const;
  // Soporte también ve Altas, sólo para leer: es a quien llama el comercio que
  // pregunta por su solicitud. Decidir sigue siendo de un administrador.
  const visibleNav = isSupport
    ? nav.filter(([id]) => id === "support" || id === "applications")
    : nav;
  const destinoDeCola = (cola: string) => {
    const destino = SECCION_DE_COLA[cola];
    return destino ? nav.find(([id]) => id === destino)?.[1] || null : null;
  };
  const abrirCola = (cola: string) => {
    const destino = SECCION_DE_COLA[cola];
    if (destino) setSection(destino);
  };

  return (
    <WorkQueueNavigation.Provider value={{ destino: destinoDeCola, abrir: abrirCola }}>
      <main className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <span>
              <Flame size={22} />
            </span>
            <div>
              <strong>{isSupport ? "Flash Support" : "Flash Command"}</strong>
              <small>{isSupport ? "Mesa de ayuda" : "Superadministrador"}</small>
            </div>
          </div>
          <nav className="admin-nav">
            {!isSupport && (
              <button type="button" onClick={onSwitchPortal}>
                <Store size={17} /> Portal de comercio
              </button>
            )}
            {visibleNav.map(([id, label, Icon]) => (
              <button
                className={section === id ? "active" : ""}
                key={id}
                onClick={() => setSection(id)}
                type="button"
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
            <button type="button" onClick={onLogout}>
              <LogIn size={17} /> Cerrar sesión
            </button>
          </nav>
          <div className="admin-note">
            <strong>Superficie correcta</strong>
            <span>
              {isSupport
                ? "Esta cuenta sólo puede atender tickets, SLA, asignaciones y colas autorizadas."
                : "En escritorio solo se muestra gestion de plataforma. Cliente, comercio y driver quedan como app mobile/PWA."}
            </span>
          </div>
        </aside>

        <section className="admin-main">
          <header className="admin-topbar">
            <div>
              <span>
                {isSupport ? "Soporte · PostgreSQL/PostGIS" : "Operaciones · PostgreSQL/PostGIS"}
              </span>
              <h1>
                {isSupport
                  ? "Atención de clientes y operación de tickets"
                  : "Control de marketplace, movilidad y delivery"}
              </h1>
            </div>
            <div className="admin-actions">
              <RealtimeStatus status={realtimeStatus} />
              <button type="button" onClick={() => window.location.reload()}>
                <RefreshCw size={16} /> Refrescar
              </button>
            </div>
          </header>

          {section === "overview" && (
            <AdminOverviewHome
              state={state}
              dashboard={dashboard}
              grossVolume={grossVolume}
              platformRevenue={platformRevenue}
              cancellationCount={cancellationCount}
              activeOrders={activeOrders}
              activeRides={activeRides}
              busy={busy}
              runAction={runAction}
            />
          )}

          {section === "dispatch" && (
            <AdminDispatchPanel
              state={state}
              orders={activeOrders}
              rides={activeRides}
              busy={busy}
              runAction={runAction}
            />
          )}

          {section === "applications" && (
            <div className="altas-socios" role="group" aria-label="Qué altas revisar">
              <button
                type="button"
                aria-pressed={altas === "comercios"}
                onClick={() => setAltas("comercios")}
              >
                Comercios
              </button>
              <button
                type="button"
                aria-pressed={altas === "repartidores"}
                onClick={() => setAltas("repartidores")}
              >
                Repartidores
              </button>
            </div>
          )}
          {section === "applications" && altas === "comercios" && (
            <AdminApplications
              canDecide={!isSupport}
              // La consola recarga su estado para que el comercio recién aprobado
              // aparezca en Comercios sin refrescar la página.
              onDecided={(mensaje) => runAction(async () => undefined, mensaje)}
            />
          )}
          {section === "applications" && altas === "repartidores" && (
            <AdminDriverApplications
              canDecide={!isSupport}
              // Igual que con los comercios: el conductor aprobado aparece en Repartidores
              // sin refrescar la página.
              onDecided={(mensaje) => runAction(async () => undefined, mensaje)}
            />
          )}

          {section === "merchants" && (
            <AdminMerchantsPanel
              restaurants={state.restaurants}
              busy={busy}
              runAction={runAction}
            />
          )}

          {section === "drivers" && (
            <AdminDriversSupplyPanel drivers={state.drivers} busy={busy} runAction={runAction} />
          )}

          {section === "finance" && (
            <AdminFinanceOverview
              state={state}
              dashboard={dashboard}
              cancellationCount={cancellationCount}
              currentUserId={currentUserId}
            />
          )}

          {section === "investors" && (
            <AdminInvestorPanels
              state={state}
              dashboard={dashboard}
              grossVolume={grossVolume}
              platformRevenue={platformRevenue}
            />
          )}

          {section === "product" && (
            <AdminProductOpsPanel zones={state.zones} runAction={runAction} />
          )}

          {section === "support" && (
            <SupportOperationsPanel
              tickets={state.supportTickets}
              currentUserId={currentUserId}
              busy={busy}
              runAction={runAction}
              isSupport={isSupport}
            />
          )}

          {section === "shipments" && (
            <ShipmentConfigurationPanel busy={busy} runAction={runAction} />
          )}

          {section === "claims" && (
            <div className="admin-grid">
              <ShipmentClaimsPanel />
              <ShipmentReturnsPanel runAction={runAction} busy={busy} />
            </div>
          )}
          {section === "payments" && <PaymentReconciliationPanel />}

          {section === "pricing" && (
            <AdminPricingOpsPanel
              state={state}
              currentUserId={currentUserId}
              busy={busy}
              runAction={runAction}
            />
          )}

          {section === "messages" && <ServiceQuickReplyPanel busy={busy} />}

          {section === "users" && (
            <AdminUserModeration users={state.users} busy={busy} runAction={runAction} />
          )}

          {section === "security" && <AdminSecurityPanel />}

          {section === "infra" && <AdminInfraPanel />}
        </section>
      </main>
    </WorkQueueNavigation.Provider>
  );
}
