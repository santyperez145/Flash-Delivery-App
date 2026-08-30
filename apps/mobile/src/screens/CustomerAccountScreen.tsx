// Cuenta del cliente (ARC-001): seguridad, soporte, preferencias y medios persistidos.
// Se mantiene montada al cambiar de pestaña para no descartar formularios en curso.
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { SubscriptionCard } from "../SubscriptionCard";
import { money } from "../format";
import { styles } from "../styles";
import type {
  AccountSession,
  AppNotification,
  AppState,
  DietaryPreferences,
  GeoPoint,
  NotificationPreference,
  ReferralSummary,
  User,
} from "../types";
import { CustomerAddressForm } from "./CustomerAddressForm";

type CustomerAccountScreenProps = {
  visible: boolean;
  state: AppState;
  user: User;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onLogout: () => Promise<void>;
  dietaryPreferences: DietaryPreferences;
  setDietaryPreferences: (preferences: DietaryPreferences) => void;
  onUseAddress: (address: string, point: GeoPoint | null) => void;
};

export function CustomerAccountScreen({
  visible,
  state,
  user,
  busy,
  runAction,
  onLogout,
  dietaryPreferences,
  setDietaryPreferences,
  onUseAddress,
}: CustomerAccountScreenProps) {
  const [paymentToken, setPaymentToken] = useState("");
  const [paymentBrand, setPaymentBrand] = useState<"visa" | "mastercard" | "amex" | "cabal">(
    "visa",
  );
  const [paymentLast4, setPaymentLast4] = useState("");
  const [paymentExpiry, setPaymentExpiry] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [accountSessions, setAccountSessions] = useState<AccountSession[]>([]);
  const [phoneVerificationCode, setPhoneVerificationCode] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(Boolean(user.phoneVerifiedAt));
  const [phoneRetrySeconds, setPhoneRetrySeconds] = useState(0);
  const [referral, setReferral] = useState<ReferralSummary | null>(null);
  const [referralClaim, setReferralClaim] = useState("");
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreference[]>(
    [],
  );
  const [supportSubject, setSupportSubject] = useState("");
  const [supportBody, setSupportBody] = useState("");
  const [supportCategory, setSupportCategory] = useState<
    "food" | "ride" | "shipment" | "payment" | "account" | "safety" | "other"
  >("food");
  const [supportReplies, setSupportReplies] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    Promise.all([
      api.getNotifications(),
      api.getNotificationPreferences(),
      api.getDietaryPreferences(),
      api.getReferralSummary(),
      api.getAccountSessions(),
    ])
      .then(([inbox, settings, dietary, referrals, sessions]) => {
        if (!cancelled) {
          setNotifications(inbox.notifications);
          setNotificationPreferences(settings.preferences);
          setDietaryPreferences(dietary.preferences);
          setReferral(referrals.referral);
          setAccountSessions(sessions.sessions);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, user.id]);

  useEffect(() => {
    if (phoneRetrySeconds <= 0) return;
    const timer = setInterval(() => setPhoneRetrySeconds((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [phoneRetrySeconds > 0]);

  if (!visible) return null;

  return (
    <>
      <View style={styles.customerAccountHeading}>
        <View style={styles.itemCopy}>
          <Text style={styles.foodRestaurantTitle}>Tu cuenta</Text>
          <Text style={styles.cardText}>Datos utilizados por todos los servicios Flash.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar sesión"
          disabled={busy}
          onPress={() => void onLogout()}
          style={({ pressed }) => [
            styles.customerLogoutButton,
            (pressed || busy) && styles.disabledButton,
          ]}
        >
          <Ionicons name="log-out-outline" size={18} color="#27242a" />
          <Text style={styles.customerLogoutText}>Salir</Text>
        </Pressable>
      </View>
      {/* La suscripción va en Cuenta, que es donde la persona ya mira lo
                que paga, y arriba del perfil porque es lo que cambia el precio
                de todo lo demás. */}
      <SubscriptionCard busy={busy} />
      <View style={styles.accountCard}>
        <View style={styles.accountAvatar}>
          <Text style={styles.accountInitial}>{user.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.foodRestaurantTitle}>{user.name}</Text>
        <Text style={styles.cardText}>{user.email}</Text>
        <View style={styles.accountDetail}>
          <Ionicons name="location-outline" size={20} color="#7c3cff" />
          <Text style={styles.cardText}>{user.defaultAddress || "Sin dirección guardada"}</Text>
        </View>
        <View style={styles.accountDetail}>
          <Ionicons name="wallet-outline" size={20} color="#7c3cff" />
          <Text style={styles.totalText}>Wallet {money.format(user.wallet)}</Text>
        </View>
      </View>
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
      {referral && (
        <View style={styles.addressBookCard}>
          <View style={styles.addressBookHeading}>
            <View style={styles.savedAddressCopy}>
              <Text style={styles.foodRestaurantTitle}>Invitá y ganá</Text>
              <Text style={styles.cardText}>
                {referral.campaign
                  ? `Vos recibís ${money.format(referral.campaign.advocateReward)} y tu amistad ${money.format(referral.campaign.friendReward)} después de su primer servicio pagado.`
                  : "No hay una campaña activa ahora."}
              </Text>
            </View>
            <Ionicons name="gift-outline" size={27} color="#7c3cff" />
          </View>
          <View style={styles.shipmentPinCard}>
            <Text style={styles.orderConfirmationEyebrow}>TU CÓDIGO</Text>
            <Text style={styles.referralCode}>{referral.code}</Text>
            <Text style={styles.helperText}>
              {referral.invited} invitaciones · {referral.rewarded} recompensadas
            </Text>
          </View>
          <Pressable
            disabled={!referral.campaign}
            style={[styles.primaryButton, !referral.campaign && styles.disabledButton]}
            onPress={() =>
              Share.share({
                message: `Sumate a Flash con mi código ${referral.code}. La recompensa se acredita después de tu primer servicio pagado.`,
              })
            }
          >
            <Ionicons name="share-social-outline" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Compartir invitación</Text>
          </Pressable>
          {referral.attribution ? (
            <View style={styles.dietarySafetyNote}>
              <Ionicons
                name={
                  referral.attribution.status === "rewarded"
                    ? "checkmark-circle-outline"
                    : "time-outline"
                }
                size={18}
                color="#087a50"
              />
              <Text style={styles.cardText}>
                {referral.attribution.status === "rewarded"
                  ? "Tu recompensa de referido ya fue acreditada en Wallet."
                  : "Código aplicado. Se acredita al completar tu primer servicio pagado."}
              </Text>
            </View>
          ) : (
            <View style={styles.newAddressForm}>
              <Text style={styles.sectionTitle}>¿Te invitó alguien?</Text>
              <TextInput
                value={referralClaim}
                onChangeText={(value) => setReferralClaim(value.toUpperCase())}
                autoCapitalize="characters"
                maxLength={13}
                placeholder="FLASHXXXXXXXX"
                style={styles.input}
              />
              <Pressable
                disabled={busy || !/^FLASH[A-Z0-9]{8}$/.test(referralClaim)}
                style={[
                  styles.primaryButton,
                  (busy || !/^FLASH[A-Z0-9]{8}$/.test(referralClaim)) && styles.disabledButton,
                ]}
                onPress={() =>
                  runAction(async () => {
                    const result = await api.claimReferral(referralClaim);
                    setReferral(result.referral);
                    setReferralClaim("");
                  }, "Código aplicado; la recompensa queda pendiente del primer servicio")
                }
              >
                <Ionicons name="ticket-outline" size={19} color="#fff" />
                <Text style={styles.primaryButtonText}>Aplicar código</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View>
            <Text style={styles.foodRestaurantTitle}>Preferencias alimentarias</Text>
            <Text style={styles.cardText}>
              Se guardan en tu cuenta y ayudan a ocultar incompatibles.
            </Text>
          </View>
          <Ionicons name="leaf-outline" size={25} color="#087a50" />
        </View>
        <Text style={styles.sectionTitle}>Mi alimentación</Text>
        <View style={styles.dietaryPreferenceGrid}>
          {[
            { code: "vegetarian", name: "Vegetariano" },
            { code: "vegan", name: "Vegano" },
            { code: "gluten_free", name: "Sin gluten" },
            { code: "halal", name: "Halal" },
            { code: "kosher", name: "Kosher" },
          ].map((option) => {
            const selected = dietaryPreferences.dietaryLabels.some(
              (entry) => entry.code === option.code,
            );
            return (
              <Pressable
                key={option.code}
                style={[
                  styles.dietaryPreferenceChip,
                  selected && styles.dietaryPreferenceChipActive,
                ]}
                onPress={() => {
                  const dietaryLabels = selected
                    ? dietaryPreferences.dietaryLabels
                        .filter((entry) => entry.code !== option.code)
                        .map((entry) => entry.code)
                    : [...dietaryPreferences.dietaryLabels.map((entry) => entry.code), option.code];
                  runAction(async () => {
                    const result = await api.updateDietaryPreferences({
                      dietaryLabels,
                      avoidedAllergens: dietaryPreferences.avoidedAllergens.map(
                        (entry) => entry.code,
                      ),
                      hideIncompatible: dietaryPreferences.hideIncompatible,
                    });
                    setDietaryPreferences(result.preferences);
                  }, "Preferencias alimentarias actualizadas");
                }}
              >
                <Text
                  style={[
                    styles.dietaryPreferenceText,
                    selected && styles.dietaryPreferenceTextActive,
                  ]}
                >
                  {option.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.sectionTitle}>Evito estos alérgenos</Text>
        <View style={styles.dietaryPreferenceGrid}>
          {[
            { code: "gluten", name: "Gluten" },
            { code: "milk", name: "Leche" },
            { code: "eggs", name: "Huevo" },
            { code: "peanuts", name: "Maní" },
            { code: "tree_nuts", name: "Frutos secos" },
            { code: "soy", name: "Soja" },
            { code: "fish", name: "Pescado" },
            { code: "shellfish", name: "Crustáceos" },
            { code: "sesame", name: "Sésamo" },
          ].map((option) => {
            const selected = dietaryPreferences.avoidedAllergens.some(
              (entry) => entry.code === option.code,
            );
            return (
              <Pressable
                key={option.code}
                style={[styles.dietaryPreferenceChip, selected && styles.dietaryAllergenChipActive]}
                onPress={() => {
                  const avoidedAllergens = selected
                    ? dietaryPreferences.avoidedAllergens
                        .filter((entry) => entry.code !== option.code)
                        .map((entry) => entry.code)
                    : [
                        ...dietaryPreferences.avoidedAllergens.map((entry) => entry.code),
                        option.code,
                      ];
                  runAction(async () => {
                    const result = await api.updateDietaryPreferences({
                      dietaryLabels: dietaryPreferences.dietaryLabels.map((entry) => entry.code),
                      avoidedAllergens,
                      hideIncompatible: dietaryPreferences.hideIncompatible,
                    });
                    setDietaryPreferences(result.preferences);
                  }, "Alérgenos actualizados");
                }}
              >
                <Text
                  style={[
                    styles.dietaryPreferenceText,
                    selected && styles.dietaryAllergenTextActive,
                  ]}
                >
                  {option.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.preferenceRow}>
          <View style={styles.savedAddressCopy}>
            <Text style={styles.sectionTitle}>Ocultar productos incompatibles</Text>
            <Text style={styles.cardText}>
              Sólo usa declaraciones del comercio; “sin datos” nunca significa seguro.
            </Text>
          </View>
          <Pressable
            disabled={busy}
            accessibilityRole="switch"
            accessibilityState={{ checked: dietaryPreferences.hideIncompatible }}
            style={[
              styles.preferenceSwitch,
              dietaryPreferences.hideIncompatible && styles.preferenceSwitchActive,
            ]}
            onPress={() =>
              runAction(async () => {
                const result = await api.updateDietaryPreferences({
                  dietaryLabels: dietaryPreferences.dietaryLabels.map((entry) => entry.code),
                  avoidedAllergens: dietaryPreferences.avoidedAllergens.map((entry) => entry.code),
                  hideIncompatible: !dietaryPreferences.hideIncompatible,
                });
                setDietaryPreferences(result.preferences);
              }, "Filtro alimentario actualizado")
            }
          >
            <View
              style={[
                styles.preferenceKnob,
                dietaryPreferences.hideIncompatible && styles.preferenceKnobActive,
              ]}
            />
          </Pressable>
        </View>
        <View style={styles.dietarySafetyNote}>
          <Ionicons name="information-circle-outline" size={18} color="#9a4b00" />
          <Text style={styles.allergenWarningText}>
            Ante una alergia severa, confirmá siempre con el comercio. Las indicaciones de cocina no
            eliminan contaminación cruzada.
          </Text>
        </View>
      </View>
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View>
            <Text style={styles.foodRestaurantTitle}>Notificaciones</Text>
            <Text style={styles.cardText}>
              {notifications.filter((item) => !item.readAt).length} sin leer · historial persistente
            </Text>
          </View>
          <View style={styles.notificationBell}>
            <Ionicons name="notifications-outline" size={22} color="#fff" />
          </View>
        </View>
        {notifications.slice(0, 8).map((item) => {
          const titles: Record<string, string> = {
            order_status: "Actualización del pedido",
            ride_status: "Actualización del viaje",
            shipment_status: "Actualización del envío",
            order_substitution: "El comercio propone un cambio",
            order_issue_resolved: "Incidencia resuelta",
            tip_received: "Recibiste una propina",
            support_reply: "Nueva respuesta de soporte",
            support_ticket_created: "Caso de soporte creado",
          };
          return (
            <Pressable
              key={item.id}
              disabled={Boolean(item.readAt) || busy}
              onPress={() =>
                runAction(async () => {
                  const result = await api.markNotificationRead(item.id);
                  setNotifications(result.notifications);
                }, "Notificación leída")
              }
              style={[styles.notificationRow, !item.readAt && styles.notificationUnread]}
            >
              <View style={styles.notificationStatusDot} />
              <View style={styles.savedAddressCopy}>
                <Text style={styles.sectionTitle}>
                  {titles[item.template] || "Novedad de Flash"}
                </Text>
                <Text style={styles.cardText}>
                  {String(
                    item.payload.status || item.payload.kind || "Revisá la actividad de tu cuenta",
                  )}
                </Text>
                <Text style={styles.notificationTime}>
                  {new Date(item.createdAt).toLocaleString("es-AR")}
                </Text>
              </View>
              {!item.readAt && <Text style={styles.notificationNew}>NUEVA</Text>}
            </Pressable>
          );
        })}
        {!notifications.length && (
          <View style={styles.notificationEmpty}>
            <Ionicons name="checkmark-circle-outline" size={27} color="#087a50" />
            <Text style={styles.cardText}>Estás al día. Las novedades reales aparecerán acá.</Text>
          </View>
        )}
        <View style={styles.preferenceGroup}>
          <Text style={styles.sectionTitle}>Preferencias push</Text>
          {notificationPreferences.map((preference) => {
            const labels = {
              service_updates: "Servicios",
              promotions: "Promociones",
              support: "Soporte",
              wallet: "Wallet",
              account: "Cuenta",
            };
            return (
              <View style={styles.preferenceRow} key={preference.category}>
                <View>
                  <Text style={styles.sectionTitle}>{labels[preference.category]}</Text>
                  <Text style={styles.cardText}>
                    {preference.pushEnabled ? "Push activado" : "Sólo dentro de la app"}
                  </Text>
                </View>
                <Pressable
                  disabled={busy}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: preference.pushEnabled }}
                  style={[
                    styles.preferenceSwitch,
                    preference.pushEnabled && styles.preferenceSwitchActive,
                  ]}
                  onPress={() =>
                    runAction(async () => {
                      const result = await api.updateNotificationPreference(preference.category, {
                        pushEnabled: !preference.pushEnabled,
                        emailEnabled: preference.emailEnabled,
                      });
                      setNotificationPreferences(result.preferences);
                    }, "Preferencia actualizada")
                  }
                >
                  <View
                    style={[
                      styles.preferenceKnob,
                      preference.pushEnabled && styles.preferenceKnobActive,
                    ]}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View>
            <Text style={styles.foodRestaurantTitle}>Ayuda y soporte</Text>
            <Text style={styles.cardText}>Casos reales con seguimiento y SLA.</Text>
          </View>
          <Ionicons name="headset-outline" size={25} color="#7c3cff" />
        </View>
        {state.supportTickets
          .filter((ticket) => ticket.userId === user.id)
          .map((ticket) => (
            <View style={styles.supportTicketCard} key={ticket.id}>
              <View style={styles.supportTicketHeader}>
                <View style={styles.savedAddressCopy}>
                  <Text style={styles.sectionTitle}>{ticket.title}</Text>
                  <Text style={styles.cardText}>
                    {ticket.id} · {ticket.status.replaceAll("_", " ")}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.supportSla,
                    ticket.slaStatus.includes("breached") && styles.supportSlaLate,
                  ]}
                >
                  {ticket.slaStatus === "on_track"
                    ? "EN SLA"
                    : ticket.slaStatus === "met"
                      ? "RESUELTO"
                      : "DEMORADO"}
                </Text>
              </View>
              <Text style={styles.notificationTime}>
                Respuesta antes de {new Date(ticket.firstResponseDueAt).toLocaleString("es-AR")}
              </Text>
              <View style={styles.supportMessages}>
                {ticket.messages.map((message) => (
                  <View
                    key={message.id}
                    style={[
                      styles.supportMessage,
                      message.senderId === user.id
                        ? styles.supportMessageOwn
                        : styles.supportMessageStaff,
                    ]}
                  >
                    <Text
                      style={[
                        styles.supportMessageText,
                        message.senderId === user.id && styles.supportMessageTextOwn,
                      ]}
                    >
                      {message.body}
                    </Text>
                    <Text
                      style={[
                        styles.supportMessageTime,
                        message.senderId === user.id && styles.supportMessageTextOwn,
                      ]}
                    >
                      {new Date(message.createdAt).toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                ))}
              </View>
              {!["resolved", "closed"].includes(ticket.status) && (
                <View style={styles.supportReplyRow}>
                  <TextInput
                    style={[styles.input, styles.supportReplyInput]}
                    value={supportReplies[ticket.id] || ""}
                    onChangeText={(value) =>
                      setSupportReplies((current) => ({ ...current, [ticket.id]: value }))
                    }
                    placeholder="Escribí una respuesta"
                  />
                  <Pressable
                    disabled={busy || (supportReplies[ticket.id] || "").trim().length < 1}
                    style={[
                      styles.supportSendButton,
                      (busy || (supportReplies[ticket.id] || "").trim().length < 1) &&
                        styles.disabledButton,
                    ]}
                    onPress={() =>
                      runAction(async () => {
                        await api.sendSupportMessage(
                          ticket.id,
                          (supportReplies[ticket.id] || "").trim(),
                        );
                        setSupportReplies((current) => ({ ...current, [ticket.id]: "" }));
                      }, "Respuesta enviada")
                    }
                  >
                    <Ionicons name="send" size={18} color="#fff" />
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        <View style={styles.newAddressForm}>
          <Text style={styles.sectionTitle}>Abrir un caso</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.paymentBrandRail}
          >
            {(
              [
                ["food", "Comida"],
                ["ride", "Viaje"],
                ["shipment", "Envío"],
                ["payment", "Pago"],
                ["account", "Cuenta"],
                ["safety", "Seguridad"],
                ["other", "Otro"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                style={[
                  styles.issueCategoryPill,
                  supportCategory === value && styles.issueCategoryPillActive,
                ]}
                onPress={() => setSupportCategory(value)}
              >
                <Text
                  style={[
                    styles.issueCategoryText,
                    supportCategory === value && styles.issueCategoryTextActive,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            value={supportSubject}
            onChangeText={setSupportSubject}
            placeholder="Resumen del problema"
          />
          <TextInput
            multiline
            numberOfLines={4}
            style={[styles.input, styles.issueDescriptionInput]}
            value={supportBody}
            onChangeText={setSupportBody}
            placeholder="Contanos qué pasó con el mayor detalle posible"
          />
          <Pressable
            disabled={busy || supportSubject.trim().length < 4 || supportBody.trim().length < 4}
            style={[
              styles.primaryButton,
              (busy || supportSubject.trim().length < 4 || supportBody.trim().length < 4) &&
                styles.disabledButton,
            ]}
            onPress={() =>
              runAction(async () => {
                await api.createSupportTicket({
                  category: supportCategory,
                  priority: supportCategory === "safety" ? "urgent" : "normal",
                  subject: supportSubject.trim(),
                  body: supportBody.trim(),
                });
                setSupportSubject("");
                setSupportBody("");
              }, "Caso creado; operaciones ya puede verlo")
            }
          >
            <Ionicons name="chatbox-ellipses-outline" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Enviar a soporte</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View>
            <Text style={styles.foodRestaurantTitle}>Direcciones guardadas</Text>
            <Text style={styles.cardText}>Se comparten entre comidas, viajes y envíos.</Text>
          </View>
          <Ionicons name="map-outline" size={24} color="#7c3cff" />
        </View>
        {state.addresses
          .filter((item) => item.userId === user.id)
          .map((item) => (
            <View style={styles.savedAddressRow} key={item.id}>
              <View
                style={[styles.savedAddressIcon, item.isDefault && styles.savedAddressIconDefault]}
              >
                <Ionicons
                  name={
                    item.label.toLowerCase().includes("trab") ? "business-outline" : "home-outline"
                  }
                  size={19}
                  color={item.isDefault ? "#fff" : "#7c3cff"}
                />
              </View>
              <Pressable
                style={styles.savedAddressCopy}
                onPress={() => {
                  const point =
                    item.lat !== null && item.lng !== null
                      ? { lat: item.lat, lng: item.lng }
                      : null;
                  onUseAddress(item.address, point);
                }}
              >
                <View style={styles.savedAddressTitle}>
                  <Text style={styles.sectionTitle}>{item.label}</Text>
                  {item.isDefault && <Text style={styles.defaultAddressBadge}>Principal</Text>}
                </View>
                <Text style={styles.cardText}>{item.address}</Text>
                <View style={styles.addressValidationStatus}>
                  <Ionicons
                    name={item.isValidated ? "checkmark-circle" : "alert-circle-outline"}
                    size={14}
                    color={item.isValidated ? "#087a50" : "#a15c00"}
                  />
                  <Text
                    style={[
                      styles.addressValidationText,
                      !item.isValidated && styles.addressValidationTextWarning,
                    ]}
                  >
                    {item.isValidated
                      ? `Validada${item.geocodingProvider ? ` · ${item.geocodingProvider}` : ""}`
                      : "Requiere volver a validarse"}
                  </Text>
                </View>
              </Pressable>
              {!item.id.startsWith("profile-") && (
                <View style={styles.savedAddressActions}>
                  {!item.isDefault && (
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        runAction(
                          () => api.setDefaultAddress(item.id),
                          "Dirección principal actualizada",
                        )
                      }
                    >
                      <Ionicons name="star-outline" size={20} color="#7c3cff" />
                    </Pressable>
                  )}
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      Alert.alert("Eliminar dirección", `¿Eliminar ${item.label}?`, [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Eliminar",
                          style: "destructive",
                          onPress: () =>
                            runAction(() => api.deleteAddress(item.id), "Dirección eliminada"),
                        },
                      ])
                    }
                  >
                    <Ionicons name="trash-outline" size={20} color="#d74a43" />
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        <CustomerAddressForm
          busy={busy}
          hasPersistedAddress={state.addresses.some(
            (item) => item.userId === user.id && !item.id.startsWith("profile-"),
          )}
          runAction={runAction}
          onSaved={(match) => onUseAddress(match.label, match.point)}
        />
      </View>
      <View style={styles.addressBookCard}>
        <View style={styles.addressBookHeading}>
          <View>
            <Text style={styles.foodRestaurantTitle}>Métodos de pago</Text>
            <Text style={styles.cardText}>Sólo guardamos tokens y datos enmascarados.</Text>
          </View>
          <Ionicons name="card-outline" size={24} color="#7c3cff" />
        </View>
        {state.paymentMethods
          .filter((method) => method.userId === user.id)
          .map((method) => (
            <View style={styles.paymentMethodRow} key={method.id}>
              <View
                style={[
                  styles.savedAddressIcon,
                  method.isDefault && styles.savedAddressIconDefault,
                ]}
              >
                <Ionicons
                  name={method.type === "wallet" ? "wallet-outline" : "card-outline"}
                  size={19}
                  color={method.isDefault ? "#fff" : "#7c3cff"}
                />
              </View>
              <View style={styles.savedAddressCopy}>
                <View style={styles.savedAddressTitle}>
                  <Text style={styles.sectionTitle}>{method.label}</Text>
                  {method.isDefault && <Text style={styles.defaultAddressBadge}>Principal</Text>}
                </View>
                {method.expiryMonth && (
                  <Text style={styles.cardText}>
                    Vence {String(method.expiryMonth).padStart(2, "0")}/{method.expiryYear}
                  </Text>
                )}
              </View>
              {method.type !== "wallet" && (
                <View style={styles.savedAddressActions}>
                  {!method.isDefault && (
                    <Pressable
                      disabled={busy}
                      onPress={() =>
                        runAction(
                          () => api.setDefaultPaymentMethod(method.id),
                          "Método principal actualizado",
                        )
                      }
                    >
                      <Ionicons name="star-outline" size={20} color="#7c3cff" />
                    </Pressable>
                  )}
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      Alert.alert("Eliminar método", `¿Eliminar ${method.label}?`, [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Eliminar",
                          style: "destructive",
                          onPress: () =>
                            runAction(() => api.deletePaymentMethod(method.id), "Método eliminado"),
                        },
                      ])
                    }
                  >
                    <Ionicons name="trash-outline" size={20} color="#d74a43" />
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        <View style={styles.newAddressForm}>
          <Text style={styles.sectionTitle}>Agregar tarjeta sandbox</Text>
          <Text style={styles.cardText}>
            El SDK del PSP genera el token; Flash nunca recibe el número completo ni el CVV.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.paymentBrandRail}
          >
            {(["visa", "mastercard", "amex", "cabal"] as const).map((brand) => (
              <Pressable
                key={brand}
                style={[
                  styles.issueCategoryPill,
                  paymentBrand === brand && styles.issueCategoryPillActive,
                ]}
                onPress={() => setPaymentBrand(brand)}
              >
                <Text
                  style={[
                    styles.issueCategoryText,
                    paymentBrand === brand && styles.issueCategoryTextActive,
                  ]}
                >
                  {brand.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            style={styles.input}
            value={paymentToken}
            onChangeText={setPaymentToken}
            autoCapitalize="none"
            placeholder="pm_test_token_seguro"
          />
          <View style={styles.paymentCompactFields}>
            <TextInput
              style={[styles.input, styles.paymentCompactInput]}
              value={paymentLast4}
              onChangeText={(value) => setPaymentLast4(value.replace(/[^0-9]/g, "").slice(0, 4))}
              keyboardType="numeric"
              placeholder="Últimos 4"
            />
            <TextInput
              style={[styles.input, styles.paymentCompactInput]}
              value={paymentExpiry}
              onChangeText={(value) => setPaymentExpiry(value.replace(/[^0-9/]/g, "").slice(0, 7))}
              keyboardType="numeric"
              placeholder="MM/AAAA"
            />
          </View>
          <Pressable
            disabled={
              busy ||
              !/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken) ||
              paymentLast4.length !== 4 ||
              !/^\d{2}\/\d{4}$/.test(paymentExpiry)
            }
            style={[
              styles.primaryButton,
              (busy ||
                !/^pm_test_[A-Za-z0-9_-]{8,120}$/.test(paymentToken) ||
                paymentLast4.length !== 4 ||
                !/^\d{2}\/\d{4}$/.test(paymentExpiry)) &&
                styles.disabledButton,
            ]}
            onPress={() => {
              const [month, year] = paymentExpiry.split("/").map(Number);
              runAction(async () => {
                await api.createSandboxPaymentMethod({
                  providerToken: paymentToken,
                  brand: paymentBrand,
                  last4: paymentLast4,
                  expiryMonth: month,
                  expiryYear: year,
                });
                setPaymentToken("");
                setPaymentLast4("");
                setPaymentExpiry("");
              }, "Método tokenizado agregado");
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={19} color="#fff" />
            <Text style={styles.primaryButtonText}>Guardar token seguro</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}
