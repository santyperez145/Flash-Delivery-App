// Paneles de dinero del backoffice (ARC-001).
//
// Gobernanza de tarifas, revisión de retiros, corrección de propinas y
// conciliación de pagos. Salen de AdminConsole porque mueven dinero y deben
// poder revisarse sin arrastrar el resto de la consola.
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type {
  PaymentReconciliation,
  PaymentReconciliationCase,
  PayoutReview,
  PricingChangeRequest,
  PricingPlan,
  PricingService,
  ServiceTip,
  TipAdjustment,
  TransactionRiskAssessment,
} from "../types";

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

export function PayoutReviewPanel() {
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

export function TipAdjustmentPanel({
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

export function PaymentReconciliationPanel() {
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
