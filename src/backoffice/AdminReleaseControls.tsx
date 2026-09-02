// Controles de release, tarifas e infra del backoffice (ARC-001).
//
// Embudo/flags, governance de pricing/surge y roadmap de infra. DoorDash /
// Uber aisilan launch controls y surge del shell; Flash adopta la frontera.

import { AdminSectionHeader } from "../ui/panels";
import type { AppState } from "../types";
import { PromotionControlsPanel, ZoneDemandPanel } from "./DemandControlsBoard";
import {
  FeatureFlagsPanel,
  ProductFunnelPanel,
  ZoneReadinessPanel,
} from "./ProductOperationsBoard";
import { PricingGovernancePanel } from "./AdminFinancePanels";
import { InfraItem } from "./AdminOverviewBoards";
import { NotificationDeliveryPanel } from "./AdminSupportPanels";

type RunAction = (action: () => Promise<unknown>, success: string) => void;

export function AdminProductOpsPanel({
  zones,
  runAction,
}: {
  zones: AppState["zones"];
  runAction: RunAction;
}) {
  return (
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
            zones={zones.map((zona) => ({ id: zona.id, name: zona.name }))}
            runAction={runAction}
          />
        </section>
      </div>
    </div>
  );
}

export function AdminPricingOpsPanel({
  state,
  currentUserId,
  busy,
  runAction,
}: {
  state: AppState;
  currentUserId: string;
  busy: boolean;
  runAction: RunAction;
}) {
  return (
    <div className="admin-grid">
      <PricingGovernancePanel currentUserId={currentUserId} busy={busy} runAction={runAction} />
      {/* Promociones y multiplicadores: las dos palancas con las que se
          corrige una operación en curso. Estaban construidas y sin pantalla. */}
      <div className="admin-grid two">
        <section className="admin-card">
          <AdminSectionHeader
            title="Promociones"
            action={`${state.promotions.filter((promo) => promo.active).length} activas`}
          />
          <PromotionControlsPanel promotions={state.promotions} runAction={runAction} busy={busy} />
        </section>
        <section className="admin-card">
          <AdminSectionHeader title="Multiplicadores por zona" action="Surge" />
          <ZoneDemandPanel zones={state.zones} runAction={runAction} busy={busy} />
        </section>
      </div>
    </div>
  );
}

export function AdminInfraPanel() {
  return (
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
  );
}
