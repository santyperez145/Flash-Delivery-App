// Operaciones de agentes y SLA (ARC-001).
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { AdminSectionHeader } from "../ui/panels";
import type { SupportAgent, SupportTicket } from "../types";

export function SupportOperationsPanel({
  tickets,
  currentUserId,
  busy,
  runAction,
  isSupport,
}: {
  tickets: SupportTicket[];
  currentUserId: string;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  isSupport: boolean;
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
                    disabled={loading || (isSupport && agent.userId !== currentUserId)}
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
                    disabled={loading || (isSupport && agent.userId !== currentUserId)}
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
