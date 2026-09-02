// Revisión de retiros del backoffice (ARC-001).
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type { PayoutReview } from "../types";

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
