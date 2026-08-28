// Consola de backoffice (ticket ARC-001, paso 9).
//
// Primer corte de `src/App.tsx`, que tenía 10.553 líneas y 78 componentes en un
// solo archivo. Este módulo se lleva la superficie administrativa entera: la
// consola y sus doce paneles —cumplimiento de conductores, gobernanza de
// precios, revisión de payouts, ajuste de propinas, conciliación de pagos,
// reclamos y configuración de envíos, entregas de notificaciones, operaciones de
// soporte, moderación de usuarios y seguridad—.
//
// Se eligió este corte primero por una propiedad medida, no por tamaño: **el
// bloque no referencia ningún helper compartido ni ningún componente de afuera**,
// y de sus trece componentes sólo `SuperAdminConsole` cruza la frontera. Es la
// extracción de menor riesgo posible sobre un archivo de este tamaño.
//
// Que sea un módulo propio es además la precondición del criterio «el build de
// customer no incluye backoffice»: mientras esto viviera dentro de `App.tsx`, no
// había forma de que el empaquetador lo dejara fuera de ningún bundle.
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
  Plus,
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
  NotificationDeadLetter,
  Order,
  PaymentReconciliation,
  PaymentReconciliationCase,
  PayoutReview,
  PricingChangeRequest,
  PricingPlan,
  PricingService,
  Ride,
  ServiceQuickReply,
  ServiceTip,
  ShipmentClaim,
  ShipmentOptions,
  SupportAgent,
  SupportTicket,
  TipAdjustment,
  TransactionRiskAssessment,
} from "../types";

import { api } from "../api";
import { initials, money } from "../format";
import { orderStatusLabel, rideStatusLabel } from "../labels";
import { AdminKpi, AdminSectionHeader } from "../ui/panels";
import { PromotionControlsPanel, ZoneDemandPanel } from "./DemandControlsBoard";
import {
  FeatureFlagsPanel,
  ProductFunnelPanel,
  ZoneReadinessPanel,
} from "./ProductOperationsBoard";

