// Registro del dispositivo para push (ticket NOT-001, hallazgo H-02).
//
// El servidor puede enviar notificaciones desde el 26 de agosto: hay proveedor
// Expo, cola, reintentos, recibos y dead letters. `POST /api/devices` existe,
// está auditado y tiene su suite.
//
// Lo que faltaba es el otro extremo. **`expo-notifications` no era ni siquiera
// una dependencia del móvil**, así que ningún dispositivo obtenía un token y
// ninguno se registraba nunca. El servidor podía enviar notificaciones que nadie
// podía recibir, y la cadena quedaba cortada justo en el eslabón que no se ve:
// no fallaba nada, simplemente no llegaba nada.
//
// Lo encontró `test:api-wiring` al listar las tres rutas de `/api/devices` como
// huérfanas.
//
// **La huella del dispositivo es un identificador aleatorio guardado, no uno de
// hardware.** Un identificador de hardware es estable pero también es un rastro
// que sigue a la persona entre instalaciones, y no hace falta: lo único que se
// necesita es distinguir dos dispositivos de la misma cuenta y reconocer al
// mismo cuando vuelve. El servidor además lo guarda como HMAC, nunca en claro.
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

const CLAVE_HUELLA = "flash.device.fingerprint";

/**
 * Motivos por los que el registro no ocurre. Se devuelven en lugar de lanzar:
 * quedarse sin push es una degradación, no un error de sesión, y hacer fallar el
 * login porque un simulador no puede recibir notificaciones sería peor que no
 * tenerlas.
 */
export type ResultadoRegistro =
  | { registrado: true; plataforma: "ios" | "android" }
  | {
      registrado: false;
      motivo: "sin-dispositivo-fisico" | "permiso-denegado" | "sin-proyecto" | "error";
    };

async function huellaEstable(): Promise<string> {
  const guardada = await SecureStore.getItemAsync(CLAVE_HUELLA).catch(() => null);
  if (guardada) return guardada;
  // `randomUUID` existe en Hermes desde RN 0.74, pero los tipos de React Native
  // no declaran `crypto` en el global, así que se lee con un acceso tipado en vez
  // de asumirlo. El respaldo por tiempo no es criptográfico y no necesita serlo:
  // esto distingue dispositivos, no autentica a ninguno.
  const aleatorio = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto?.randomUUID?.();
  // El prefijo mantiene el mínimo de 8 caracteres que exige el esquema del
  // servidor aunque el identificador viniera corto.
  const nueva = `flash-${aleatorio ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  await SecureStore.setItemAsync(CLAVE_HUELLA, nueva).catch(() => undefined);
  return nueva;
}

/**
 * Pide permiso, obtiene el token de Expo y registra el dispositivo.
 *
 * Se llama después del login porque la ruta exige sesión. Pedir el permiso antes
 * gastaría el único momento en que iOS lo pregunta, en una pantalla donde la
 * persona todavía no sabe para qué sirve.
 */
export async function registrarDispositivoParaPush(
  enviar: (cuerpo: {
    platform: "ios" | "android";
    pushToken: string;
    appVersion?: string;
    deviceFingerprint: string;
  }) => Promise<unknown>,
): Promise<ResultadoRegistro> {
  // Un simulador no recibe push. No es un error: es el caso normal en
  // desarrollo, y tratarlo como falla llenaría los logs de ruido.
  if (!Device.isDevice) return { registrado: false, motivo: "sin-dispositivo-fisico" };
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return { registrado: false, motivo: "sin-dispositivo-fisico" };
  }

  try {
    const actual = await Notifications.getPermissionsAsync();
    let concedido = actual.granted;
    // `canAskAgain` en false significa que la persona ya dijo que no y iOS no
    // volverá a preguntar. Insistir abre un diálogo que nunca aparece.
    if (!concedido && actual.canAskAgain) {
      concedido = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!concedido) return { registrado: false, motivo: "permiso-denegado" };

    // En Android el canal tiene que existir antes del primer push o el sistema
    // lo entrega sin sonido ni prioridad.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Actualizaciones de servicio",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    // Sin `projectId` el servicio de Expo no puede emitir un token. Pasa en un
    // build que no salió de EAS, y decirlo por su nombre ahorra el rato de
    // buscar un bug de permisos que no existe.
    if (!projectId) return { registrado: false, motivo: "sin-proyecto" };

    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    await enviar({
      platform: Platform.OS,
      pushToken,
      appVersion: Constants.expoConfig?.version,
      deviceFingerprint: await huellaEstable(),
    });
    return { registrado: true, plataforma: Platform.OS };
  } catch {
    return { registrado: false, motivo: "error" };
  }
}
