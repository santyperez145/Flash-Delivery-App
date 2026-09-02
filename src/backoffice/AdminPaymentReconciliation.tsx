// Conciliación de pagos del backoffice (ARC-001).
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type {
  PaymentReconciliation,
  PaymentReconciliationCase,
  TransactionRiskAssessment,
} from "../types";

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
