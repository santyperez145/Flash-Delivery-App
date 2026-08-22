import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, type LatLng, type Region } from "react-native-maps";
import type { GeoPoint } from "./types";

type FlashNativeMapProps = {
  origin: GeoPoint;
  destination: GeoPoint;
  route?: GeoPoint[];
  driver?: GeoPoint | null;
  caption: string;
  detail: string;
  routeColor?: string;
  driverIcon?: "car-sport" | "bicycle";
  height?: number;
  accessibilityLabel?: string;
};

const flashGoogleMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#f1eff3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#5f5964" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8f7f9" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#e8e4ec" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#dcecdf" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#ddd9e1" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#eee4d7" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#ded9e2" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9e2e8" }] },
];

function valid(point: GeoPoint | null | undefined): point is GeoPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lng >= -180 &&
      point.lng <= 180,
  );
}

function coordinate(point: GeoPoint): LatLng {
  return { latitude: point.lat, longitude: point.lng };
}

function initialRegion(points: GeoPoint[]): Region {
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lng);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max((maxLatitude - minLatitude) * 1.5, 0.012),
    longitudeDelta: Math.max((maxLongitude - minLongitude) * 1.5, 0.012),
  };
}

export default function FlashNativeMap({
  origin,
  destination,
  route = [],
  driver = null,
  caption,
  detail,
  routeColor = "#7c3cff",
  driverIcon = "car-sport",
  height = 260,
  accessibilityLabel = "Mapa interactivo del recorrido",
}: FlashNativeMapProps) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const validRoute = useMemo(() => route.filter(valid), [route]);
  const visiblePoints = useMemo(
    () => [origin, destination, ...validRoute, ...(valid(driver) ? [driver] : [])],
    [destination, driver, origin, validRoute],
  );
  const coordinates = useMemo(() => visiblePoints.map(coordinate), [visiblePoints]);
  const region = useMemo(() => initialRegion(visiblePoints), [visiblePoints]);

  const fit = useCallback(
    (animated = true) => {
      if (!mapRef.current || coordinates.length < 2) return;
      mapRef.current.fitToCoordinates(coordinates, {
        animated,
        edgePadding: { top: 86, right: 42, bottom: 42, left: 42 },
      });
    },
    [coordinates],
  );

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => fit(false), 80);
    return () => clearTimeout(timer);
  }, [fit, ready]);

  if (Platform.OS === "web") {
    return (
      <View style={[styles.shell, styles.webFallback, { height }]} accessibilityLabel={accessibilityLabel}>
        <Ionicons name="map-outline" size={28} color="#7c3cff" />
        <Text style={styles.webFallbackTitle}>Mapa nativo disponible en Android y iOS</Text>
        <Text style={styles.webFallbackText}>{caption} · {detail}</Text>
      </View>
    );
  }

  if (
    Platform.OS === "android" &&
    Constants.expoConfig?.extra?.maps?.androidGoogleMapsConfigured !== true
  ) {
    return (
      <View style={[styles.shell, styles.webFallback, { height }]} accessibilityLabel={accessibilityLabel}>
        <Ionicons name="map-outline" size={28} color="#7c3cff" />
        <Text style={styles.webFallbackTitle}>Mapa Android pendiente de configuración</Text>
        <Text style={styles.webFallbackText}>
          Configurá la clave restringida de Google Maps y generá un nuevo build. {caption} · {detail}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.shell, { height }]} accessibilityLabel={accessibilityLabel}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
        customMapStyle={Platform.OS === "android" ? flashGoogleMapStyle : undefined}
        loadingEnabled
        loadingBackgroundColor="#ece9ef"
        loadingIndicatorColor="#7c3cff"
        mapPadding={{ top: 76, right: 12, bottom: 12, left: 12 }}
        pitchEnabled={false}
        rotateEnabled={false}
        showsCompass={false}
        showsScale={false}
        showsTraffic={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        onMapReady={() => setReady(true)}
      >
        {validRoute.length > 1 && (
          <>
            <Polyline coordinates={validRoute.map(coordinate)} strokeColor="rgba(255,255,255,.98)" strokeWidth={10} lineCap="round" lineJoin="round" />
            <Polyline coordinates={validRoute.map(coordinate)} strokeColor={routeColor} strokeWidth={5} lineCap="round" lineJoin="round" />
          </>
        )}
        <Marker coordinate={coordinate(origin)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={styles.originMarker}><View style={styles.originCore} /></View>
        </Marker>
        <Marker coordinate={coordinate(destination)} anchor={{ x: 0.5, y: 0.84 }} tracksViewChanges={false}>
          <View style={styles.destinationMarker}><Ionicons name="flag" size={16} color="#fff" /></View>
        </Marker>
        {valid(driver) && (
          <Marker coordinate={coordinate(driver)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.driverMarker}><Ionicons name={driverIcon} size={20} color="#fff" /></View>
          </Marker>
        )}
      </MapView>
      <View style={styles.caption} pointerEvents="none">
        <Text style={styles.captionTitle} numberOfLines={1}>{caption}</Text>
        <Text style={styles.captionDetail} numberOfLines={1}>{detail}</Text>
      </View>
      <Pressable style={styles.recenter} onPress={() => fit(true)} accessibilityRole="button" accessibilityLabel="Reencuadrar todo el recorrido">
        <Ionicons name="scan-outline" size={21} color="#7c3cff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: "#e9e7ed",
    borderWidth: 1,
    borderColor: "#ded9e3",
  },
  caption: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 54,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,.94)",
    shadowColor: "#23192f",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  captionTitle: { color: "#17131c", fontSize: 12, fontWeight: "900" },
  captionDetail: { color: "#716a76", fontSize: 10, fontWeight: "700" },
  recenter: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#fff",
    shadowColor: "#23192f",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  originMarker: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "#17131c",
    borderWidth: 3,
    borderColor: "#fff",
  },
  originCore: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  destinationMarker: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#087a50",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#111",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 5,
  },
  driverMarker: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "#ff6a21",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#111",
    shadowOpacity: 0.24,
    shadowRadius: 9,
    elevation: 6,
  },
  webFallback: { alignItems: "center", justifyContent: "center", gap: 7, padding: 24 },
  webFallbackTitle: { color: "#17131c", fontSize: 13, fontWeight: "900", textAlign: "center" },
  webFallbackText: { color: "#716a76", fontSize: 11, fontWeight: "600", lineHeight: 16, textAlign: "center" },
});
