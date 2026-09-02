// Inbox del conductor (ARC-001).
//
// Chats de trabajos activos y novedades de cuenta. Sale de DriverScreen porque
// es una pestaña autocontenida con su propia carga de notificaciones.

import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { AppNotification } from "../types";

const notificationTitles: Record<string, string> = {
  order_status: "Actualización de entrega",
  ride_status: "Actualización de viaje",
  shipment_status: "Actualización de envío",
  tip_received: "Recibiste una propina",
  support_reply: "Nueva respuesta de soporte",
  support_ticket_created: "Caso de soporte creado",
  driver_document_status: "Estado de documento",
  driver_vehicle_status: "Estado de vehículo",
};

export type DriverInboxChat = {
  id: string;
  label: string;
  detail: string;
  icon: "restaurant" | "car-sport" | "cube";
};

export function DriverInboxPanel({
  activeChats,
  onOpenChat,
  onUnreadChange,
}: {
  activeChats: DriverInboxChat[];
  onOpenChat: (jobId: string) => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [driverNotifications, setDriverNotifications] = useState<AppNotification[]>([]);
  const [driverNotificationsLoading, setDriverNotificationsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setDriverNotificationsLoading(true);
    void api
      .getNotifications()
      .then((result) => {
        if (!cancelled) setDriverNotifications(result.notifications);
      })
      .catch(() => {
        if (!cancelled) setDriverNotifications([]);
      })
      .finally(() => {
        if (!cancelled) setDriverNotificationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onUnreadChange?.(driverNotifications.filter((item) => !item.readAt).length);
  }, [driverNotifications, onUnreadChange]);

  return (
    <>
      <View style={styles.driverSectionHeading}>
        <View>
          <Text style={styles.driverSectionEyebrow}>COMUNICACIONES</Text>
          <Text style={styles.driverSectionTitle}>Inbox</Text>
        </View>
        <View style={styles.driverUnreadBadge}>
          <Text style={styles.driverUnreadText}>
            {driverNotifications.filter((item) => !item.readAt).length}
          </Text>
        </View>
      </View>
      {activeChats.length > 0 ? (
        <View style={styles.complianceCard}>
          <Text style={styles.sectionTitle}>Chats de trabajos activos</Text>
          <Text style={styles.cardText}>
            El chat queda ligado al servicio y conserva participantes autorizados.
          </Text>
          {activeChats.map((chat) => (
            <Pressable
              key={chat.id}
              style={styles.driverInboxRow}
              onPress={() => onOpenChat(chat.id)}
            >
              <View style={styles.driverInboxIcon}>
                <Ionicons name={chat.icon} size={20} color="#7c3cff" />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>{chat.label}</Text>
                <Text style={styles.cardText} numberOfLines={1}>
                  {chat.detail}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color="#968c9e" />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.complianceCard}>
        <Text style={styles.sectionTitle}>Novedades de tu cuenta</Text>
        {driverNotificationsLoading ? (
          <ActivityIndicator color="#7c3cff" />
        ) : driverNotifications.length === 0 ? (
          <View style={styles.driverEmptyState}>
            <Ionicons name="mail-open-outline" size={34} color="#7c3cff" />
            <Text style={styles.sectionTitle}>Todo al día</Text>
            <Text style={styles.cardText}>
              Los estados de servicios, documentos y soporte aparecerán acá.
            </Text>
          </View>
        ) : (
          driverNotifications.slice(0, 20).map((item) => (
            <Pressable
              key={item.id}
              disabled={Boolean(item.readAt)}
              onPress={async () => {
                const result = await api.markNotificationRead(item.id);
                setDriverNotifications(result.notifications);
              }}
              style={[styles.driverInboxRow, !item.readAt && styles.driverInboxUnread]}
            >
              <View style={styles.driverInboxIcon}>
                <Ionicons
                  name={item.readAt ? "mail-open-outline" : "mail-unread-outline"}
                  size={20}
                  color={item.readAt ? "#777" : "#7c3cff"}
                />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.sectionTitle}>
                  {notificationTitles[item.template] || "Novedad de Flash"}
                </Text>
                <Text style={styles.cardText}>
                  {String(
                    item.payload.status || item.payload.kind || "Revisá el detalle de tu cuenta",
                  )}
                </Text>
                <Text style={styles.notificationTime}>
                  {new Date(item.createdAt).toLocaleString("es-AR")}
                </Text>
              </View>
              {!item.readAt ? <Text style={styles.notificationNew}>NUEVA</Text> : null}
            </Pressable>
          ))
        )}
      </View>
    </>
  );
}
