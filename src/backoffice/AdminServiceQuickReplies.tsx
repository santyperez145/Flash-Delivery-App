// Respuestas rápidas de soporte (ARC-001).
//
// Zendesk / Uber Support aíslan canned replies del resto de la mesa.
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { AdminSectionHeader } from "../ui/panels";
import type { ServiceQuickReply } from "../types";

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
