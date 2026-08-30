import { useEffect, useState } from "react";
import { Leaf, RefreshCw, TriangleAlert } from "lucide-react";

import { api } from "../api";
import { allergenOptions, dietOptions } from "../dietary";
import type { DietaryPreferences } from "../types";

export function CustomerDietaryPreferences({
  dietaryPreferences,
  onDietaryPreferencesChange,
}: {
  dietaryPreferences: DietaryPreferences | null;
  onDietaryPreferencesChange: (preferences: DietaryPreferences) => void;
}) {
  const [dietary, setDietary] = useState<DietaryPreferences | null>(dietaryPreferences),
    [dietaryBusy, setDietaryBusy] = useState(false),
    [dietaryError, setDietaryError] = useState("");
  useEffect(() => setDietary(dietaryPreferences), [dietaryPreferences]);
  const toggleDiet = (code: string) =>
    setDietary((current) =>
      current
        ? {
            ...current,
            dietaryLabels: current.dietaryLabels.some((item) => item.code === code)
              ? current.dietaryLabels.filter((item) => item.code !== code)
              : [
                  ...current.dietaryLabels,
                  { code, name: dietOptions.find((item) => item.code === code)?.name || code },
                ],
          }
        : current,
    );
  const toggleAllergen = (code: string) =>
    setDietary((current) =>
      current
        ? {
            ...current,
            avoidedAllergens: current.avoidedAllergens.some((item) => item.code === code)
              ? current.avoidedAllergens.filter((item) => item.code !== code)
              : [
                  ...current.avoidedAllergens,
                  { code, name: allergenOptions.find((item) => item.code === code)?.name || code },
                ],
          }
        : current,
    );
  const saveDietary = async () => {
    if (!dietary) return;
    setDietaryBusy(true);
    setDietaryError("");
    try {
      const result = await api.updateDietaryPreferences({
        dietaryLabels: dietary.dietaryLabels.map((item) => item.code),
        avoidedAllergens: dietary.avoidedAllergens.map((item) => item.code),
        hideIncompatible: dietary.hideIncompatible,
      });
      setDietary(result.preferences);
      onDietaryPreferencesChange(result.preferences);
    } catch (error) {
      setDietaryError(
        error instanceof Error ? error.message : "No se pudieron guardar tus preferencias",
      );
    } finally {
      setDietaryBusy(false);
    }
  };
  return (
    <section className="dietary-profile-card" aria-labelledby="dietary-profile-title">
      <div className="dietary-profile-heading">
        <span>
          <Leaf size={19} />
        </span>
        <div>
          <h3 id="dietary-profile-title">Mi alimentación</h3>
          <p>Personalizá el catálogo usando declaraciones verificables del comercio.</p>
        </div>
      </div>
      {!dietary && !dietaryError && (
        <p className="dietary-loading" role="status">
          <RefreshCw size={15} /> Cargando preferencias…
        </p>
      )}
      {dietary && (
        <>
          <strong>Apto para</strong>
          <div className="dietary-chip-list">
            {dietOptions.map((option) => {
              const selected = dietary.dietaryLabels.some((item) => item.code === option.code);
              return (
                <button
                  type="button"
                  key={option.code}
                  className={selected ? "dietary-chip selected" : "dietary-chip"}
                  aria-pressed={selected}
                  onClick={() => toggleDiet(option.code)}
                >
                  {option.name}
                </button>
              );
            })}
          </div>
          <strong>Evito estos alérgenos</strong>
          <div className="dietary-chip-list">
            {allergenOptions.map((option) => {
              const selected = dietary.avoidedAllergens.some((item) => item.code === option.code);
              return (
                <button
                  type="button"
                  key={option.code}
                  className={selected ? "dietary-chip allergen selected" : "dietary-chip allergen"}
                  aria-pressed={selected}
                  onClick={() => toggleAllergen(option.code)}
                >
                  {option.name}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="dietary-filter-toggle"
            role="switch"
            aria-checked={dietary.hideIncompatible}
            onClick={() =>
              setDietary((current) =>
                current ? { ...current, hideIncompatible: !current.hideIncompatible } : current,
              )
            }
          >
            <span>
              <strong>Ocultar incompatibles</strong>
              <small>“Sin datos” nunca significa que un producto sea seguro.</small>
            </span>
            <i aria-hidden="true" className={dietary.hideIncompatible ? "active" : ""} />
          </button>
          <div className="dietary-caution">
            <TriangleAlert size={17} />
            <span>
              Ante una alergia severa, confirmá con el comercio. Las indicaciones no eliminan
              contaminación cruzada.
            </span>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={dietaryBusy}
            onClick={() => void saveDietary()}
          >
            {dietaryBusy ? "Guardando…" : "Guardar preferencias alimentarias"}
          </button>
        </>
      )}
      {dietaryError && (
        <p className="form-error" role="alert">
          {dietaryError}
        </p>
      )}
    </section>
  );
}
