// Paneles de soporte del backoffice (ARC-001).
//
// Respuestas rápidas, cola de notificaciones descartadas y operaciones de
// agentes/SLA. Salen de AdminConsole porque son límites de atención autocontenidos.

import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { AdminSectionHeader } from "../ui/panels";
import type {
  NotificationDeadLetter,
  ServiceQuickReply,
  SupportAgent,
  SupportTicket,
} from "../types";

export function ServiceQuickReplyPanel({ busy: globalBusy }: { busy: boolean }) {
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
