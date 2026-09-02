// Consola de backoffice (ticket ARC-001).
//
// Primer corte de `src/App.tsx`. Finanzas, envíos y soporte viven en módulos
// propios (`AdminFinancePanels`, `AdminShipmentPanels`, `AdminSupportPanels`).
import {
  BadgeDollarSign,
  Bike,
  Car,
  Check,
  Copy,
  CreditCard,
  Download,
  Flag,
  Flame,
  KeyRound,
  LineChart,
  LocateFixed,
  LogIn,
  MessageCircle,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  User,
  AdminDashboard,
  AppState,
  Order,
  Ride,
  TransactionRiskAssessment,
} from "../types";

import { api } from "../api";
import { initials, money } from "../format";
import { orderStatusLabel, rideStatusLabel } from "../labels";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import { PromotionControlsPanel, ZoneDemandPanel } from "./DemandControlsBoard";
import { abrirContenidoProtegido } from "./open-protected-content";
import { ShipmentReturnsPanel } from "./ShipmentReturnsPanel";
import { WorkQueueBoard } from "./WorkQueueBoard";
import { DispatchReleasePanel, MerchantSuspensionPanel } from "./OperationsInterventionPanel";
import {
  FeatureFlagsPanel,
  ProductFunnelPanel,
  ZoneReadinessPanel,
} from "./ProductOperationsBoard";
import {
  PaymentReconciliationPanel,
  PayoutReviewPanel,
  PricingGovernancePanel,
  TipAdjustmentPanel,
} from "./AdminFinancePanels";
import { ShipmentClaimsPanel, ShipmentConfigurationPanel } from "./AdminShipmentPanels";
import {
  NotificationDeliveryPanel,
  ServiceQuickReplyPanel,
  SupportOperationsPanel,
} from "./AdminSupportPanels";

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
          <>
            <section className="admin-card">
              <AdminSectionHeader title="Dispatch y asignaciones" action="Food + Taxi" />
              <AdminLiveGrid
                state={state}
                orders={activeOrders}
                rides={activeRides}
                busy={busy}
                runAction={runAction}
              />
            </section>
            {/* La intervención va junto al tablero de dispatch y no en una
                sección propia: se usa mirando los pedidos que están trabados,
                no buscándola. */}
            <section className="admin-card">
              <AdminSectionHeader title="Soltar un servicio trabado" action="Vuelve al despacho" />
              <DispatchReleasePanel orders={activeOrders} busy={busy} runAction={runAction} />
            </section>
          </>
        )}

        {section === "merchants" && (
          <>
            <section className="admin-card">
              <AdminSectionHeader
                title="Suspender ingreso de pedidos"
                action="No cancela lo que ya está en curso"
              />
              <MerchantSuspensionPanel
                restaurants={state.restaurants}
                busy={busy}
                runAction={runAction}
              />
            </section>
            <section className="admin-card">
              <AdminSectionHeader title="Comercios" action="Control operativo" />
              <div className="admin-table">
                {state.restaurants.map((restaurant) => (
                  <article className="admin-row" key={restaurant.id}>
                    <img src={restaurant.image} alt={restaurant.name} />
                    <div>
                      <strong>{restaurant.name}</strong>
                      <span>
                        {restaurant.cuisine} · {restaurant.address}
                      </span>
                    </div>
                    <b>{restaurant.open ? "Abierto" : "Pausado"}</b>
                    <small>
                      {restaurant.etaMin}m · {restaurant.menu.length} items
                    </small>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        runAction(
                          () =>
                            api.updateRestaurant(restaurant.id, {
                              open: !restaurant.open,
                            }),
                          restaurant.open ? "Comercio pausado" : "Comercio abierto",
                        )
                      }
                    >
                      {restaurant.open ? "Pausar" : "Abrir"}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}

        {section === "drivers" && (
          <section className="admin-card">
            <AdminSectionHeader title="Conductores y repartidores" action="Supply" />
            <div className="admin-table">
              {state.drivers.map((driver) => (
                <article className="admin-row" key={driver.id}>
                  <div className="avatar">{initials(driver.name)}</div>
                  <div>
                    <strong>{driver.name}</strong>
                    <span>
                      {driver.vehicle} · {driver.plate} · {driver.location.label}
                    </span>
                  </div>
                  <b>{driver.online ? "Online" : "Offline"}</b>
                  <small>
                    {driver.activeService} · {driver.rating}
                  </small>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateDriver(driver.id, {
                            online: !driver.online,
                          }),
                        "Disponibilidad actualizada",
                      )
                    }
                  >
                    {driver.online ? "Pausar" : "Activar"}
                  </button>
                  <DriverCompliancePanel driverId={driver.id} busy={busy} runAction={runAction} />
                </article>
              ))}
            </div>
          </section>
        )}

        {section === "finance" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Finanzas y conciliacion" action="Ledger PostgreSQL" />
              <div className="admin-kpis finance">
                <AdminKpi
                  label="GMV total"
                  value={money.format(grossVolume)}
                  detail="Pedidos + viajes"
                  tone="orange"
                />
                <AdminKpi
                  label="Ingreso plataforma"
                  value={money.format(platformRevenue)}
                  detail={`${marketplace?.takeRatePercent ?? 0}% registrado`}
                  tone="green"
                />
                <AdminKpi
                  label="Wallet clientes"
                  value={money.format(state.users.reduce((sum, user) => sum + user.wallet, 0))}
                  detail="Saldo total"
                  tone="teal"
                />
                <AdminKpi
                  label="Cancelaciones"
                  value={cancellationCount}
                  detail="Pedidos + viajes"
                  tone="dark"
                />
              </div>
              <div className="admin-table">
                {[...state.orders.slice(0, 4), ...state.rides.slice(0, 4)].map((entry) => (
                  <article className="admin-row compact" key={entry.id}>
                    <ReceiptText size={18} />
                    <div>
                      <strong>{entry.id}</strong>
                      <span>{"restaurantId" in entry ? "Pedido de comida" : "Viaje/taxi"}</span>
                    </div>
                    <b>{money.format("total" in entry ? entry.total : entry.fare)}</b>
                    <small>{entry.paymentMethod}</small>
                  </article>
                ))}
              </div>
            </section>
            <PayoutReviewPanel />
            <TipAdjustmentPanel tips={state.tips || []} currentUserId={currentUserId} />
          </div>
        )}

        {section === "investors" && (
          <div className="admin-grid">
            <section className="admin-card">
              <AdminSectionHeader title="Ronda seed readiness" action={`${readinessScore}/100`} />
              <InvestorPulse
                dashboard={dashboard}
                grossVolume={grossVolume}
                platformRevenue={platformRevenue}
              />
            </section>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader title="Unit economics" action="Modelo financiero" />
                <UnitEconomicsBoard dashboard={dashboard} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader title="Milestones para levantar capital" action="18 meses" />
                <MilestoneBoard dashboard={dashboard} />
              </section>
            </div>
            <div className="admin-grid two">
              <section className="admin-card">
                <AdminSectionHeader title="Funnel de crecimiento" action="Seed metrics" />
                <GrowthFunnel state={state} dashboard={dashboard} />
              </section>
              <section className="admin-card">
                <AdminSectionHeader
                  title="Riesgos y mitigacion"
                  action={`${dashboard?.riskSignals.length ?? 0} senales`}
                />
                <RiskSignalBoard dashboard={dashboard} />
              </section>
            </div>
          </div>
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

function DriverCompliancePanel({
  driverId,
  busy,
  runAction,
}: {
  driverId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [compliance, setCompliance] = useState<import("../types").DriverCompliance | null>(null);
  const [reason, setReason] = useState("");
  const [vehicles, setVehicles] = useState<import("../types").DriverVehicle[]>([]);
  const load = useCallback(
    () =>
      Promise.all([api.getDriverCompliance(driverId), api.getDriverVehicles(driverId, true)])
        .then(([result, registry]) => {
          setCompliance(result.compliance);
          setVehicles(registry.vehicles);
        })
        .catch(() => {
          setCompliance(null);
          setVehicles([]);
        }),
    [driverId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!compliance)
    return (
      <div className="driver-compliance-inline">
        <small>Legajo no disponible</small>
      </div>
    );
  const pending = compliance.documents.filter((document) => document.status === "pending");
  return (
    <div className="driver-compliance-inline">
      <div>
        <strong>Legajo {compliance.status.replaceAll("_", " ")}</strong>
        <small>
          {pending.length} pendientes ·{" "}
          {compliance.documents.filter((document) => document.status === "approved").length}/
          {compliance.requiredTypes.length} aprobados
        </small>
      </div>
      {pending.map((document) => (
        <div className="driver-document-review" key={document.id}>
          <span>
            {document.type.replaceAll("_", " ")} · {(document.sizeBytes / 1024).toFixed(0)} KB
          </span>
          {/* Hasta el 28 de agosto se aprobaba o rechazaba un documento sin poder
              mirarlo: la ruta de contenido existía y ninguna pantalla la llamaba. */}
          <button
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const contenido = await api.getDriverDocumentContent(document.id);
                abrirContenidoProtegido(contenido.contentBase64, contenido.document.mimeType);
                return contenido;
              }, "Documento abierto")
            }
          >
            Ver
          </button>
          <button
            disabled={busy}
            onClick={() =>
              runAction(async () => {
                const result = await api.reviewDriverDocument(document.id, "approved");
                await load();
                return result;
              }, "Documento aprobado")
            }
          >
            Aprobar
          </button>
          <button
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              runAction(async () => {
                const result = await api.reviewDriverDocument(
                  document.id,
                  "rejected",
                  reason.trim(),
                );
                setReason("");
                await load();
                return result;
              }, "Documento rechazado")
            }
          >
            Rechazar
          </button>
        </div>
      ))}
      {vehicles
        .filter((vehicle) => vehicle.status === "pending" && !vehicle.retiredAt)
        .map((vehicle) => (
          <div className="driver-document-review" key={vehicle.id}>
            <span>
              {vehicle.kind} · {vehicle.model} · {vehicle.plate} ·{" "}
              {vehicle.serviceModes.join(" + ")}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                runAction(async () => {
                  const result = await api.reviewDriverVehicle(vehicle.id, "approved");
                  await load();
                  return result;
                }, "Vehículo aprobado")
              }
            >
              Aprobar vehículo
            </button>
            <button
              disabled={busy || reason.trim().length < 5}
              onClick={() =>
                runAction(async () => {
                  const result = await api.reviewDriverVehicle(
                    vehicle.id,
                    "rejected",
                    reason.trim(),
                  );
                  setReason("");
                  await load();
                  return result;
                }, "Vehículo rechazado")
              }
            >
              Rechazar
            </button>
          </div>
        ))}
      {(pending.length > 0 ||
        vehicles.some((vehicle) => vehicle.status === "pending" && !vehicle.retiredAt)) && (
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo verificable para rechazo"
        />
      )}
    </div>
  );
}

