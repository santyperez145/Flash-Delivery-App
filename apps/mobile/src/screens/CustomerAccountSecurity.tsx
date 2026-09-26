// Seguridad de cuenta: teléfono y sesiones (ARC-001).
//
// Uber y DoorDash aíslan verificación y dispositivos de pagos y soporte.
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { AccountSession, User } from "../types";
import type { AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountSecurity({
  user,
  busy,
  runAction,
  phoneVerified,
  setPhoneVerified,
  phoneVerificationCode,
  setPhoneVerificationCode,
  phoneRetrySeconds,
  setPhoneRetrySeconds,
  accountSessions,
  setAccountSessions,
}: {
  user: User;
  busy: boolean;
  runAction: AccountRunAction;
  phoneVerified: boolean;
  setPhoneVerified: (value: boolean) => void;
  phoneVerificationCode: string;
  setPhoneVerificationCode: (value: string) => void;
  phoneRetrySeconds: number;
  setPhoneRetrySeconds: (value: number) => void;
  accountSessions: AccountSession[];
  setAccountSessions: (
    value: AccountSession[] | ((current: AccountSession[]) => AccountSession[]),
  ) => void;
}) {
  return (
    <>
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View style={styles.savedAddressCopy}>
            <Text style={styles.foodRestaurantTitle}>Teléfono de seguridad</Text>
            <Text style={styles.cardText}>
              {user.phone || "Agregá un teléfono internacional desde tu perfil."}
            </Text>
          </View>
          <Ionicons
            name={phoneVerified ? "checkmark-circle" : "shield-outline"}
            size={28}
            color={phoneVerified ? "#087a50" : "#7c3cff"}
          />
        </View>
        {phoneVerified ? (
          <View style={styles.dietarySafetyNote}>
            <Ionicons name="checkmark-circle-outline" size={19} color="#087a50" />
            <Text style={styles.cardText}>
              Número verificado. Si lo cambiás, Flash solicitará una verificación nueva.
            </Text>
          </View>
        ) : user.phone ? (
          <>
            <Text style={styles.cardText}>
              Confirmá que tenés acceso a este número. El código vence en 10 minutos y admite cinco
              intentos.
            </Text>
            <TextInput
              value={phoneVerificationCode}
              onChangeText={(value) =>
                setPhoneVerificationCode(value.replace(/\D/g, "").slice(0, 6))
              }
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={6}
              placeholder="Código de 6 dígitos"
              style={styles.input}
            />
            <Pressable
              disabled={busy || phoneVerificationCode.length !== 6}
              style={[
                styles.primaryButton,
                (busy || phoneVerificationCode.length !== 6) && styles.disabledButton,
              ]}
              onPress={() =>
                runAction(async () => {
                  await api.confirmPhoneVerification(phoneVerificationCode);
                  setPhoneVerified(true);
                  setPhoneVerificationCode("");
                }, "Teléfono verificado")
              }
            >
              <Ionicons name="shield-checkmark-outline" size={19} color="#fff" />
              <Text style={styles.primaryButtonText}>Verificar teléfono</Text>
            </Pressable>
            <Pressable
              disabled={busy || phoneRetrySeconds > 0}
              style={[
                styles.secondaryButton,
                (busy || phoneRetrySeconds > 0) && styles.disabledButton,
              ]}
              onPress={() =>
                runAction(async () => {
                  const result = await api.requestPhoneVerification();
                  setPhoneVerificationCode(result.developmentCode || "");
                  setPhoneRetrySeconds(result.retryAfterSeconds);
                }, "Código solicitado")
              }
            >
              <Ionicons name="chatbubble-ellipses-outline" size={18} color="#7c3cff" />
              <Text style={styles.secondaryButtonText}>
                {phoneRetrySeconds > 0
                  ? `Reenviar en ${phoneRetrySeconds}s`
                  : "Enviar código por SMS"}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View style={styles.savedAddressCopy}>
            <Text style={styles.foodRestaurantTitle}>Dispositivos y sesiones</Text>
            <Text style={styles.cardText}>
              Cerrá accesos que no reconozcas. Flash nunca muestra tus credenciales.
            </Text>
          </View>
          <Ionicons name="shield-checkmark-outline" size={26} color="#087a50" />
        </View>
        {accountSessions.length ? (
          accountSessions.map((session) => (
            <View key={session.id} style={styles.notificationRow}>
              <View style={styles.notificationBell}>
                <Ionicons name="phone-portrait-outline" size={20} color="#fff" />
              </View>
              <View style={styles.savedAddressCopy}>
                <Text style={styles.sectionTitle}>{session.deviceName}</Text>
                <Text style={styles.notificationTime}>
                  Iniciada {new Date(session.createdAt).toLocaleString("es-AR")} · vence{" "}
                  {new Date(session.expiresAt).toLocaleDateString("es-AR")}
                </Text>
              </View>
              <Pressable
                disabled={busy}
                accessibilityLabel={`Cerrar sesión ${session.deviceName}`}
                onPress={() =>
                  Alert.alert("Cerrar sesión", `¿Cerrar el acceso de ${session.deviceName}?`, [
                    { text: "Cancelar", style: "cancel" },
                    {
                      text: "Cerrar",
                      style: "destructive",
                      onPress: () =>
                        runAction(async () => {
                          await api.revokeAccountSession(session.id);
                          setAccountSessions((current) =>
                            current.filter((item) => item.id !== session.id),
                          );
                        }, "Sesión cerrada"),
                    },
                  ])
                }
              >
                <Ionicons name="log-out-outline" size={21} color="#c43b36" />
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.cardText}>No hay otras sesiones activas para mostrar.</Text>
        )}
        {accountSessions.length > 1 ? (
          <Pressable
            disabled={busy}
            style={styles.secondaryButton}
            onPress={() =>
              Alert.alert(
                "Proteger cuenta",
                "Se cerrarán todas las sesiones excepto la de este dispositivo.",
                [
                  { text: "Cancelar", style: "cancel" },
                  {
                    text: "Cerrar las demás",
                    style: "destructive",
                    onPress: () =>
                      runAction(async () => {
                        await api.revokeOtherAccountSessions();
                        const result = await api.getAccountSessions();
                        setAccountSessions(result.sessions);
                      }, "Las demás sesiones fueron cerradas"),
                  },
                ],
              )
            }
          >
            <Ionicons name="lock-closed-outline" size={18} color="#7c3cff" />
            <Text style={styles.secondaryButtonText}>Cerrar las demás sesiones</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
