import type { CatalogVertical, MerchantVertical, Restaurant } from "./types";

// El catálogo público, aparte de `api.ts` (P-01).
//
// Vive en su propio módulo porque `api.ts` es un monolito identificado en el
// hallazgo H-08 y ningún cambio lo hace crecer. Recibe `request` en lugar de
// importarlo para no crear un ciclo entre los dos archivos.
type Request = <T>(path: string, init?: RequestInit) => Promise<T>;
type CatalogPage = { restaurants: Restaurant[]; nextCursor: string | null };

export function createCatalogApi(request: Request) {
  const getPage = (cursor?: string, limit = 20, query = "", vertical?: MerchantVertical) => {
    const params = new URLSearchParams({
      limit: String(limit),
      ...(cursor ? { cursor } : {}),
      ...(query ? { q: query } : {}),
      ...(vertical ? { vertical } : {}),
    });
    return request<CatalogPage>(`/catalog/restaurants?${params}`);
  };

  const getVerticals = () => request<{ verticals: CatalogVertical[] }>("/catalog/verticals");

  /**
   * La portada: la primera página de **cada** rubro con comercios.
   *
   * Pedir una sola página del catálogo mezclado dejaba afuera a cualquier rubro
   * cuyos comercios se dieron de alta después de los primeros cincuenta: la
   * farmacia existía en la base y no en la app. Una página por rubro garantiza
   * que cada acceso de la portada abra algo.
   *
   * Si el resumen de rubros falla, se vuelve a la página única: la portada se
   * degrada a lo que mostraba antes en lugar de quedar vacía.
   */
  const getHome = async (limit = 50): Promise<CatalogPage> => {
    const verticals = await getVerticals()
      .then((response) => response.verticals)
      .catch(() => [] as CatalogVertical[]);
    if (verticals.length <= 1) return getPage(undefined, limit);
    const pages = await Promise.all(
      verticals.map(({ vertical }) =>
        getPage(undefined, vertical === "restaurant" ? limit : 20, "", vertical),
      ),
    );
    const vistos = new Set<string>();
    const restaurants = pages
      .flatMap((page) => page.restaurants)
      .filter((restaurant) => !vistos.has(restaurant.id) && Boolean(vistos.add(restaurant.id)));
    const restaurantes = verticals.findIndex(({ vertical }) => vertical === "restaurant");
    return { restaurants, nextCursor: restaurantes >= 0 ? pages[restaurantes].nextCursor : null };
  };

  return { getPage, getVerticals, getHome };
}