function AdminUserModeration({
  users,
  busy,
  runAction,
}: {
  users: User[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Usuarios y confianza"
        action={`${users.filter((user) => user.status === "suspended").length} suspendidos`}
      />
      <p>
        Suspender revoca sesiones, desconecta conductores y retira sus ofertas pendientes. Cada
        decisión queda auditada.
      </p>
      <div className="admin-table user-moderation-table">
        {users.map((user) => {
          const suspended = user.status === "suspended",
            reason = reasons[user.id] || "";
          return (
            <article className="admin-row user-moderation-row" key={user.id}>
              <UserRound size={19} />
              <div>
                <strong>{user.name}</strong>
                <span>
                  {user.email} · {user.roles.join(", ")}
                </span>
              </div>
              <b className={suspended ? "status-suspended" : "status-active"}>
                {suspended ? "Suspendido" : "Activo"}
              </b>
              <input
                aria-label={`Motivo para ${user.name}`}
                value={reason}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [user.id]: event.target.value,
                  }))
                }
                placeholder={suspended ? "Motivo de reactivación" : "Motivo de suspensión"}
              />
              <button
                type="button"
                disabled={busy || reason.trim().length < 5}
                onClick={() =>
                  runAction(
                    () =>
                      api.updateUserStatus(
                        user.id,
                        suspended ? "active" : "suspended",
                        reason.trim(),
                      ),
                    suspended ? "Cuenta reactivada" : "Cuenta suspendida",
                  )
                }
              >
                {suspended ? "Reactivar" : "Suspender"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type AdminMfaStatus = {
  enabled: boolean;
  method: string;
  confirmedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesRemaining: number;
};
type AdminMfaEnrollment = {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
};

function AdminSecurityPanel() {
  const [status, setStatus] = useState<AdminMfaStatus | null>(null),
    [enrollment, setEnrollment] = useState<AdminMfaEnrollment | null>(null),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .getMfaStatus()
      .then((result) => setStatus(result.mfa))
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : "No se pudo consultar MFA"),
      );
  }, []);
  useEffect(() => {
    let active = true;
    if (!enrollment) {
      setQr("");
      return;
    }
    import("qrcode")
      .then((module) =>
        module.default.toDataURL(enrollment.otpauthUri, {
          width: 260,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#151b22", light: "#ffffff" },
        }),
      )
      .then((value) => {
        if (active) setQr(value);
      })
      .catch(() => setError("No se pudo generar el QR"));
    return () => {
      active = false;
    };
  }, [enrollment]);
  const begin = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.enrollMfa();
      setEnrollment(result.enrollment);
      setMessage("Escaneá el QR y guardá los códigos antes de confirmar.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar MFA");
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.confirmMfa(code);
      setStatus(result.mfa);
      setCode("");
      setEnrollment(null);
      setMessage(
        "MFA quedó activo. Las próximas sesiones administrativas exigirán el segundo factor.",
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Código inválido");
    } finally {
      setBusy(false);
    }
  };
  const recoveryText = enrollment
    ? `Flash Delivery · Códigos de recuperación MFA\nGenerados: ${new Date().toISOString()}\n\n${enrollment.recoveryCodes.join("\n")}\n\nCada código sirve una sola vez. Guardar fuera del dispositivo.`
    : "";
  const copyRecovery = async () => {
    if (!recoveryText) return;
    await navigator.clipboard.writeText(recoveryText);
    setMessage("Códigos copiados. Guardalos en un gestor seguro.");
  };
  const downloadRecovery = () => {
    if (!recoveryText) return;
    const url = URL.createObjectURL(new Blob([recoveryText], { type: "text/plain;charset=utf-8" })),
      link = document.createElement("a");
    link.href = url;
    link.download = "flash-mfa-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
    setMessage("Archivo descargado. Movelo a un almacenamiento seguro.");
  };
  return (
    <section className="admin-card admin-security-card">
      <AdminSectionHeader
        title="Seguridad de superadministración"
        action={status?.enabled ? "MFA activo" : "Acción requerida"}
      />
      {!status && !error && (
        <div className="security-loading">
          <RefreshCw size={18} /> Consultando postura de seguridad…
        </div>
      )}
      {status && (
        <div className="security-status-grid">
          <article className={`security-posture ${status.enabled ? "enabled" : "warning"}`}>
            <span>
              <ShieldCheck size={25} />
            </span>
            <div>
              <small>Segundo factor</small>
              <strong>
                {status.enabled ? "Protección TOTP activa" : "MFA todavía no configurado"}
              </strong>
              <p>
                {status.enabled
                  ? `Confirmado ${status.confirmedAt ? new Date(status.confirmedAt).toLocaleString("es-AR") : ""}. Quedan ${status.recoveryCodesRemaining} códigos de recuperación.`
                  : "En producción, las operaciones administrativas permanecen bloqueadas hasta completar este enrolamiento."}
              </p>
            </div>
          </article>
          <article className="security-policy">
            <KeyRound size={22} />
            <div>
              <strong>Política de acceso</strong>
              <span>
                Contraseña + TOTP · desafío 5 min · bloqueo tras 5 fallos · recuperación de un solo
                uso
              </span>
            </div>
          </article>
        </div>
      )}
      {status && !status.enabled && !enrollment && (
        <div className="security-enroll-start">
          <div>
            <strong>Activar una aplicación autenticadora</strong>
            <p>
              Compatible con 1Password, Google Authenticator, Microsoft Authenticator, Authy y
              cualquier cliente TOTP estándar.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={begin} disabled={busy}>
            <KeyRound size={17} />
            {busy ? "Preparando…" : "Configurar MFA"}
          </button>
        </div>
      )}
      {enrollment && (
        <div className="security-enrollment">
          <div className="security-qr">
            <span>Paso 1</span>
            <strong>Escaneá el QR</strong>
            {qr ? (
              <img src={qr} alt="Código QR para configurar MFA" />
            ) : (
              <div className="qr-placeholder">Generando QR…</div>
            )}
            <details>
              <summary>Ingresar clave manualmente</summary>
              <code>{enrollment.secret}</code>
            </details>
          </div>
          <div className="security-recovery">
            <span>Paso 2</span>
            <strong>Guardá los códigos de recuperación</strong>
            <p>Se muestran una sola vez y cada uno se invalida después de usarlo.</p>
            <div className="recovery-code-grid">
              {enrollment.recoveryCodes.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </div>
            <div className="security-inline-actions">
              <button type="button" onClick={() => void copyRecovery()}>
                <Copy size={16} /> Copiar
              </button>
              <button type="button" onClick={downloadRecovery}>
                <Download size={16} /> Descargar
              </button>
            </div>
          </div>
          <form
            className="security-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <div>
              <span>Paso 3</span>
              <strong>Confirmá un código de 6 dígitos</strong>
              <p>
                La protección no se activa hasta verificar que el autenticador quedó configurado.
              </p>
            </div>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              pattern="[0-9]{6}"
              required
            />
            <button className="primary-button" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Verificando…" : "Activar MFA"}
            </button>
          </form>
        </div>
      )}
      {message && (
        <p className="security-message">
          <Check size={17} />
          {message}
        </p>
      )}
      {error && (
        <p className="security-error">
          <X size={17} />
          {error}
        </p>
      )}
    </section>
  );
}

