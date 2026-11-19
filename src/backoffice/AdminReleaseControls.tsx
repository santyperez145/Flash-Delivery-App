// Controles de release, tarifas e infra del backoffice (ARC-001).
//
// Embudo/flags, governance de pricing/surge y estado de infra. DoorDash /
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

// La sección Infra muestra sólo estado leído del servidor: las entregas de
// notificaciones que agotaron sus reintentos. Antes encabezaba una «ruta de
// infraestructura» de seis tarjetas (Kubernetes HPA, Redis administrado,
// réplicas) que era una hoja de ruta, no un estado, y se leía como si todo eso
// estuviera corriendo. El tablero de admin no devuelve salud de workers; cuando
// la devuelva, va acá.
export function AdminInfraPanel() {
  return (
    <div className="admin-grid">
      <NotificationDeliveryPanel />
    </div>
  );
}
