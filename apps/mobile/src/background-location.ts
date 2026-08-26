import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { loadMobileSession, saveMobileSession } from "./session-storage";

const TASK_NAME = "flash-driver-background-location-v1";
declare const process: { env?: { EXPO_PUBLIC_API_URL?: string } };
const API_BASE = process.env?.EXPO_PUBLIC_API_URL || "http://127.0.0.1:4000/api";

async function sendLocation(driverId: string, location: Location.LocationObject) {
  let session = await loadMobileSession();
  if (!session?.refreshToken) return;
  const body = JSON.stringify({
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    label: "Ubicación background",
    source: "background",
    accuracyM: location.coords.accuracy ?? undefined,
  });
  const deliver = (accessToken: string) =>
    fetch(`${API_BASE}/drivers/${driverId}/location`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body,
    });
  let response = session.accessToken ? await deliver(session.accessToken) : null;
  if (!response || response.status === 401) {
    const attempted = session.refreshToken,
      refreshed = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: attempted, deviceName: "Flash Driver Background" }),
      });
    if (!refreshed.ok) {
      const concurrent = await loadMobileSession();
      if (
        concurrent?.refreshToken &&
        concurrent.refreshToken !== attempted &&
        concurrent.accessToken
      ) {
        session = concurrent;
        response = await deliver(concurrent.accessToken);
      } else {
        await saveMobileSession(null);
        return;
      }
    } else {
      const tokens = (await refreshed.json()) as { token: string; refreshToken: string };
      session = { ...session, accessToken: tokens.token, refreshToken: tokens.refreshToken };
      await saveMobileSession(session);
      response = await deliver(tokens.token);
    }
  }
  if (!response.ok && response.status !== 409)
    throw new Error(`background location rejected: ${response.status}`);
}

TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const locations = (data as { locations?: Location.LocationObject[] }).locations || [],
    latest = locations.at(-1),
    session = await loadMobileSession();
  if (!latest || !session?.driverId) return;
  await sendLocation(session.driverId, latest);
});

export type BackgroundLocationState = "active" | "foreground_only" | "denied" | "stopped";
export async function getBackgroundLocationState(): Promise<BackgroundLocationState> {
  if (Platform.OS === "web" || !(await TaskManager.isAvailableAsync())) return "foreground_only";
  if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) return "active";
  const permission = await Location.getBackgroundPermissionsAsync();
  return permission.status === "denied" ? "denied" : "stopped";
}
export async function startDriverBackgroundLocation(): Promise<BackgroundLocationState> {
  if (Platform.OS === "web" || !(await TaskManager.isAvailableAsync())) return "foreground_only";
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted") return "denied";
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted") return "foreground_only";
  if (!(await Location.hasStartedLocationUpdatesAsync(TASK_NAME)))
    await Location.startLocationUpdatesAsync(TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 40,
      deferredUpdatesInterval: 15000,
      deferredUpdatesDistance: 40,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Flash Driver activo",
        notificationBody: "Compartiendo ubicación para asignaciones y seguimiento",
        notificationColor: "#7c3cff",
        killServiceOnDestroy: false,
      },
    });
  return "active";
}
export async function stopDriverBackgroundLocation() {
  if (Platform.OS !== "web" && (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)))
    await Location.stopLocationUpdatesAsync(TASK_NAME);
  return "stopped" as const;
}