// --- Tableros del panel administrativo ----------------------------------------
//
// Los diez viven acá porque **ninguno se usa fuera del backoffice**: se verificó
// contando sus usos en `App.tsx` una vez sacada la consola. `AdminKpi` y
// `AdminSectionHeader`, que comparten el prefijo, sí se usan afuera y por eso
// quedaron en `src/ui/panels.tsx`. El prefijo no decidió nada; el uso sí.
function RealtimeStatus({
  status,
}: {
  status: "connecting" | "live" | "reconnecting" | "offline";
}) {
  const labels = {
    connecting: "Conectando live",
    live: "Realtime activo",
    reconnecting: "Reconectando",
    offline: "Realtime offline",
  } as const;
  return (
    <span className={`realtime-status ${status}`} title="Canal de actualizaciones de la plataforma">
      <span />
      {labels[status]}
    </span>
  );
}

function MarketplaceHealth({
  state,
  dashboard,
  cancellationCount,
}: {
  state: AppState;
  dashboard: AdminDashboard | null;
  cancellationCount: number;
}) {
  const rows = [
    [
      "Fill rate delivery",
      dashboard
        ? `${dashboard.marketplace.fillRateDelivery}%`
        : `${state.orders.filter((order) => order.courierId).length}/${state.orders.length}`,
      "Asignacion",
    ],
    [
      "Fill rate taxi",
      dashboard
        ? `${dashboard.marketplace.fillRateRide}%`
        : `${state.rides.filter((ride) => ride.driverId).length}/${state.rides.length}`,
      "Conductores",
    ],
    ["Locales abiertos", `${state.metrics.openRestaurants}/${state.restaurants.length}`, "Supply"],
    ["Cancelaciones", String(cancellationCount), "Riesgo"],
  ];
  return (
    <div className="health-list">
      {rows.map(([label, value, detail]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{detail}</small>
        </div>
      ))}
    </div>
  );
}

