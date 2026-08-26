import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  Marker,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoPoint } from "../types";

const ROUTE_SOURCE_ID = "flash-route";
const ROUTE_CASING_ID = "flash-route-casing";
const ROUTE_LINE_ID = "flash-route-line";

const openStreetMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    "open-street-map": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "open-street-map",
      type: "raster",
      source: "open-street-map",
      paint: {
        "raster-saturation": -0.42,
        "raster-contrast": 0.08,
        "raster-brightness-min": 0.08,
        "raster-brightness-max": 0.97,
        "raster-fade-duration": 180,
      },
    },
  ],
};

type FlashMapProps = {
  origin: GeoPoint;
  destination: GeoPoint;
  route?: GeoPoint[];
  driver?: GeoPoint | null;
  className?: string;
  ariaLabel?: string;
  caption?: string;
  detail?: string;
  interactive?: boolean;
  routeColor?: string;
};

function isGeoPoint(value: GeoPoint | null | undefined): value is GeoPoint {
  return Boolean(
    value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lng) &&
      value.lat >= -90 &&
      value.lat <= 90 &&
      value.lng >= -180 &&
      value.lng <= 180,
  );
}

function configuredStyle(): StyleSpecification | string {
  const configured = import.meta.env.VITE_MAP_STYLE_URL?.trim();
  if (!configured) return openStreetMapStyle;
  try {
    const parsed = new URL(configured, window.location.origin);
    if (parsed.protocol === "https:" || parsed.origin === window.location.origin) {
      return parsed.href;
    }
  } catch {
    // An invalid public style URL must not break the map runtime.
  }
  return openStreetMapStyle;
}

function routeFeature(points: GeoPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: points.map((point) => [point.lng, point.lat]),
    },
  };
}

function markerElement(kind: "origin" | "destination" | "driver", label: string) {
  const element = document.createElement("div");
  element.className = `flash-map-marker flash-map-marker--${kind}`;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", label);
  const core = document.createElement("span");
  core.setAttribute("aria-hidden", "true");
  element.append(core);
  return element;
}

export default function FlashMap({
  origin,
  destination,
  route = [],
  driver = null,
  className = "order-tracking-map",
  ariaLabel = "Mapa interactivo del recorrido",
  caption,
  detail,
  interactive = true,
  routeColor = "#7c3cff",
}: FlashMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const reducedMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );
  const validRoute = useMemo(() => route.filter(isGeoPoint), [route]);
  const visiblePoints = useMemo(
    () => [origin, destination, ...validRoute, ...(isGeoPoint(driver) ? [driver] : [])],
    [origin, destination, validRoute, driver],
  );

  const fitRoute = useCallback(
    (duration = reducedMotion ? 0 : 650) => {
      const map = mapRef.current;
      if (!map || !visiblePoints.length) return;
      const first = visiblePoints[0];
      const bounds = new maplibregl.LngLatBounds([first.lng, first.lat], [first.lng, first.lat]);
      visiblePoints.slice(1).forEach((point) => bounds.extend([point.lng, point.lat]));
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 42, right: 42, bottom: caption || detail ? 104 : 42, left: 42 },
        maxZoom: 15.5,
        duration,
      });
    },
    [caption, detail, reducedMotion, visiblePoints],
  );

  useEffect(() => {
    if (!containerRef.current || !isGeoPoint(origin) || !isGeoPoint(destination)) return;
    setReady(false);
    setError("");
    let disposed = false;
    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: configuredStyle(),
        center: [origin.lng, origin.lat],
        zoom: 13,
        minZoom: 3,
        maxZoom: 19,
        attributionControl: false,
        cooperativeGestures: interactive && window.matchMedia?.("(pointer: fine)").matches,
        dragPan: interactive,
        scrollZoom: interactive,
        touchZoomRotate: interactive,
        keyboard: interactive,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        renderWorldCopies: false,
        trackResize: true,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "top-right");
      map.once("load", () => {
        if (disposed) return;
        map.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data: routeFeature([]),
        });
        map.addLayer({
          id: ROUTE_CASING_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "rgba(255,255,255,.98)", "line-width": 10 },
        });
        map.addLayer({
          id: ROUTE_LINE_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": routeColor, "line-width": 5 },
        });
        setError("");
        setReady(true);
      });
      map.on("error", () => {
        if (!disposed && !map.loaded()) {
          setError("La cartografía no está disponible en este momento.");
        }
      });
    } catch {
      setError("Este dispositivo no pudo iniciar el mapa interactivo.");
    }
    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [destination.lat, destination.lng, interactive, origin.lat, origin.lng, routeColor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(routeFeature(validRoute.length > 1 ? validRoute : []));

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [
      new maplibregl.Marker({ element: markerElement("origin", "Punto de partida") })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map),
      new maplibregl.Marker({ element: markerElement("destination", "Destino") })
        .setLngLat([destination.lng, destination.lat])
        .addTo(map),
    ];
    if (isGeoPoint(driver)) {
      markersRef.current.push(
        new maplibregl.Marker({
          element: markerElement("driver", "Última ubicación del conductor"),
        })
          .setLngLat([driver.lng, driver.lat])
          .addTo(map),
      );
    }
    fitRoute(0);
  }, [destination, driver, fitRoute, origin, ready, validRoute]);

  return (
    <section className={`${className} flash-map-shell`} aria-label={ariaLabel}>
      <div ref={containerRef} className="flash-map-canvas" />
      {!ready && !error && (
        <div className="flash-map-state" role="status">
          <span className="flash-map-loader" aria-hidden="true" />
          <strong>Cargando mapa interactivo…</strong>
        </div>
      )}
      {error && (
        <div className="flash-map-state flash-map-state--error" role="status">
          <strong>Ruta operativa disponible</strong>
          <span>{error} El estado y la cotización siguen siendo válidos.</span>
        </div>
      )}
      {ready && interactive && (
        <button
          className="flash-map-recenter"
          type="button"
          aria-label="Volver a encuadrar todo el recorrido"
          onClick={() => fitRoute()}
        >
          <span aria-hidden="true" />
        </button>
      )}
      {(caption || detail) && (
        <div className="tracking-map-caption flash-map-caption">
          {caption && <strong>{caption}</strong>}
          {detail && <span>{detail}</span>}
        </div>
      )}
    </section>
  );
}
