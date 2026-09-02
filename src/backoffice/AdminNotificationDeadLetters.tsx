// Dead letters de notificaciones (ARC-001).
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { AdminSectionHeader } from "../ui/panels";
import type { NotificationDeadLetter } from "../types";

export function NotificationDeliveryPanel() {
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
