// Corrección de propinas del backoffice (ARC-001).
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type { ServiceTip, TipAdjustment } from "../types";

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
