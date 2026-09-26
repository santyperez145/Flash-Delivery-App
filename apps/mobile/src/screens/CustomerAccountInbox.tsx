// Inbox y preferencias push (ARC-001).
//
// Uber y DoorDash aíslan el historial de avisos de la libreta y del cobro.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { AppNotification, NotificationPreference } from "../types";
import type { AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountInbox({
  busy,
  runAction,
  notifications,
  setNotifications,
  notificationPreferences,
  setNotificationPreferences,
}: {
  busy: boolean;
  runAction: AccountRunAction;
  notifications: AppNotification[];
  setNotifications: (value: AppNotification[]) => void;
  notificationPreferences: NotificationPreference[];
  setNotificationPreferences: (value: NotificationPreference[]) => void;
}) {
  return (
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
              <Text style={styles.sectionTitle}>{titles[item.template] || "Novedad de Flash"}</Text>
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
  );
}
