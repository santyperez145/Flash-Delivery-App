import { useEffect, useState } from "react";

import { api } from "../api";
import type { GeoPoint, RoadRoute } from "../types";

export function useTrackingRoute({
  resourceId,
  origin,
  destination,
  errorMessage,
}: {
  resourceId: string | null | undefined;
  origin: GeoPoint | null | undefined;
  destination: GeoPoint | null | undefined;
  errorMessage: string;
}) {
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeError, setRouteError] = useState("");

  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      setRouteError("");
      return;
    }
    let cancelled = false;
    setRoute(null);
    setRouteError("");
    void api
      .route(origin, destination)
      .then((result) => {
        if (!cancelled) setRoute(result.route);
      })
      .catch(() => {
        if (!cancelled) {
          setRoute(null);
          setRouteError(errorMessage);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resourceId, origin?.lat, origin?.lng, destination?.lat, destination?.lng, errorMessage]);

  return { route, routeError, hasMap: Boolean(origin && destination) };
}