export function SuperAdminConsole({
  state,
  currentUserId,
  dashboard,
  busy,
  realtimeStatus,
  runAction,
  onSwitchPortal,
  onLogout,
}: {
  state: AppState;
  currentUserId: string;
  dashboard: AdminDashboard | null;
  busy: boolean;
  realtimeStatus: "connecting" | "live" | "reconnecting" | "offline";
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onSwitchPortal: () => void;
  onLogout: () => void;
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
  >("overview");
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

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span>
            <Flame size={22} />
          </span>
          <div>
            <strong>Flash Command</strong>
            <small>Superadministrador</small>
          </div>
        </div>
        <nav className="admin-nav">
          <button type="button" onClick={onSwitchPortal}>
            <Store size={17} /> Portal de comercio
          </button>
          {nav.map(([id, label, Icon]) => (
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
            En escritorio solo se muestra gestion de plataforma. Cliente, comercio y driver quedan
            como app mobile/PWA.
          </span>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span>Operaciones · PostgreSQL/PostGIS</span>
            <h1>Control de marketplace, movilidad y delivery</h1>
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
        )}

        {section === "merchants" && (
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
          />
        )}

        {section === "shipments" && (
          <ShipmentConfigurationPanel busy={busy} runAction={runAction} />
        )}

        {section === "claims" && <ShipmentClaimsPanel />}
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

const pricingFieldLabels: Record<string, string> = {
  baseFare: "Tarifa base",
  distancePerKm: "Por kilómetro",
  timePerMin: "Por minuto",
  serviceFee: "Cargo de servicio",
  tollThresholdKm: "Umbral de peaje (km)",
  tollAmount: "Peaje",
  roadFactor: "Factor vial",
  minDistanceKm: "Distancia mínima",
  maxDistanceKm: "Distancia máxima",
  durationBaseMin: "Duración base",
  durationPerKm: "Duración por km",
  etaBaseMin: "ETA base",
  etaPerKm: "ETA por km",
  baseDeliveryFee: "Envío base",
  minimumDeliveryFee: "Envío mínimo",
  maximumDeliveryFee: "Envío máximo",
  maximumDistanceKm: "Cobertura máxima",
  weightPerKg: "Por kilogramo",
  minimumEtaMin: "ETA mínimo",
  moto: "Moto",
  economy: "Economy",
  comfort: "Comfort",
  xl: "XL",
  small: "Pequeño",
  medium: "Mediano",
  large: "Grande",
};
function pricingNumbers(
  config: Record<string, unknown>,
  prefix = "",
): Array<{ path: string; label: string; value: number }> {
  return Object.entries(config).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") return [{ path, label: pricingFieldLabels[key] || key, value }];
    if (value && typeof value === "object" && !Array.isArray(value))
      return pricingNumbers(value as Record<string, unknown>, path);
    return [];
  });
}
function updatePricingNumber(config: Record<string, unknown>, path: string, value: number) {
  const copy = structuredClone(config),
    parts = path.split(".");
  let cursor: Record<string, unknown> = copy;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  cursor[parts.at(-1)!] = value;
  return copy;
}
const localDateTime = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

function PricingGovernancePanel({
  currentUserId,
  busy,
  runAction,
}: {
  currentUserId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [plans, setPlans] = useState<PricingPlan[]>([]),
    [requests, setRequests] = useState<PricingChangeRequest[]>([]),
    [service, setService] = useState<PricingService>("shipment"),
    [config, setConfig] = useState<Record<string, unknown>>({}),
    [version, setVersion] = useState(""),
    [effectiveAt, setEffectiveAt] = useState(localDateTime(new Date(Date.now() + 15 * 60000))),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [planResult, changeResult] = await Promise.all([
        api.getPricingPlans(),
        api.getPricingChanges(),
      ]);
      setPlans(planResult.plans);
      setRequests(changeResult.requests);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar tarifas");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const activePlan = useMemo(
    () =>
      plans.find((plan) => plan.service === service && plan.active) ||
      plans.find((plan) => plan.service === service),
    [plans, service],
  );
  useEffect(() => {
    if (!activePlan) return;
    setConfig(structuredClone(activePlan.config));
    setVersion(
      `${service.toUpperCase()}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-V2`,
    );
  }, [activePlan, service]);
  const submit = () =>
    runAction(async () => {
      const result = await api.requestPricingChange(service, {
        version: version.trim().toUpperCase(),
        config,
        effectiveAt: new Date(effectiveAt).toISOString(),
      });
      await load();
      return result;
    }, "Cambio enviado a aprobación");
  const review = (entry: PricingChangeRequest, decision: "approved" | "rejected") =>
    runAction(
      async () => {
        const result = await api.reviewPricingChange(
          entry.id,
          decision,
          notes[entry.id]?.trim() || "",
        );
        await load();
        return result;
      },
      decision === "approved" ? "Cambio aprobado" : "Cambio rechazado",
    );
  return (
    <div className="admin-grid pricing-governance">
      <section className="admin-card">
        <AdminSectionHeader title="Proponer tarifa" action="Doble aprobación" />
        <p>
          Parte de la tarifa activa, ajusta valores y define vigencia. Nunca publica directamente.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div className="pricing-service-tabs">
          {(["food", "ride", "shipment"] as PricingService[]).map((item) => (
            <button
              key={item}
              className={service === item ? "active" : ""}
              onClick={() => setService(item)}
            >
              {item === "food" ? "Comidas" : item === "ride" ? "Viajes" : "Envíos"}
            </button>
          ))}
        </div>
        {activePlan && (
          <small>
            Activa: {activePlan.version} · desde{" "}
            {new Date(activePlan.effectiveFrom).toLocaleString("es-AR")}
          </small>
        )}
        <div className="pricing-history">
          {plans
            .filter((plan) => plan.service === service && !plan.active)
            .slice(0, 4)
            .map((plan) => (
              <div key={plan.version}>
                <span>{plan.version}</span>
                <small>{new Date(plan.effectiveFrom).toLocaleDateString("es-AR")}</small>
                <button
                  disabled={busy || !effectiveAt}
                  onClick={() =>
                    runAction(async () => {
                      const result = await api.requestPricingRollback(service, {
                        targetVersion: plan.version,
                        version: `${service.toUpperCase()}-ROLLBACK-${Date.now()}`,
                        effectiveAt: new Date(effectiveAt).toISOString(),
                      });
                      await load();
                      return result;
                    }, `Rollback de ${plan.version} enviado a revisión`)
                  }
                >
                  Proponer rollback
                </button>
              </div>
            ))}
        </div>
        <div className="pricing-fields">
          {pricingNumbers(config).map((field) => (
            <label key={field.path}>
              {field.label}
              <small>{field.path}</small>
              <input
                type="number"
                step="0.01"
                value={field.value}
                onChange={(event) =>
                  setConfig((current) =>
                    updatePricingNumber(current, field.path, Number(event.target.value)),
                  )
                }
              />
            </label>
          ))}
        </div>
        <div className="pricing-submit">
          <label>
            Versión
            <input
              value={version}
              onChange={(event) => setVersion(event.target.value.toUpperCase())}
            />
          </label>
          <label>
            Vigencia
            <input
              type="datetime-local"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
            />
          </label>
          <button
            disabled={busy || !activePlan || version.trim().length < 6 || !effectiveAt}
            onClick={submit}
          >
            Enviar a revisión
          </button>
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Cola de aprobación"
          action={`${requests.filter((entry) => entry.status === "pending").length} pendientes`}
        />
        <p>
          La persona solicitante no puede revisar su propio cambio. Riesgo alto exige fundamento
          reforzado.
        </p>
        <div className="pricing-request-list">
          {requests.length === 0 && (
            <div className="empty-state">No hay solicitudes tarifarias.</div>
          )}
          {requests.map((entry) => {
            const own = entry.requestedBy === currentUserId,
              pending = entry.status === "pending",
              minimumNote = entry.riskLevel === "high" ? 20 : 5;
            return (
              <article
                key={entry.id}
                className={`pricing-request ${entry.status} risk-${entry.riskLevel}`}
              >
                <div>
                  <span>{entry.changeKind === "rollback" ? "rollback" : entry.service}</span>
                  <strong>{entry.version}</strong>
                  <b>{entry.status}</b>
                </div>
                <div className={`pricing-risk ${entry.riskLevel}`}>
                  Riesgo {entry.riskLevel} · máximo {entry.maximumChangePercent.toFixed(1)}%
                </div>
                {entry.sourceVersion && (
                  <small>Restaura configuración de {entry.sourceVersion}</small>
                )}
                <small>
                  Solicita {entry.requestedBy} · vigencia{" "}
                  {new Date(entry.effectiveAt).toLocaleString("es-AR")}
                </small>
                {entry.riskWarnings.length > 0 && (
                  <div className="pricing-warnings">
                    {entry.riskWarnings.slice(0, 3).map((warning) => (
                      <small key={warning.path}>
                        <strong>
                          {pricingFieldLabels[warning.path.split(".").at(-1)!] || warning.path}
                        </strong>{" "}
                        {warning.previous} → {warning.next} (
                        {warning.direction === "increase" ? "+" : "-"}
                        {warning.changePercent.toFixed(1)}%)
                      </small>
                    ))}
                  </div>
                )}
                {entry.reviewedBy && (
                  <small>
                    Revisa {entry.reviewedBy} · {entry.reviewNote}
                  </small>
                )}
                {pending && (
                  <>
                    <textarea
                      placeholder={
                        own
                          ? "Debe revisar otro administrador"
                          : entry.riskLevel === "high"
                            ? "Fundamento reforzado: mínimo 20 caracteres"
                            : "Fundamento obligatorio de la decisión"
                      }
                      disabled={own || busy}
                      value={notes[entry.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="pricing-review-actions">
                      <button
                        disabled={
                          own || busy || (notes[entry.id]?.trim().length || 0) < minimumNote
                        }
                        onClick={() => review(entry, "rejected")}
                      >
                        Rechazar
                      </button>
                      <button
                        disabled={
                          own || busy || (notes[entry.id]?.trim().length || 0) < minimumNote
                        }
                        onClick={() => review(entry, "approved")}
                      >
                        Aprobar
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function PayoutReviewPanel() {
  const [payouts, setPayouts] = useState<PayoutReview[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setPayouts((await api.getAdminPayouts()).payouts);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar los retiros",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const review = async (entry: PayoutReview, decision: "approved" | "rejected") => {
    try {
      setBusy(true);
      await api.reviewPayout(entry.id, decision, notes[entry.id]?.trim() || "");
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "No se pudo revisar el retiro");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Aprobación de retiros"
        action={`${payouts.filter((entry) => entry.status === "pending").length} pendientes`}
      />
      <p>
        El saldo se reserva al solicitar. Sólo una revisión independiente permite enviarlo al
        proveedor; rechazar libera la reserva al ledger comercial.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {payouts.map((entry) => (
          <article
            className={`shipment-config-card${entry.status === "cancelled" ? " inactive" : ""}`}
            key={entry.id}
          >
            <div>
              <span>
                {entry.merchantName} · {entry.id}
              </span>
              <strong>
                {money.format(entry.amount)} · {entry.status}
              </strong>
            </div>
            <small>
              Solicita {entry.requestedBy || "migrado"} ·{" "}
              {new Date(entry.createdAt).toLocaleString("es-AR")}
            </small>
            {entry.status === "pending" ? (
              <>
                <label className="wide">
                  Fundamento
                  <textarea
                    value={notes[entry.id] || ""}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [entry.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="pricing-review-actions">
                  <button
                    disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                    onClick={() => void review(entry, "rejected")}
                  >
                    Rechazar y liberar saldo
                  </button>
                  <button
                    disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                    onClick={() => void review(entry, "approved")}
                  >
                    Aprobar para procesamiento
                  </button>
                </div>
              </>
            ) : (
              <small>
                {entry.reviewDecision
                  ? `${entry.reviewDecision} por ${entry.reviewedBy} · ${entry.reviewNote}`
                  : "Esperando proveedor externo"}
              </small>
            )}
          </article>
        ))}
        {payouts.length === 0 && <p>No hay retiros solicitados.</p>}
      </div>
    </section>
  );
}

function TipAdjustmentPanel({
  tips,
  currentUserId,
}: {
  tips: ServiceTip[];
  currentUserId: string;
}) {
  const [adjustments, setAdjustments] = useState<TipAdjustment[]>([]),
    [tipId, setTipId] = useState(tips[0]?.id || ""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setAdjustments((await api.getTipAdjustments()).adjustments);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar los ajustes",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const requestAdjustment = async () => {
    try {
      setBusy(true);
      await api.requestTipAdjustment(tipId, Number(amount), reason.trim());
      setAmount("");
      setReason("");
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "No se pudo solicitar el ajuste",
      );
    } finally {
      setBusy(false);
    }
  };
  const review = async (entry: TipAdjustment, decision: "approved" | "rejected") => {
    try {
      setBusy(true);
      await api.reviewTipAdjustment(entry.id, decision, notes[entry.id]?.trim() || "");
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "No se pudo revisar el ajuste");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Correcciones de propinas"
        action={`${adjustments.filter((entry) => entry.status === "pending").length} pendientes`}
      />
      <p>
        Una persona solicita la corrección y otra la aprueba. Al aprobar, el ledger revierte el
        importe del conductor al cliente sin alterar la propina histórica.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="pricing-fields">
        <label>
          Propina
          <select value={tipId} onChange={(event) => setTipId(event.target.value)}>
            <option value="">Seleccionar</option>
            {tips.map((tip) => (
              <option key={tip.id} value={tip.id}>
                {tip.id} · {tip.jobId} · {money.format(tip.amount)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Importe
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="wide">
          Motivo
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo operativo verificable"
          />
        </label>
        <button
          className="primary-button"
          disabled={busy || !tipId || Number(amount) <= 0 || reason.trim().length < 5}
          onClick={() => void requestAdjustment()}
        >
          Solicitar corrección
        </button>
      </div>
      <div className="shipment-config-list">
        {adjustments.map((entry) => {
          const own = entry.requestedBy === currentUserId;
          return (
            <article
              className={`shipment-config-card${entry.status !== "pending" ? " inactive" : ""}`}
              key={entry.id}
            >
              <div>
                <span>
                  {entry.tipId} · servicio {entry.jobId}
                </span>
                <strong>
                  {money.format(entry.amount)} / {money.format(entry.tipAmount)} · {entry.status}
                </strong>
              </div>
              <p>{entry.reason}</p>
              <small>
                Solicita {entry.requestedBy} · {new Date(entry.requestedAt).toLocaleString("es-AR")}
              </small>
              {entry.status === "pending" ? (
                <>
                  <label className="wide">
                    Fundamento
                    <textarea
                      disabled={own || busy}
                      value={notes[entry.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                      placeholder={
                        own ? "Debe revisar otro administrador" : "Fundamento de la decisión"
                      }
                    />
                  </label>
                  <div className="pricing-review-actions">
                    <button
                      disabled={own || busy || (notes[entry.id]?.trim().length || 0) < 5}
                      onClick={() => void review(entry, "rejected")}
                    >
                      Rechazar
                    </button>
                    <button
                      disabled={own || busy || (notes[entry.id]?.trim().length || 0) < 5}
                      onClick={() => void review(entry, "approved")}
                    >
                      Aprobar y contabilizar
                    </button>
                  </div>
                </>
              ) : (
                <small>
                  {entry.reviewedBy} · {entry.reviewNote}
                </small>
              )}
            </article>
          );
        })}
        {!adjustments.length && <p>No hay correcciones solicitadas.</p>}
      </div>
    </section>
  );
}

function PaymentReconciliationPanel() {
  const [data, setData] = useState<PaymentReconciliation | null>(null),
    [risks, setRisks] = useState<TransactionRiskAssessment[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async (scan = false) => {
    try {
      setBusy(true);
      const [reconciliation, riskResult] = await Promise.all([
        scan ? api.scanPaymentReconciliation() : api.getPaymentReconciliation(),
        api.getTransactionRisks(),
      ]);
      setData(reconciliation);
      setRisks(riskResult.assessments);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudo cargar la conciliación",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const resolve = async (entry: PaymentReconciliationCase, status: "resolved" | "ignored") => {
    try {
      setBusy(true);
      await api.resolvePaymentReconciliationCase(entry.id, status, notes[entry.id]?.trim() || "");
      await load();
    } catch (resolveError) {
      setError(
        resolveError instanceof Error ? resolveError.message : "No se pudo cerrar la excepción",
      );
    } finally {
      setBusy(false);
    }
  };
  const reviewRisk = async (
    entry: TransactionRiskAssessment,
    reviewStatus: "confirmed_fraud" | "false_positive" | "cleared",
  ) => {
    try {
      setBusy(true);
      await api.reviewTransactionRisk(entry.id, reviewStatus, notes[entry.id]?.trim() || "");
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "No se pudo revisar el riesgo");
    } finally {
      setBusy(false);
    }
  };
  const cases = data?.cases || [],
    pendingRisks = risks.filter((entry) => entry.decision !== "allow" && !entry.reviewStatus);
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Conciliación de pagos"
          action={data ? `${data.summary.openCount} excepciones abiertas` : "PostgreSQL"}
        />
        <p>
          Compara intentos, capturas, reintegros y webhooks firmados. Detecta diferencias
          persistentes; no inventa confirmaciones del PSP.
        </p>
        <div className="admin-summary-grid">
          <article>
            <span>Urgentes</span>
            <strong>{data?.summary.urgentCount || 0}</strong>
          </article>
          <article>
            <span>Abiertas</span>
            <strong>{data?.summary.openCount || 0}</strong>
          </article>
          <article>
            <span>Riesgo pendiente</span>
            <strong>{pendingRisks.length}</strong>
          </article>
        </div>
        <button className="primary-button" disabled={busy} onClick={() => void load(true)}>
          <RefreshCw size={17} />
          {busy ? "Conciliando…" : "Ejecutar conciliación"}
        </button>
        {error && <p className="form-error">{error}</p>}
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Excepciones" action="Importes en centavos auditables" />
        <div className="shipment-config-list">
          {cases.map((entry) => (
            <article
              className={`shipment-config-card${entry.status !== "open" ? " inactive" : ""}`}
              key={entry.id}
            >
              <div>
                <span>
                  {entry.provider} · {entry.caseType.replaceAll("_", " ")}
                </span>
                <strong>
                  {entry.severity} · {entry.status}
                </strong>
              </div>
              <p>{entry.summary}</p>
              <small>
                {entry.externalReference || entry.entityType} · detectado{" "}
                {new Date(entry.lastDetectedAt).toLocaleString("es-AR")}
              </small>
              <details>
                <summary>Hechos conciliados</summary>
                <pre>{JSON.stringify(entry.details, null, 2)}</pre>
              </details>
              {entry.status === "open" ? (
                <>
                  <label className="wide">
                    Resolución
                    <textarea
                      value={notes[entry.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                      placeholder="Resultado verificado contra el proveedor"
                    />
                  </label>
                  <div className="pricing-review-actions">
                    <button
                      disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                      onClick={() => void resolve(entry, "ignored")}
                    >
                      Ignorar con fundamento
                    </button>
                    <button
                      disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                      onClick={() => void resolve(entry, "resolved")}
                    >
                      Marcar resuelto
                    </button>
                  </div>
                </>
              ) : (
                <small>
                  {entry.resolutionNote} · {entry.resolvedBy}
                </small>
              )}
            </article>
          ))}
          {!busy && cases.length === 0 && (
            <p>No hay excepciones. Ejecutá la conciliación para verificar el estado actual.</p>
          )}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Riesgo transaccional"
          action={`${pendingRisks.length} para revisar`}
        />
        <p>
          Scoring explicable previo al cobro sobre importe, antigüedad, velocidad, gasto horario y
          fallos de pago.
        </p>
        <div className="shipment-config-list">
          {risks
            .filter((entry) => entry.decision !== "allow")
            .map((entry) => (
              <article
                className={`shipment-config-card${entry.reviewStatus ? " inactive" : ""}`}
                key={entry.id}
              >
                <div>
                  <span>
                    {entry.service} · {entry.customerId}
                  </span>
                  <strong>
                    {entry.score}/100 · {entry.decision}
                  </strong>
                </div>
                <small>
                  {money.format(entry.amount)} ·{" "}
                  {entry.entityId || "bloqueada antes de crear servicio"}
                </small>
                <details>
                  <summary>Señales explicables</summary>
                  <pre>{JSON.stringify(entry.rules, null, 2)}</pre>
                </details>
                {!entry.reviewStatus ? (
                  <>
                    <label className="wide">
                      Fundamento
                      <textarea
                        value={notes[entry.id] || ""}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [entry.id]: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="pricing-review-actions">
                      <button
                        disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                        onClick={() => void reviewRisk(entry, "false_positive")}
                      >
                        Falso positivo
                      </button>
                      <button
                        disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                        onClick={() => void reviewRisk(entry, "cleared")}
                      >
                        Verificado
                      </button>
                      <button
                        disabled={busy || (notes[entry.id]?.trim().length || 0) < 5}
                        onClick={() => void reviewRisk(entry, "confirmed_fraud")}
                      >
                        Confirmar fraude
                      </button>
                    </div>
                  </>
                ) : (
                  <small>
                    {entry.reviewStatus} · {entry.reviewNote}
                  </small>
                )}
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}

function ShipmentClaimsPanel() {
  const [claims, setClaims] = useState<ShipmentClaim[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setClaims((await api.getShipmentClaims()).claims);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar siniestros");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const transition = async (claim: ShipmentClaim, status: ShipmentClaim["status"]) => {
    try {
      setBusy(true);
      await api.updateShipmentClaim(claim.id, {
        status,
        resolutionNote: notes[claim.id]?.trim() || `Transición operativa a ${status}`,
        approvedAmount: status === "approved" ? Number(amounts[claim.id]) : undefined,
      });
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar");
    } finally {
      setBusy(false);
    }
  };
  const openEvidence = async (id: string) => {
    try {
      setBusy(true);
      const result = await api.getShipmentClaimEvidenceContent(id),
        bytes = Uint8Array.from(atob(result.contentBase64), (character) => character.charCodeAt(0)),
        url = URL.createObjectURL(new Blob([bytes], { type: result.evidence.mimeType })),
        link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "No se pudo abrir la evidencia");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Siniestros de envíos protegidos"
        action={`${claims.filter((item) => !["rejected", "settled"].includes(item.status)).length} abiertos`}
      />
      <p>
        La aprobación respeta el máximo elegible. `settlement_pending` espera confirmación de una
        aseguradora o proveedor real; la consola no inventa transferencias.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {claims.map((claim) => {
          const next =
            claim.status === "submitted"
              ? ["under_review", "rejected"]
              : claim.status === "under_review"
                ? ["approved", "rejected"]
                : claim.status === "approved"
                  ? ["settlement_pending"]
                  : claim.status === "settlement_pending"
                    ? ["settled"]
                    : [];
          return (
            <article
              className={`shipment-config-card${claim.status === "rejected" ? " inactive" : ""}`}
              key={claim.id}
            >
              <div>
                <span>
                  {claim.claimType} · {claim.shipmentId}
                </span>
                <strong>{claim.status.replaceAll("_", " ")}</strong>
              </div>
              <p>{claim.description}</p>
              <small>
                Solicitado {money.format(claim.requestedAmount)} · elegible hasta{" "}
                {money.format(claim.eligibleAmount)}
                {claim.approvedAmount != null
                  ? ` · aprobado ${money.format(claim.approvedAmount)}`
                  : ""}
              </small>
              {claim.evidence?.length > 0 && (
                <div className="pricing-review-actions">
                  {claim.evidence.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      disabled={busy}
                      onClick={() => void openEvidence(item.id)}
                    >
                      <Download size={15} /> {item.fileName} · {Math.ceil(item.sizeBytes / 1024)} KB
                    </button>
                  ))}
                </div>
              )}
              {claim.status === "under_review" && (
                <label>
                  Monto aprobado
                  <input
                    type="number"
                    min="0.01"
                    max={claim.eligibleAmount}
                    value={amounts[claim.id] ?? claim.eligibleAmount}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [claim.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              )}{" "}
              {next.length > 0 && (
                <>
                  <label className="wide">
                    Fundamento
                    <textarea
                      value={notes[claim.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [claim.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="pricing-review-actions">
                    {next.map((status) => (
                      <button
                        key={status}
                        disabled={
                          busy ||
                          (notes[claim.id]?.trim().length || 0) < 5 ||
                          (status === "approved" &&
                            !Number(amounts[claim.id] ?? claim.eligibleAmount))
                        }
                        onClick={() => void transition(claim, status as ShipmentClaim["status"])}
                      >
                        {status.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        })}
        {claims.length === 0 && <p>No hay siniestros reportados.</p>}
      </div>
    </section>
  );
}

function ServiceQuickReplyPanel({ busy: globalBusy }: { busy: boolean }) {
  const [items, setItems] = useState<ServiceQuickReply[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState({
      serviceScope: "all" as ServiceQuickReply["serviceScope"],
      audience: "customer" as ServiceQuickReply["audience"],
      locale: "es-AR",
      body: "",
      position: 50,
      active: true,
    });
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setItems((await api.getAdminServiceQuickReplies()).quickReplies);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el catálogo");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const create = async () => {
    try {
      setSaving(true);
      await api.createServiceQuickReply(draft);
      setDraft((current) => ({
        ...current,
        body: "",
        position: current.position + 10,
      }));
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo crear");
    } finally {
      setSaving(false);
    }
  };
  const patch = async (item: ServiceQuickReply, changes: Partial<ServiceQuickReply>) => {
    try {
      setSaving(true);
      const updated = (await api.updateServiceQuickReply(item.id, changes)).quickReply;
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setError("");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="admin-grid two">
      <section className="admin-card">
        <AdminSectionHeader title="Respuestas rápidas" action="PostgreSQL · es-AR" />
        <p>El cliente mobile recibe únicamente frases activas compatibles con su rol y vertical.</p>
        {error && <p className="form-error">{error}</p>}
        <div className="shipment-config-list">
          {loading ? (
            <p>Cargando catálogo…</p>
          ) : (
            items.map((item) => (
              <article
                className={`shipment-config-card${item.active ? "" : " inactive"}`}
                key={item.id}
              >
                <div>
                  <span>
                    {item.audience} · {item.serviceScope}
                  </span>
                  <strong>{item.body}</strong>
                  <button
                    className="config-toggle"
                    disabled={saving || globalBusy}
                    onClick={() => void patch(item, { active: !item.active })}
                  >
                    {item.active ? "Desactivar" : "Activar"}
                  </button>
                </div>
                <label>
                  Orden
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={item.position}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, position: Number(event.target.value) }
                            : entry,
                        ),
                      )
                    }
                  />
                </label>
                <label className="wide">
                  Texto
                  <input
                    value={item.body}
                    maxLength={160}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((entry) =>
                          entry.id === item.id ? { ...entry, body: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={saving || globalBusy || !item.body.trim()}
                  onClick={() =>
                    void patch(item, {
                      body: item.body.trim(),
                      position: item.position,
                    })
                  }
                >
                  Guardar
                </button>
              </article>
            ))
          )}
        </div>
      </section>
      <section className="admin-card merchant-create-product">
        <AdminSectionHeader title="Nueva respuesta" action="Publicación inmediata" />
        <label>
          Vertical
          <select
            value={draft.serviceScope}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                serviceScope: event.target.value as ServiceQuickReply["serviceScope"],
              }))
            }
          >
            {["all", "food", "ride", "shipment"].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Audiencia
          <select
            value={draft.audience}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                audience: event.target.value as ServiceQuickReply["audience"],
              }))
            }
          >
            {["customer", "driver", "merchant"].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Idioma
          <input
            value={draft.locale}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                locale: event.target.value,
              }))
            }
          />
        </label>
        <label>
          Orden
          <input
            type="number"
            min="0"
            max="1000"
            value={draft.position}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                position: Number(event.target.value),
              }))
            }
          />
        </label>
        <label>
          Texto
          <textarea
            maxLength={160}
            value={draft.body}
            onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
          />
        </label>
        <button
          className="primary-button"
          disabled={saving || globalBusy || !draft.body.trim()}
          onClick={() => void create()}
        >
          <Plus size={17} /> Crear respuesta
        </button>
      </section>
    </div>
  );
}

function ShipmentConfigurationPanel({
  busy,
  runAction,
}: {
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [options, setOptions] = useState<ShipmentOptions | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .getAdminShipmentOptions()
        .then(setOptions)
        .catch((requestError) =>
          setError(requestError instanceof Error ? requestError.message : "No se pudo cargar"),
        ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!options)
    return (
      <section className="admin-card">
        <AdminSectionHeader title="Configuración de Envíos" action="PostgreSQL" />
        <p>{error || "Cargando categorías y SLA…"}</p>
      </section>
    );
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Categorías de paquete"
          action={`${options.categories.filter((item) => item.active).length} activas`}
        />
        <p>Límites, recargos e instrucciones usados por el cotizador y el conductor.</p>
        <div className="shipment-config-list">
          {options.categories.map((category) => (
            <article
              className={`shipment-config-card${category.active === false ? " inactive" : ""}`}
              key={category.code}
            >
              <div>
                <span>{category.code}</span>
                <strong>{category.name}</strong>
                <button
                  className="config-toggle"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      async () => {
                        const result = await api.updateShipmentItemCategory(category.code, {
                          active: category.active === false,
                        });
                        setOptions((current) =>
                          current
                            ? {
                                ...current,
                                categories: current.categories.map((item) =>
                                  item.code === category.code
                                    ? { ...item, ...result.category }
                                    : item,
                                ),
                              }
                            : current,
                        );
                      },
                      category.active === false
                        ? `${category.name} activada`
                        : `${category.name} desactivada`,
                    )
                  }
                >
                  {category.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
              <label>
                Recargo ARS
                <input
                  type="number"
                  min="0"
                  value={category.surcharge}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    surcharge: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Peso máximo kg
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={category.maximumWeightKg}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    maximumWeightKg: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label className="wide">
                Instrucciones
                <textarea
                  value={category.handlingInstructions}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    handlingInstructions: event.target.value,
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={
                  busy ||
                  category.maximumWeightKg <= 0 ||
                  category.handlingInstructions.trim().length < 3
                }
                onClick={() =>
                  runAction(async () => {
                    const result = await api.updateShipmentItemCategory(category.code, {
                      surcharge: category.surcharge,
                      maximumWeightKg: category.maximumWeightKg,
                      handlingInstructions: category.handlingInstructions,
                    });
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code ? { ...item, ...result.category } : item,
                            ),
                          }
                        : current,
                    );
                  }, `${category.name} actualizada`)
                }
              >
                Guardar categoría
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Niveles de servicio" action="Precio + ETA" />
        <p>
          Los cambios afectan cotizaciones nuevas; los tokens ya emitidos conservan su precio
          bloqueado.
        </p>
        <div className="shipment-config-list">
          {options.serviceLevels.map((level) => (
            <article
              className={`shipment-config-card sla${level.active === false ? " inactive" : ""}`}
              key={level.code}
            >
              <div>
                <span>{level.code}</span>
                <strong>{level.name}</strong>
                <button
                  className="config-toggle"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      async () => {
                        const result = await api.updateShipmentServiceLevel(level.code, {
                          active: level.active === false,
                        });
                        setOptions((current) =>
                          current
                            ? {
                                ...current,
                                serviceLevels: current.serviceLevels.map((item) =>
                                  item.code === level.code
                                    ? { ...item, ...result.serviceLevel }
                                    : item,
                                ),
                              }
                            : current,
                        );
                      },
                      level.active === false
                        ? `${level.name} activado`
                        : `${level.name} desactivado`,
                    )
                  }
                >
                  {level.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
              <label>
                Multiplicador precio
                <input
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.05"
                  value={level.transportMultiplier}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    transportMultiplier: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Multiplicador ETA
                <input
                  type="number"
                  min="0.25"
                  max="3"
                  step="0.05"
                  value={level.etaMultiplier}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    etaMultiplier: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Distancia máxima km
                <input
                  type="number"
                  min="1"
                  placeholder="Sin límite"
                  value={level.maximumDistanceKm ?? ""}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    maximumDistanceKm:
                                      event.target.value === "" ? null : Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    const result = await api.updateShipmentServiceLevel(level.code, {
                      transportMultiplier: level.transportMultiplier,
                      etaMultiplier: level.etaMultiplier,
                      maximumDistanceKm: level.maximumDistanceKm,
                    });
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code ? { ...item, ...result.serviceLevel } : item,
                            ),
                          }
                        : current,
                    );
                  }, `${level.name} actualizado`)
                }
              >
                Guardar SLA
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function NotificationDeliveryPanel() {
  const [deadLetters, setDeadLetters] = useState<NotificationDeadLetter[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setDeadLetters((await api.getNotificationDeadLetters()).deadLetters);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudo cargar la cola de descarte",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (action: () => Promise<unknown>) => {
    try {
      setBusy(true);
      await action();
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "No se pudo procesar la notificación",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Entrega de notificaciones"
        action={`${deadLetters.length} descartadas`}
      />
      <p>
        Los tokens permanentemente inválidos se revocan. Los fallos terminales quedan retenidos para
        inspección y replay atribuido, sin exponer tokens ni payloads.
      </p>
      <button
        className="primary-button"
        disabled={busy}
        onClick={() => void act(() => api.processNotifications())}
      >
        <RefreshCw size={17} />
        {busy ? "Procesando…" : "Procesar outbox"}
      </button>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {deadLetters.map((entry) => (
          <article className="shipment-config-card" key={entry.id}>
            <div>
              <span>
                {entry.channel} · {entry.template}
              </span>
              <strong>{entry.id}</strong>
            </div>
            <small>
              {entry.userId} · {entry.reason} · {entry.attempts} intentos
            </small>
            <small>
              Descartada {new Date(entry.createdAt).toLocaleString("es-AR")} · replays{" "}
              {entry.replayCount}
            </small>
            <button
              disabled={busy}
              onClick={() => void act(() => api.replayNotificationDeadLetter(entry.id))}
            >
              Reintentar entrega
            </button>
          </article>
        ))}
        {!deadLetters.length && <p>No hay entregas terminales pendientes.</p>}
      </div>
    </section>
  );
}

function SupportOperationsPanel({
  tickets,
  currentUserId,
  busy,
  runAction,
}: {
  tickets: SupportTicket[];
  currentUserId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [agents, setAgents] = useState<SupportAgent[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setAgents((await api.getSupportAgents()).agents);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar los agentes",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const updateAgent = async (
    userId: string,
    payload: Parameters<typeof api.updateSupportAgent>[1],
  ) => {
    try {
      setLoading(true);
      await api.updateSupportAgent(userId, payload);
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "No se pudo actualizar el agente",
      );
    } finally {
      setLoading(false);
    }
  };
  const open = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)),
    breached = open.filter((ticket) => ticket.slaStatus.includes("breached"));
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Soporte y SLA"
          action={`${open.length} abiertos · ${breached.length} vencidos`}
        />
        <p>
          La cola asigna por capacidad y especialidad. Los vencimientos generan escalaciones
          idempotentes, nota interna y alerta al responsable.
        </p>
        <button
          className="primary-button"
          disabled={busy || loading}
          onClick={() =>
            runAction(() => api.processSupportQueue(), "Cola distribuida y SLA procesado")
          }
        >
          <RefreshCw size={17} />
          Procesar cola ahora
        </button>
        {error && <p className="form-error">{error}</p>}
        <div className="shipment-config-list">
          {tickets.map((ticket) => (
            <article
              className={`shipment-config-card${["resolved", "closed"].includes(ticket.status) ? " inactive" : ""}`}
              key={ticket.id}
            >
              <div>
                <span>
                  {ticket.service} · {ticket.id}
                </span>
                <strong>{ticket.title}</strong>
              </div>
              <div className="admin-summary-grid">
                <article>
                  <span>SLA</span>
                  <strong
                    className={
                      ticket.slaStatus.includes("breached") ? "status-suspended" : "status-active"
                    }
                  >
                    {ticket.slaStatus.replaceAll("_", " ")}
                  </strong>
                </article>
                <article>
                  <span>Responsable</span>
                  <strong>{ticket.assignedTo || "Sin asignar"}</strong>
                </article>
                <article>
                  <span>Escalación</span>
                  <strong>Nivel {ticket.escalationLevel}</strong>
                </article>
              </div>
              <small>
                {ticket.priority} ·{" "}
                {ticket.resolutionDueAt
                  ? `resolución ${new Date(ticket.resolutionDueAt).toLocaleString("es-AR")}`
                  : "SLA persistido sólo con PostgreSQL"}
              </small>
              <label className="wide">
                Asignar
                <select
                  value={ticket.assignedTo || ""}
                  disabled={busy || loading || ["resolved", "closed"].includes(ticket.status)}
                  onChange={(event) =>
                    runAction(
                      () =>
                        api.updateSupportTicket(ticket.id, {
                          assignedTo: event.target.value,
                        }),
                      "Ticket reasignado",
                    )
                  }
                >
                  <option value="">Seleccionar agente</option>
                  {agents
                    .filter((agent) => agent.availability !== "offline")
                    .map((agent) => (
                      <option key={agent.userId} value={agent.userId}>
                        {agent.name} · {agent.activeTickets}/{agent.maxActiveTickets}
                      </option>
                    ))}
                </select>
              </label>
              {!["resolved", "closed"].includes(ticket.status) && (
                <div className="pricing-review-actions">
                  <button
                    disabled={busy || ticket.assignedTo === currentUserId}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateSupportTicket(ticket.id, {
                            assignedTo: currentUserId,
                          }),
                        "Ticket tomado",
                      )
                    }
                  >
                    Tomar caso
                  </button>
                  <button
                    disabled={busy || ticket.priority === "urgent"}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateSupportTicket(ticket.id, {
                            priority: "urgent",
                          }),
                        "Prioridad elevada",
                      )
                    }
                  >
                    Marcar urgente
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      runAction(
                        () =>
                          api.updateSupportTicket(ticket.id, {
                            status: "resolved",
                          }),
                        "Ticket resuelto",
                      )
                    }
                  >
                    Resolver
                  </button>
                </div>
              )}
              {ticket.assignmentHistory.length > 0 && (
                <details>
                  <summary>Historial de asignación ({ticket.assignmentHistory.length})</summary>
                  {ticket.assignmentHistory.map((entry, index) => (
                    <small key={`${entry.createdAt}-${index}`}>
                      {new Date(entry.createdAt).toLocaleString("es-AR")} · {entry.assignedTo} ·{" "}
                      {entry.reason}
                    </small>
                  ))}
                </details>
              )}
            </article>
          ))}
          {!tickets.length && <p>No hay tickets en la cola.</p>}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader
          title="Capacidad del equipo"
          action={`${agents.filter((agent) => agent.availability !== "offline").length} disponibles`}
        />
        <div className="shipment-config-list">
          {agents.map((agent) => (
            <article
              className={`shipment-config-card${agent.availability === "offline" ? " inactive" : ""}`}
              key={agent.userId}
            >
              <div>
                <span>{agent.userId}</span>
                <strong>{agent.name}</strong>
              </div>
              <small>
                {agent.activeTickets}/{agent.maxActiveTickets} activos · skills{" "}
                {agent.skills.join(", ")}
              </small>
              <div className="pricing-fields">
                <label>
                  Estado
                  <select
                    value={agent.availability}
                    disabled={loading}
                    onChange={(event) =>
                      void updateAgent(agent.userId, {
                        availability: event.target.value as SupportAgent["availability"],
                      })
                    }
                  >
                    <option value="available">Disponible</option>
                    <option value="busy">Ocupado</option>
                    <option value="offline">Fuera de línea</option>
                  </select>
                </label>
                <label>
                  Capacidad
                  <input
                    type="number"
                    min="1"
                    max="100"
                    defaultValue={agent.maxActiveTickets}
                    disabled={loading}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (value >= 1 && value <= 100 && value !== agent.maxActiveTickets)
                        void updateAgent(agent.userId, {
                          maxActiveTickets: value,
                        });
                    }}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </section>
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
