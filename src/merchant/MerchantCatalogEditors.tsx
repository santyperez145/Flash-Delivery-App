// Editores propios del catálogo operativo de comercio.
//
// Estos componentes sólo cruzan datos ya resueltos por la consola: no conocen
// la sesión ni deciden permisos. Las mutaciones siguen pasando por `runAction`,
// que conserva el manejo de errores y la invalidación de estado del shell.
import { useEffect, useState } from "react";
import { Plus, ShieldCheck, SlidersHorizontal, X } from "lucide-react";

import { api } from "../api";
import type { MenuItem, Restaurant } from "../types";

export function BranchScheduleEditor({
  restaurantId,
  branch,
  busy,
  runAction,
}: {
  restaurantId: string;
  branch: NonNullable<Restaurant["branches"]>[number];
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const defaultHours = Array.from(
    { length: 7 },
    (_, weekday) =>
      branch.weeklyHours?.find((hour) => hour.weekday === weekday) || {
        weekday,
        opensAt: "09:00",
        closesAt: "23:00",
        enabled: true,
      },
  );
  const [hours, setHours] = useState(defaultHours),
    [timezone, setTimezone] = useState(branch.timezone || "America/Argentina/Buenos_Aires"),
    [exceptionDate, setExceptionDate] = useState(""),
    [exceptionOpen, setExceptionOpen] = useState(false),
    [exceptionReason, setExceptionReason] = useState("");
  useEffect(() => {
    setHours(
      Array.from(
        { length: 7 },
        (_, weekday) =>
          branch.weeklyHours?.find((hour) => hour.weekday === weekday) || {
            weekday,
            opensAt: "09:00",
            closesAt: "23:00",
            enabled: true,
          },
      ),
    );
    setTimezone(branch.timezone || "America/Argentina/Buenos_Aires");
  }, [branch.id, branch.timezone, branch.weeklyHours]);
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const change = (
    weekday: number,
    field: "opensAt" | "closesAt" | "enabled",
    value: string | boolean,
  ) =>
    setHours((current) =>
      current.map((hour) => (hour.weekday === weekday ? { ...hour, [field]: value } : hour)),
    );
  return (
    <div className="branch-schedule">
      <div className="branch-stock-title">
        <div>
          <strong>Horario automático</strong>
          <small>
            {branch.open ? "Abierta ahora" : "Cerrada ahora"} · {timezone}
          </small>
        </div>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            runAction(
              () =>
                api.replaceBranchSchedule(restaurantId, branch.id, {
                  timezone,
                  hours,
                }),
              "Horario semanal guardado",
            )
          }
        >
          Guardar horario
        </button>
      </div>
      <div className="branch-hours-grid">
        {hours.map((hour) => (
          <div className={`branch-hour-row ${hour.enabled ? "" : "disabled"}`} key={hour.weekday}>
            <label>
              <input
                type="checkbox"
                checked={hour.enabled}
                onChange={(event) => change(hour.weekday, "enabled", event.target.checked)}
              />
              <b>{dayNames[hour.weekday]}</b>
            </label>
            <input
              type="time"
              disabled={!hour.enabled}
              value={hour.opensAt}
              onChange={(event) => change(hour.weekday, "opensAt", event.target.value)}
            />
            <span>—</span>
            <input
              type="time"
              disabled={!hour.enabled}
              value={hour.closesAt}
              onChange={(event) => change(hour.weekday, "closesAt", event.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="branch-exception-form">
        <strong>Cierre o apertura excepcional</strong>
        <input
          type="date"
          value={exceptionDate}
          onChange={(event) => setExceptionDate(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={exceptionOpen}
            onChange={(event) => setExceptionOpen(event.target.checked)}
          />{" "}
          Abrir excepcionalmente
        </label>
        <input
          placeholder="Motivo, por ejemplo feriado"
          value={exceptionReason}
          onChange={(event) => setExceptionReason(event.target.value)}
        />
        <button
          className="secondary-button"
          disabled={busy || !exceptionDate}
          onClick={() =>
            runAction(
              () =>
                api.upsertBranchScheduleException(restaurantId, branch.id, {
                  date: exceptionDate,
                  isOpen: exceptionOpen,
                  ...(exceptionOpen ? { opensAt: "09:00", closesAt: "23:00" } : {}),
                  reason: exceptionReason,
                }),
              exceptionOpen ? "Apertura excepcional guardada" : "Cierre excepcional guardado",
            )
          }
        >
          Guardar excepción
        </button>
      </div>
      {branch.scheduleExceptions?.length > 0 && (
        <div className="branch-exception-list">
          {branch.scheduleExceptions.map((exception) => (
            <span key={exception.date}>
              <b>{exception.date}</b> ·{" "}
              {exception.isOpen ? `${exception.opensAt}–${exception.closesAt}` : "cerrada"}
              {exception.reason ? ` · ${exception.reason}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ModifierCatalogEditor({
  restaurantId,
  item,
  busy,
  runAction,
}: {
  restaurantId: string;
  item: MenuItem;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  type Groups = NonNullable<MenuItem["modifierGroups"]>;
  const [groups, setGroups] = useState<Groups>(item.modifierGroups || []);
  useEffect(() => setGroups(item.modifierGroups || []), [item.id, item.modifierGroups]);
  const updateGroup = (index: number, patch: Partial<Groups[number]>) =>
    setGroups((current) =>
      current.map((group, position) => (position === index ? { ...group, ...patch } : group)),
    );
  const addGroup = () => {
    const stamp = Date.now().toString(36);
    setGroups((current) => [
      ...current,
      {
        id: `group_${stamp}`,
        name: "Nuevo grupo",
        min: 0,
        max: 1,
        required: false,
        modifiers: [
          {
            id: `option_${stamp}`,
            name: "Nueva opción",
            price: 0,
            available: true,
          },
        ],
      },
    ]);
  };
  const addModifier = (groupIndex: number) => {
    const stamp = Date.now().toString(36);
    setGroups((current) =>
      current.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              modifiers: [
                ...group.modifiers,
                {
                  id: `option_${stamp}`,
                  name: "Nueva opción",
                  price: 0,
                  available: true,
                },
              ],
            }
          : group,
      ),
    );
  };
  return (
    <details className="modifier-editor">
      <summary>
        <SlidersHorizontal size={16} />
        <span>Opciones y agregados</span>
        <small>{groups.length} grupos</small>
      </summary>
      <div className="modifier-editor-body">
        {groups.map((group, groupIndex) => (
          <section className="modifier-group" key={group.id}>
            <div className="modifier-group-head">
              <input
                aria-label="Nombre del grupo"
                value={group.name}
                onChange={(event) => updateGroup(groupIndex, { name: event.target.value })}
              />
              <label>
                Mín.{" "}
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={group.min}
                  onChange={(event) =>
                    updateGroup(groupIndex, {
                      min: Number(event.target.value),
                      required: Number(event.target.value) > 0,
                    })
                  }
                />
              </label>
              <label>
                Máx.{" "}
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, group.modifiers.length)}
                  value={group.max}
                  onChange={(event) => updateGroup(groupIndex, { max: Number(event.target.value) })}
                />
              </label>
              <button
                className="icon-button"
                title="Eliminar grupo"
                onClick={() =>
                  setGroups((current) => current.filter((_, index) => index !== groupIndex))
                }
              >
                <X size={15} />
              </button>
            </div>
            <div className="modifier-options">
              {group.modifiers.map((modifier, modifierIndex) => (
                <div key={modifier.id}>
                  <input
                    aria-label="Nombre de opción"
                    value={modifier.name}
                    onChange={(event) =>
                      updateGroup(groupIndex, {
                        modifiers: group.modifiers.map((entry, index) =>
                          index === modifierIndex ? { ...entry, name: event.target.value } : entry,
                        ),
                      })
                    }
                  />
                  <label>
                    ${" "}
                    <input
                      aria-label="Precio adicional"
                      type="number"
                      min="0"
                      step="1"
                      value={modifier.price}
                      onChange={(event) =>
                        updateGroup(groupIndex, {
                          modifiers: group.modifiers.map((entry, index) =>
                            index === modifierIndex
                              ? { ...entry, price: Number(event.target.value) }
                              : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="modifier-available">
                    <input
                      type="checkbox"
                      checked={modifier.available}
                      onChange={(event) =>
                        updateGroup(groupIndex, {
                          modifiers: group.modifiers.map((entry, index) =>
                            index === modifierIndex
                              ? { ...entry, available: event.target.checked }
                              : entry,
                          ),
                        })
                      }
                    />{" "}
                    Disponible
                  </label>
                  <button
                    className="icon-button"
                    title="Eliminar opción"
                    disabled={group.modifiers.length <= group.max}
                    onClick={() =>
                      updateGroup(groupIndex, {
                        modifiers: group.modifiers.filter((_, index) => index !== modifierIndex),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button className="text-button" onClick={() => addModifier(groupIndex)}>
              <Plus size={14} /> Agregar opción
            </button>
          </section>
        ))}
        <div className="modifier-editor-actions">
          <button className="secondary-button" onClick={addGroup}>
            <Plus size={15} /> Nuevo grupo
          </button>
          <button
            className="primary-button"
            disabled={
              busy ||
              groups.some(
                (group) =>
                  !group.name.trim() ||
                  group.min > group.max ||
                  group.max > group.modifiers.length ||
                  group.modifiers.some((modifier) => !modifier.name.trim()),
              )
            }
            onClick={() =>
              runAction(
                () => api.replaceItemModifiers(restaurantId, item.id, groups),
                "Opciones del producto guardadas",
              )
            }
          >
            Guardar opciones
          </button>
        </div>
      </div>
    </details>
  );
}

export function DietaryCatalogEditor({
  restaurantId,
  item,
  busy,
  runAction,
}: {
  restaurantId: string;
  item: MenuItem;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const dietOptions = [
      { code: "vegetarian", name: "Vegetariano" },
      { code: "vegan", name: "Vegano" },
      { code: "gluten_free", name: "Sin gluten" },
      { code: "halal", name: "Halal" },
      { code: "kosher", name: "Kosher" },
    ],
    allergenOptions = [
      { code: "gluten", name: "Gluten" },
      { code: "milk", name: "Leche" },
      { code: "eggs", name: "Huevo" },
      { code: "peanuts", name: "Maní" },
      { code: "tree_nuts", name: "Frutos secos" },
      { code: "soy", name: "Soja" },
      { code: "fish", name: "Pescado" },
      { code: "shellfish", name: "Crustáceos" },
      { code: "sesame", name: "Sésamo" },
    ];
  const [diets, setDiets] = useState(() => item.dietaryLabels?.map((entry) => entry.code) || []),
    [allergens, setAllergens] = useState<Record<string, "contains" | "may_contain">>(() =>
      Object.fromEntries((item.allergens || []).map((entry) => [entry.code, entry.presence])),
    );
  useEffect(() => {
    setDiets(item.dietaryLabels?.map((entry) => entry.code) || []);
    setAllergens(
      Object.fromEntries((item.allergens || []).map((entry) => [entry.code, entry.presence])),
    );
  }, [item.id, item.dietaryLabels, item.allergens]);
  return (
    <details className="modifier-editor dietary-editor">
      <summary>
        <ShieldCheck size={16} />
        <span>Dietas y alérgenos</span>
        <small>{diets.length + Object.keys(allergens).length} declaraciones</small>
      </summary>
      <div className="modifier-editor-body">
        <strong className="dietary-subtitle">Apto para</strong>
        <div className="dietary-check-grid">
          {dietOptions.map((option) => (
            <label key={option.code}>
              <input
                type="checkbox"
                checked={diets.includes(option.code)}
                onChange={(event) =>
                  setDiets((current) =>
                    event.target.checked
                      ? [...current, option.code]
                      : current.filter((code) => code !== option.code),
                  )
                }
              />
              {option.name}
            </label>
          ))}
        </div>
        <strong className="dietary-subtitle">Alérgenos</strong>
        <div className="dietary-allergen-grid">
          {allergenOptions.map((option) => (
            <label key={option.code}>
              <span>{option.name}</span>
              <select
                value={allergens[option.code] || "none"}
                onChange={(event) =>
                  setAllergens((current) => {
                    const next = { ...current };
                    if (event.target.value === "none") delete next[option.code];
                    else next[option.code] = event.target.value as "contains" | "may_contain";
                    return next;
                  })
                }
              >
                <option value="none">No declarado</option>
                <option value="contains">Contiene</option>
                <option value="may_contain">Puede contener</option>
              </select>
            </label>
          ))}
        </div>
        <div className="modifier-editor-actions">
          <small>La declaración se muestra al cliente antes de agregar.</small>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              runAction(
                () =>
                  api.replaceItemDietary(restaurantId, item.id, {
                    dietaryLabels: diets,
                    allergens: Object.entries(allergens).map(([code, presence]) => ({
                      code,
                      presence,
                    })),
                  }),
                "Información alimentaria guardada",
              )
            }
          >
            Guardar declaración
          </button>
        </div>
      </div>
    </details>
  );
}
