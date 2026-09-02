// Consola de backoffice (ticket ARC-001).
//
// Orquestación de secciones. Finanzas, envíos, soporte, confianza, marketplace
// (dispatch/comercios/drivers) y tableros overview viven en módulos propios.
import {
  BadgeDollarSign,
  Bike,
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

import { money } from "../format";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import { PromotionControlsPanel, ZoneDemandPanel } from "./DemandControlsBoard";
import { ShipmentReturnsPanel } from "./ShipmentReturnsPanel";
import { WorkQueueBoard } from "./WorkQueueBoard";
import {
  FeatureFlagsPanel,
  ProductFunnelPanel,
  ZoneReadinessPanel,
} from "./ProductOperationsBoard";
import { PaymentReconciliationPanel, PricingGovernancePanel } from "./AdminFinancePanels";
import { AdminFinanceOverview } from "./AdminFinanceOverview";
import { AdminInvestorPanels } from "./AdminInvestorPanels";
import {
  AdminLiveGrid,
  InfraItem,
  InvestorPulse,
  MarketplaceHealth,
  RealtimeStatus,
  ZoneBoard,
} from "./AdminOverviewBoards";
import {
  AdminDispatchPanel,
  AdminDriversSupplyPanel,
  AdminMerchantsPanel,
} from "./AdminMarketplacePanels";
import { ShipmentClaimsPanel, ShipmentConfigurationPanel } from "./AdminShipmentPanels";
import {
  NotificationDeliveryPanel,
  ServiceQuickReplyPanel,
  SupportOperationsPanel,
} from "./AdminSupportPanels";
import { AdminSecurityPanel, AdminUserModeration } from "./AdminTrustPanels";

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
  const [section, setSection] = useState<
    | "overview"
    | "dispatch"
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
    | "infra"
  >(isSupport ? "support" : "overview");
  const activeOrders = state.orders.filter(
    (order) => !["delivered", "cancelled"].includes(order.status),
  );
  const activeRides = state.rides.filter(
    (ride) => !["completed", "cancelled"].includes(ride.status),
  );
  const grossVolume = [
    ...state.orders.map((order) => order.total),
    ...state.rides.map((ride) => ride.fare),
  ].reduce((sum, value) => sum + value, 0);
  const cancellationCount =
    state.orders.filter((order) => order.status === "cancelled").length +
    state.rides.filter((ride) => ride.status === "cancelled").length;
  const marketplace = dashboard?.marketplace;
  const investor = dashboard?.investor;
  const platformRevenue = marketplace?.estimatedPlatformRevenue ?? 0;
  const readinessScore = investor?.readinessScore ?? 0;
  const nav = [
    ["overview", "Resumen", LineChart],
    ["dispatch", "Dispatch", LocateFixed],
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
  const visibleNav = isSupport ? nav.filter(([id]) => id === "support") : nav;

  return (
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
          <>
            {/* Primero de todo en la vista general: es la única pantalla que
                responde «¿hay algo acumulándose?» sin entrar a ocho secciones, y
                debajo de los KPI se leería después de lo que ya está bien. */}
            <WorkQueueBoard />
            <div className="admin-kpis">
              <AdminKpi
                label="Pedidos activos"
                value={state.metrics.activeOrders}
                detail={`${state.metrics.avgOrderEta}m ETA`}
                tone="orange"
              />
              <AdminKpi
                label="Viajes activos"
                value={state.metrics.activeRides}
                detail={`${state.metrics.avgRideEta}m pickup`}
                tone="teal"
              />
              <AdminKpi
                label="Drivers online"
                value={state.metrics.onlineDrivers}
                detail={`${state.drivers.length} registrados`}
                tone="green"
              />
              <AdminKpi
                label="GMV registrado"
                value={money.format(marketplace?.grossVolume ?? grossVolume)}
                detail={`Revenue posteado ${money.format(platformRevenue)}`}
                tone="dark"
              />
            </div>
            <section className="admin-card">
              <AdminSectionHeader
                title="Investor pulse"
                action={`${readinessScore}/100 readiness`}
              />
              <InvestorPulse
                dashboard={dashboard}
                grossVolume={grossVolume}
                platformRevenue={platformRevenue}
              />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader
                  title="Salud del marketplace"
                  action={`${state.restaurants.length} comercios`}
                />
                <MarketplaceHealth
                  state={state}
                  dashboard={dashboard}
                  cancellationCount={cancellationCount}
                />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Zonas calientes" action="Live" />
                <ZoneBoard state={state} />
              </section>
            </div>
            <section className="admin-card">
              <AdminSectionHeader
                title="Actividad en vivo"
                action={`${activeOrders.length + activeRides.length} activos`}
              />
              <AdminLiveGrid
                state={state}
                orders={activeOrders}
                rides={activeRides}
                busy={busy}
                runAction={runAction}
              />
            </section>
          </>
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

        {section === "merchants" && (
          <AdminMerchantsPanel restaurants={state.restaurants} busy={busy} runAction={runAction} />
        )}

        {section === "drivers" && (
          <AdminDriversSupplyPanel drivers={state.drivers} busy={busy} runAction={runAction} />
        )}

        {section === "finance" && (
          <AdminFinanceOverview
            state={state}
            grossVolume={grossVolume}
            platformRevenue={platformRevenue}
            takeRatePercent={marketplace?.takeRatePercent ?? 0}
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
            readinessScore={readinessScore}
          />
        )}

        {/* Producto: embudo, flags y go/no-go de zona. Las cinco rutas que los
            alimentan estaban construidas y sin pantalla hasta el 28 de agosto. */}
        {section === "product" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Embudo de producto" action="Eventos propios" />
              <ProductFunnelPanel />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader title="Flags por audiencia" action="Rollout" />
                <FeatureFlagsPanel runAction={runAction} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Go/no-go de zona" action="Criterios" />
                <ZoneReadinessPanel
                  zones={state.zones.map((zona) => ({ id: zona.id, name: zona.name }))}
                  runAction={runAction}
                />
              </section>
            </div>
          </div>
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

        {/* Siniestros y devoluciones son la misma clase de excepción y viven
            juntos. La cola de devoluciones se listaba desde el móvil y no tenía
            forma de resolverse hasta el 28 de agosto. */}
        {section === "claims" && (
          <div className="admin-grid">
            <ShipmentClaimsPanel />
            <ShipmentReturnsPanel runAction={runAction} busy={busy} />
          </div>
        )}
        {section === "payments" && <PaymentReconciliationPanel />}

        {section === "pricing" && (
          <div className="admin-grid">
            <PricingGovernancePanel
              currentUserId={currentUserId}
              busy={busy}
              runAction={runAction}
            />
            {/* Promociones y multiplicadores: las dos palancas con las que se
                corrige una operación en curso. Estaban construidas y sin pantalla. */}
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader
                  title="Promociones"
                  action={`${state.promotions.filter((promo) => promo.active).length} activas`}
                />
                <PromotionControlsPanel
                  promotions={state.promotions}
                  runAction={runAction}
                  busy={busy}
                />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Multiplicadores por zona" action="Surge" />
                <ZoneDemandPanel zones={state.zones} runAction={runAction} busy={busy} />
              </section>
            </div>
          </div>
        )}

        {section === "messages" && <ServiceQuickReplyPanel busy={busy} />}

        {section === "users" && (
          <AdminUserModeration users={state.users} busy={busy} runAction={runAction} />
        )}

        {section === "security" && <AdminSecurityPanel />}

        {section === "infra" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Ruta de infraestructura" action="Escalable" />
              <div className="infra-list">
                <InfraItem
                  title="Apps nativas"
                  text="Migrar la experiencia mobile a Expo/React Native con EAS, manteniendo esta API como backend."
                />
                <InfraItem
                  title="API modular"
                  text="Separar auth, marketplace, dispatch, payments, notifications, support y admin en modulos o servicios."
                />
                <InfraItem
                  title="Datos"
                  text="PostgreSQL + PostGIS es el runtime primario; SQLite queda aislado como fallback de pruebas. Siguiente escala: réplicas, Redis administrado y object storage."
                />
                <InfraItem
                  title="Tiempo real"
                  text="WebSockets/SSE para tracking, ofertas a drivers, chats, eventos de cocina y consola admin."
                />
                <InfraItem
                  title="Operabilidad"
                  text="Contenedores, Kubernetes HPA, observabilidad, alertas, feature flags y auditoria de acciones."
                />
                <InfraItem
                  title="Seguridad"
                  text="RBAC real por rol, proteccion OWASP API Top 10, rate limits, secretos gestionados y trazabilidad."
                />
              </div>
            </section>
            <NotificationDeliveryPanel />
          </div>
        )}
      </section>
    </main>
  );
}
