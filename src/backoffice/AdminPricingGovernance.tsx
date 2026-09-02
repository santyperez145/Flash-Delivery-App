// Gobernanza de tarifas del backoffice (ARC-001).
//
// Stripe Atlas / Uber Finance aíslan pricing del resto del ledger.
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { AdminSectionHeader } from "../ui/panels";
import type { PricingChangeRequest, PricingPlan, PricingService } from "../types";

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

export function PricingGovernancePanel({
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
