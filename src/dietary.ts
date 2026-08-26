// Catálogo dietario y compatibilidad (ticket ARC-001, paso 15).
//
// Las dos listas y el predicado los comparten `App.tsx` —que filtra los comercios
// sin nada compatible— y la superficie de cliente, que filtra los productos
// dentro de cada uno. Vivían en el entrypoint, y por eso hubo que sacarlos antes
// de mover las pantallas: importarlos desde `App.tsx` habría cerrado un ciclo.
//
// **Un alérgeno sin declarar no es un alérgeno ausente.** El predicado excluye
// un producto cuando el alérgeno evitado aparece en su lista; si un comercio no
// declaró nada, el producto pasa el filtro. Esa incertidumbre es del dato, no
// del código, y la interfaz la muestra en lugar de esconderla.
import type { DietaryPreferences, MenuItem } from "./types";

export const dietOptions = [
  { code: "vegetarian", name: "Vegetariano" },
  { code: "vegan", name: "Vegano" },
  { code: "gluten_free", name: "Sin gluten" },
  { code: "halal", name: "Halal" },
  { code: "kosher", name: "Kosher" },
];

export const allergenOptions = [
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

export const itemMatchesDietary = (item: MenuItem, preferences: DietaryPreferences) => {
  const diets = new Set((item.dietaryLabels || []).map((entry) => entry.code)),
    allergens = new Set((item.allergens || []).map((entry) => entry.code));
  return (
    preferences.dietaryLabels.every((entry) => diets.has(entry.code)) &&
    !preferences.avoidedAllergens.some((entry) => allergens.has(entry.code))
  );
};
