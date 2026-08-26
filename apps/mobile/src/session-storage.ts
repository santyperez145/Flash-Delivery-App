import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type MobileSession = { accessToken: string; refreshToken: string; driverId: string | null };
const SECURE_KEY = "flash.mobile.session.v2",
  LEGACY_KEY = "flash.mobile.session.v1";

export async function saveMobileSession(session: MobileSession | null) {
  const encoded = session ? JSON.stringify(session) : null;
  if (Platform.OS === "web") {
    if (encoded) await AsyncStorage.setItem(SECURE_KEY, encoded);
    else await AsyncStorage.removeItem(SECURE_KEY);
  } else if (encoded)
    await SecureStore.setItemAsync(SECURE_KEY, encoded, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  else await SecureStore.deleteItemAsync(SECURE_KEY);
  if (!session) await AsyncStorage.removeItem(LEGACY_KEY);
}

export async function loadMobileSession(): Promise<MobileSession | null> {
  const encoded =
    Platform.OS === "web"
      ? await AsyncStorage.getItem(SECURE_KEY)
      : await SecureStore.getItemAsync(SECURE_KEY);
  if (encoded) {
    try {
      const value = JSON.parse(encoded) as Partial<MobileSession>;
      if (value.refreshToken)
        return {
          accessToken: value.accessToken || "",
          refreshToken: value.refreshToken,
          driverId: value.driverId || null,
        };
    } catch {}
  }
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (!legacy) return null;
  try {
    const value = JSON.parse(legacy) as { refreshToken?: string };
    if (!value.refreshToken) return null;
    const migrated = { accessToken: "", refreshToken: value.refreshToken, driverId: null };
    await saveMobileSession(migrated);
    await AsyncStorage.removeItem(LEGACY_KEY);
    return migrated;
  } catch {
    return null;
  }
}

export const mobileSessionStorage =
  Platform.OS === "web" ? "web-async-storage" : "native-keychain-keystore";
