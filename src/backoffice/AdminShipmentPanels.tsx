// Paneles de envíos del backoffice (ARC-001).
//
// Siniestros protegidos y configuración de categorías/SLA. Salen de
// AdminConsole porque son límites de courier autocontenidos.

import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import { AdminSectionHeader } from "../ui/panels";
import type { ShipmentClaim, ShipmentOptions } from "../types";
import { abrirContenidoProtegido } from "./open-protected-content";

export function ShipmentClaimsPanel() {
  const [claims, setClaims] = useState<ShipmentClaim[]>([]),
    [notes, setNotes] = useState<Record<string, string>>({}),
    [amounts, setAmounts] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setClaims((await api.getShipmentClaims()).claims);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar siniestros");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const transition = async (claim: ShipmentClaim, status: ShipmentClaim["status"]) => {
    try {
      setBusy(true);
      await api.updateShipmentClaim(claim.id, {
        status,
        resolutionNote: notes[claim.id]?.trim() || `Transición operativa a ${status}`,
        approvedAmount: status === "approved" ? Number(amounts[claim.id]) : undefined,
      });
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "No se pudo actualizar");
    } finally {
      setBusy(false);
    }
  };
  const openEvidence = async (id: string) => {
    try {
      setBusy(true);
      const result = await api.getShipmentClaimEvidenceContent(id);
      abrirContenidoProtegido(result.contentBase64, result.evidence.mimeType);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "No se pudo abrir la evidencia");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="admin-card">
      <AdminSectionHeader
        title="Siniestros de envíos protegidos"
        action={`${claims.filter((item) => !["rejected", "settled"].includes(item.status)).length} abiertos`}
      />
      <p>
        La aprobación respeta el máximo elegible. `settlement_pending` espera confirmación de una
        aseguradora o proveedor real; la consola no inventa transferencias.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="shipment-config-list">
        {claims.map((claim) => {
          const next =
            claim.status === "submitted"
              ? ["under_review", "rejected"]
              : claim.status === "under_review"
                ? ["approved", "rejected"]
                : claim.status === "approved"
                  ? ["settlement_pending"]
                  : claim.status === "settlement_pending"
                    ? ["settled"]
                    : [];
          return (
            <article
              className={`shipment-config-card${claim.status === "rejected" ? " inactive" : ""}`}
              key={claim.id}
            >
              <div>
                <span>
                  {claim.claimType} · {claim.shipmentId}
                </span>
                <strong>{claim.status.replaceAll("_", " ")}</strong>
              </div>
              <p>{claim.description}</p>
              <small>
                Solicitado {money.format(claim.requestedAmount)} · elegible hasta{" "}
                {money.format(claim.eligibleAmount)}
                {claim.approvedAmount != null
                  ? ` · aprobado ${money.format(claim.approvedAmount)}`
                  : ""}
              </small>
              {claim.evidence?.length > 0 && (
                <div className="pricing-review-actions">
                  {claim.evidence.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      disabled={busy}
                      onClick={() => void openEvidence(item.id)}
                    >
                      <Download size={15} /> {item.fileName} · {Math.ceil(item.sizeBytes / 1024)} KB
                    </button>
                  ))}
                </div>
              )}
              {claim.status === "under_review" && (
                <label>
                  Monto aprobado
                  <input
                    type="number"
                    min="0.01"
                    max={claim.eligibleAmount}
                    value={amounts[claim.id] ?? claim.eligibleAmount}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [claim.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              )}{" "}
              {next.length > 0 && (
                <>
                  <label className="wide">
                    Fundamento
                    <textarea
                      value={notes[claim.id] || ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [claim.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="pricing-review-actions">
                    {next.map((status) => (
                      <button
                        key={status}
                        disabled={
                          busy ||
                          (notes[claim.id]?.trim().length || 0) < 5 ||
                          (status === "approved" &&
                            !Number(amounts[claim.id] ?? claim.eligibleAmount))
                        }
                        onClick={() => void transition(claim, status as ShipmentClaim["status"])}
                      >
                        {status.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          );
        })}
        {claims.length === 0 && <p>No hay siniestros reportados.</p>}
      </div>
    </section>
  );
}

export function ShipmentConfigurationPanel({
  busy,
  runAction,
}: {
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
}) {
  const [options, setOptions] = useState<ShipmentOptions | null>(null),
    [error, setError] = useState("");
  const load = useCallback(
    () =>
      api
        .getAdminShipmentOptions()
        .then(setOptions)
        .catch((requestError) =>
          setError(requestError instanceof Error ? requestError.message : "No se pudo cargar"),
        ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!options)
    return (
      <section className="admin-card">
        <AdminSectionHeader title="Configuración de Envíos" action="PostgreSQL" />
        <p>{error || "Cargando categorías y SLA…"}</p>
      </section>
    );
  return (
    <div className="admin-grid">
      <section className="admin-card">
        <AdminSectionHeader
          title="Categorías de paquete"
          action={`${options.categories.filter((item) => item.active).length} activas`}
        />
        <p>Límites, recargos e instrucciones usados por el cotizador y el conductor.</p>
        <div className="shipment-config-list">
          {options.categories.map((category) => (
            <article
              className={`shipment-config-card${category.active === false ? " inactive" : ""}`}
              key={category.code}
            >
              <div>
                <span>{category.code}</span>
                <strong>{category.name}</strong>
                <button
                  className="config-toggle"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      async () => {
                        const result = await api.updateShipmentItemCategory(category.code, {
                          active: category.active === false,
                        });
                        setOptions((current) =>
                          current
                            ? {
                                ...current,
                                categories: current.categories.map((item) =>
                                  item.code === category.code
                                    ? { ...item, ...result.category }
                                    : item,
                                ),
                              }
                            : current,
                        );
                      },
                      category.active === false
                        ? `${category.name} activada`
                        : `${category.name} desactivada`,
                    )
                  }
                >
                  {category.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
              <label>
                Recargo ARS
                <input
                  type="number"
                  min="0"
                  value={category.surcharge}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    surcharge: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Peso máximo kg
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={category.maximumWeightKg}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    maximumWeightKg: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label className="wide">
                Instrucciones
                <textarea
                  value={category.handlingInstructions}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code
                                ? {
                                    ...item,
                                    handlingInstructions: event.target.value,
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={
                  busy ||
                  category.maximumWeightKg <= 0 ||
                  category.handlingInstructions.trim().length < 3
                }
                onClick={() =>
                  runAction(async () => {
                    const result = await api.updateShipmentItemCategory(category.code, {
                      surcharge: category.surcharge,
                      maximumWeightKg: category.maximumWeightKg,
                      handlingInstructions: category.handlingInstructions,
                    });
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            categories: current.categories.map((item) =>
                              item.code === category.code ? { ...item, ...result.category } : item,
                            ),
                          }
                        : current,
                    );
                  }, `${category.name} actualizada`)
                }
              >
                Guardar categoría
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <AdminSectionHeader title="Niveles de servicio" action="Precio + ETA" />
        <p>
          Los cambios afectan cotizaciones nuevas; los tokens ya emitidos conservan su precio
          bloqueado.
        </p>
        <div className="shipment-config-list">
          {options.serviceLevels.map((level) => (
            <article
              className={`shipment-config-card sla${level.active === false ? " inactive" : ""}`}
              key={level.code}
            >
              <div>
                <span>{level.code}</span>
                <strong>{level.name}</strong>
                <button
                  className="config-toggle"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      async () => {
                        const result = await api.updateShipmentServiceLevel(level.code, {
                          active: level.active === false,
                        });
                        setOptions((current) =>
                          current
                            ? {
                                ...current,
                                serviceLevels: current.serviceLevels.map((item) =>
                                  item.code === level.code
                                    ? { ...item, ...result.serviceLevel }
                                    : item,
                                ),
                              }
                            : current,
                        );
                      },
                      level.active === false
                        ? `${level.name} activado`
                        : `${level.name} desactivado`,
                    )
                  }
                >
                  {level.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
              <label>
                Multiplicador precio
                <input
                  type="number"
                  min="0.5"
                  max="5"
                  step="0.05"
                  value={level.transportMultiplier}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    transportMultiplier: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Multiplicador ETA
                <input
                  type="number"
                  min="0.25"
                  max="3"
                  step="0.05"
                  value={level.etaMultiplier}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    etaMultiplier: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <label>
                Distancia máxima km
                <input
                  type="number"
                  min="1"
                  placeholder="Sin límite"
                  value={level.maximumDistanceKm ?? ""}
                  onChange={(event) =>
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code
                                ? {
                                    ...item,
                                    maximumDistanceKm:
                                      event.target.value === "" ? null : Number(event.target.value),
                                  }
                                : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              </label>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    const result = await api.updateShipmentServiceLevel(level.code, {
                      transportMultiplier: level.transportMultiplier,
                      etaMultiplier: level.etaMultiplier,
                      maximumDistanceKm: level.maximumDistanceKm,
                    });
                    setOptions((current) =>
                      current
                        ? {
                            ...current,
                            serviceLevels: current.serviceLevels.map((item) =>
                              item.code === level.code ? { ...item, ...result.serviceLevel } : item,
                            ),
                          }
                        : current,
                    );
                  }, `${level.name} actualizado`)
                }
              >
                Guardar SLA
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