function InvestorPulse({
  dashboard,
  grossVolume,
  platformRevenue,
}: {
  dashboard: AdminDashboard | null;
  grossVolume: number;
  platformRevenue: number;
}) {
  const investor = dashboard?.investor;
  const score = investor?.readinessScore ?? 0;
  const margin = investor?.contributionMarginPercent ?? null;
  const runway = investor?.runwayMonths ?? null;
  return (
    <div className="investor-pulse">
      <div className="readiness-meter" style={{ "--score": `${score}%` } as CSSProperties}>
        <strong>{score}</strong>
        <span>readiness</span>
      </div>
      <div className="investor-summary">
        <h3>Historia para inversores</h3>
        <p>
          Marketplace multi-servicio con demanda de comida y movilidad, supply flexible y backoffice
          operativo. El foco de la ronda es convertir el MVP local en beta con realtime, pagos y app
          nativa.
        </p>
        <div className="investor-stats">
          <span>GMV {money.format(grossVolume)}</span>
          <span>Revenue {money.format(platformRevenue)}</span>
          <span>Runway {runway === null || runway === 0 ? "sin configurar" : `${runway}m`}</span>
          <span>Margen {margin === null ? "sin configurar" : `${margin}%`}</span>
        </div>
      </div>
    </div>
  );
}

function UnitEconomicsBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  const rows = dashboard?.investor.unitEconomics || [
    { label: "AOV comida", value: "$0", detail: "Ticket promedio" },
    { label: "Fare taxi", value: "$0", detail: "Tarifa promedio" },
    { label: "Take rate", value: "0%", detail: "Sin revenue posteado" },
  ];
  return (
    <div className="unit-grid">
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </div>
      ))}
    </div>
  );
}

function MilestoneBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  const milestones = dashboard?.investor.milestones || [];
  return (
    <div className="milestone-list">
      {milestones.map((milestone) => (
        <article className={milestone.status} key={milestone.label}>
          <span />
          <div>
            <strong>{milestone.label}</strong>
            <small>{milestone.value}</small>
          </div>
          <b>{milestone.status.replace("_", " ")}</b>
        </article>
      ))}
    </div>
  );
}

function GrowthFunnel({ state, dashboard }: { state: AppState; dashboard: AdminDashboard | null }) {
  const activatedUsers = state.users.filter((user) => user.roles.includes("customer")).length;
  const completedJobs =
    state.orders.filter((order) => order.status === "delivered").length +
    state.rides.filter((ride) => ride.status === "completed").length;
  const funnel = [
    {
      label: "Usuarios",
      value: state.users.length,
      detail: "Cuentas registradas",
    },
    { label: "Activados", value: activatedUsers, detail: "Cliente con wallet" },
    {
      label: "Jobs",
      value: state.orders.length + state.rides.length,
      detail: "Pedidos + viajes",
    },
    {
      label: "Cumplidos",
      value: completedJobs,
      detail: "Conversion operativa",
    },
    {
      label: "Fill delivery",
      value: `${dashboard?.marketplace.fillRateDelivery ?? 0}%`,
      detail: "Asignacion",
    },
    {
      label: "Fill taxi",
      value: `${dashboard?.marketplace.fillRateRide ?? 0}%`,
      detail: "Asignacion",
    },
  ];
  return (
    <div className="funnel-list">
      {funnel.map((row, index) => (
        <article key={row.label}>
          <div style={{ width: `${100 - index * 9}%` }} />
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <small>{row.detail}</small>
        </article>
      ))}
    </div>
  );
}

