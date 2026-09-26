// Cuenta del cliente (ARC-001).
//
// Shell: perfil, suscripción y carga. Uber y DoorDash aíslan seguridad, dieta,
// inbox, soporte, libreta y pagos; Flash ahora también. Se mantiene montada al
// cambiar de pestaña para no descartar formularios en curso.
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

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
import { CustomerAccountAddresses } from "./CustomerAccountAddresses";
import { CustomerAccountDietary } from "./CustomerAccountDietary";
import { CustomerAccountInbox } from "./CustomerAccountInbox";
import { CustomerAccountPayments } from "./CustomerAccountPayments";
import { CustomerAccountReferrals } from "./CustomerAccountReferrals";
import { CustomerAccountSecurity } from "./CustomerAccountSecurity";
import { CustomerAccountSupport } from "./CustomerAccountSupport";

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
      <CustomerAccountSecurity
        user={user}
        busy={busy}
        runAction={runAction}
        phoneVerified={phoneVerified}
        setPhoneVerified={setPhoneVerified}
        phoneVerificationCode={phoneVerificationCode}
        setPhoneVerificationCode={setPhoneVerificationCode}
        phoneRetrySeconds={phoneRetrySeconds}
        setPhoneRetrySeconds={setPhoneRetrySeconds}
        accountSessions={accountSessions}
        setAccountSessions={setAccountSessions}
      />
      <CustomerAccountReferrals
        busy={busy}
        runAction={runAction}
        referral={referral}
        setReferral={setReferral}
        referralClaim={referralClaim}
        setReferralClaim={setReferralClaim}
      />
      <CustomerAccountDietary
        busy={busy}
        runAction={runAction}
        dietaryPreferences={dietaryPreferences}
        setDietaryPreferences={setDietaryPreferences}
      />
      <CustomerAccountInbox
        busy={busy}
        runAction={runAction}
        notifications={notifications}
        setNotifications={setNotifications}
        notificationPreferences={notificationPreferences}
        setNotificationPreferences={setNotificationPreferences}
      />
      <CustomerAccountSupport
        state={state}
        user={user}
        busy={busy}
        runAction={runAction}
        supportSubject={supportSubject}
        setSupportSubject={setSupportSubject}
        supportBody={supportBody}
        setSupportBody={setSupportBody}
        supportCategory={supportCategory}
        setSupportCategory={setSupportCategory}
        supportReplies={supportReplies}
        setSupportReplies={setSupportReplies}
      />
      <CustomerAccountAddresses
        state={state}
        user={user}
        busy={busy}
        runAction={runAction}
        onUseAddress={onUseAddress}
      />
      <CustomerAccountPayments
        state={state}
        user={user}
        busy={busy}
        runAction={runAction}
        paymentToken={paymentToken}
        setPaymentToken={setPaymentToken}
        paymentBrand={paymentBrand}
        setPaymentBrand={setPaymentBrand}
        paymentLast4={paymentLast4}
        setPaymentLast4={setPaymentLast4}
        paymentExpiry={paymentExpiry}
        setPaymentExpiry={setPaymentExpiry}
      />
    </>
  );
}