function RiskSignalBoard({ dashboard }: { dashboard: AdminDashboard | null }) {
  const risks = dashboard?.riskSignals || [];
  return (
    <div className="risk-list">
      {risks.map((risk) => (
        <article className={risk.level} key={risk.id}>
          <strong>{risk.label}</strong>
          <span>{risk.value}</span>
          <small>
            {risk.level === "low"
              ? "Controlado"
              : risk.level === "medium"
                ? "Monitorear"
                : "Accion inmediata"}
          </small>
        </article>
      ))}
    </div>
  );
}

function ZoneBoard({ state }: { state: AppState }) {
  return (
    <div className="zone-board">
      {state.zones?.map((zone) => (
        <article className={zone.demandLevel === "high" ? "hot" : ""} key={zone.id}>
          <strong>{zone.name}</strong>
          <span>{zone.demandLevel}</span>
          <small>
            {zone.activeOrders} pedidos · {zone.activeRides} viajes
          </small>
        </article>
      ))}
    </div>
  );
}

function AdminLiveGrid({
  state,
  orders,
  rides,
  busy,
  runAction,
}: {
  state: AppState;
  orders: Order[];
  rides: Ride[];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  return (
    <div className="admin-live-grid">
      <div className="admin-table">
        {orders.map((order) => {
          const restaurant = state.restaurants.find((entry) => entry.id === order.restaurantId);
          const driver = state.drivers.find((entry) => entry.id === order.courierId);
          return (
            <article className="admin-row compact" key={order.id}>
              <ShoppingBag size={18} />
              <div>
                <strong>{restaurant?.name || order.id}</strong>
                <span>
                  {orderStatusLabel[order.status]} · {order.deliveryAddress}
                </span>
              </div>
              <b>{money.format(order.total)}</b>
              <small>{driver?.name || "Sin repartidor"}</small>
              <button
                type="button"
                disabled={
                  busy || ["ready_for_pickup", "delivered", "cancelled"].includes(order.status)
                }
                onClick={() => runAction(() => api.advanceOrder(order.id), "Pedido avanzado")}
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
      <div className="admin-table">
        {rides.map((ride) => {
          const driver = state.drivers.find((entry) => entry.id === ride.driverId);
          return (
            <article className="admin-row compact" key={ride.id}>
              <Car size={18} />
              <div>
                <strong>{ride.pickup}</strong>
                <span>
                  {rideStatusLabel[ride.status]} → {ride.destination}
                </span>
              </div>
              <b>{money.format(ride.fare)}</b>
              <small>{driver?.name || "Sin conductor"}</small>
              <button
                type="button"
                disabled={busy || ["requested", "completed", "cancelled"].includes(ride.status)}
                onClick={() => runAction(() => api.advanceRide(ride.id), "Viaje avanzado")}
              >
                Avanzar
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function InfraItem({ title, text }: { title: string; text: string }) {
  return (
    <article>
      <ShieldCheck size={18} />
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </article>
  );
}
