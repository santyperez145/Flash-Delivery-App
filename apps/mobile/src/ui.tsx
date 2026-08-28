// Primitivas compartidas de la aplicación móvil (ticket ARC-001, paso 11).
//
// Seis componentes que **usan más de una audiencia**, y por eso no pueden vivir
// dentro de la pantalla de ninguna. La decisión salió de contar usos por zona del
// archivo, no de los nombres: `ActionButton` aparece 16 veces repartidas entre
// cliente, comercio y conductor; `OrderCard` y `KpiRow` las usan comercio y
// conductor; `ServiceChatModal` las tres.
//
// Es el mismo orden que en los diez pasos anteriores: **el núcleo antes que las
// superficies**. Sin este archivo, extraer `CustomerScreen` obligaría a duplicar
// `ActionButton` o a que la pantalla del cliente exportara un botón que usa el
// comercio, que es como se construye un ciclo de imports.

// Los tipos y la API llegan por import: este módulo no conoce el estado de
// ninguna pantalla, sólo recibe props.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "./api";
import { mobileOrderStatusLabel, money } from "./format";
import { styles } from "./styles";
import type { Order, ServiceMessage } from "./types";
export function NativeMapUnavailable({
  message,
  height = 260,
}: {
  message: string;
  height?: number;
}) {
  return (
    <View style={[styles.trackingMap, styles.nativeMapEmpty, { height }]}>
      <Ionicons name="map-outline" size={30} color="#7c3cff" />
      <Text style={styles.nativeMapEmptyTitle}>Mapa pendiente de coordenadas</Text>
      <Text style={styles.nativeMapEmptyText}>{message}</Text>
    </View>
  );
}

export function MobileTaskSheet({
  visible = true,
  eyebrow,
  title,
  accessibilityLabel,
  onClose,
  children,
}: {
  visible?: boolean;
  eyebrow: string;
  title: string;
  accessibilityLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Math.max(insets.top, 12)}
        style={styles.trackingBackdrop}
      >
        <View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          style={[styles.trackingSheet, { paddingBottom: Math.max(insets.bottom, 18) }]}
        >
          <View style={styles.trackingHeader}>
            <View style={styles.itemCopy}>
              <Text style={styles.orderConfirmationEyebrow}>{eyebrow}</Text>
              <Text style={styles.foodRestaurantTitle} numberOfLines={2}>
                {title}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cerrar ${accessibilityLabel.toLowerCase()}`}
              hitSlop={8}
              style={styles.foodBack}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color="#222" />
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ServiceChatModal({
  jobId,
  currentUserId,
  onClose,
}: {
  jobId: string | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ServiceMessage[]>([]),
    [body, setBody] = useState(""),
    [loading, setLoading] = useState(false),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState<{
    fileName: string;
    mimeType: "image/jpeg" | "image/png" | "application/pdf";
    contentBase64: string;
    sizeBytes: number;
  } | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const result = await api.getServiceMessages(jobId);
      setMessages(result.messages);
      if (result.unreadCount > 0) await api.markServiceMessagesRead(jobId);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo abrir la conversación");
    }
  }, [jobId]);
  useEffect(() => {
    if (!jobId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    void load().finally(() => setLoading(false));
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [jobId, load]);
  useEffect(() => {
    if (!jobId) {
      setQuickReplies([]);
      return;
    }
    void api
      .getServiceQuickReplies(jobId)
      .then((result) => setQuickReplies(result.quickReplies.map((entry) => entry.body)))
      .catch(() => setQuickReplies([]));
  }, [jobId]);
  const pickAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0],
      mimeType = asset.mimeType as "image/jpeg" | "image/png" | "application/pdf";
    if (!["image/jpeg", "image/png", "application/pdf"].includes(mimeType)) {
      setError("Formato no permitido");
      return;
    }
    if (!asset.size || asset.size > 768000) {
      setError("El adjunto debe pesar menos de 750 KB");
      return;
    }
    const contentBase64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    setPendingAttachment({
      fileName: asset.name || "adjunto",
      mimeType,
      contentBase64,
      sizeBytes: asset.size,
    });
    setError("");
  };
  const openAttachment = async (id: string) => {
    try {
      const result = await api.getServiceAttachmentContent(id),
        safe = result.attachment.fileName.replace(/[^a-zA-Z0-9._-]/g, "_") || "adjunto",
        uri = `${FileSystem.cacheDirectory}${id}-${safe}`;
      await FileSystem.writeAsStringAsync(uri, result.contentBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, {
          mimeType: result.attachment.mimeType,
          dialogTitle: "Abrir adjunto seguro",
        });
      else Alert.alert("Flash", "El dispositivo no permite abrir este adjunto.");
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "No se pudo abrir el adjunto");
    }
  };
  const send = async () => {
    if (!jobId || (!body.trim() && !pendingAttachment) || sending) return;
    setSending(true);
    try {
      await api.sendServiceMessage(
        jobId,
        body.trim(),
        pendingAttachment
          ? {
              fileName: pendingAttachment.fileName,
              mimeType: pendingAttachment.mimeType,
              contentBase64: pendingAttachment.contentBase64,
            }
          : undefined,
      );
      setBody("");
      setPendingAttachment(null);
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  };
  return (
    <MobileTaskSheet
      visible={Boolean(jobId)}
      eyebrow="Chat del servicio"
      title={jobId || "Conversación"}
      accessibilityLabel="Chat del servicio"
      onClose={onClose}
    >
      <View style={styles.issueSecurityNote}>
        <Ionicons name="lock-closed-outline" size={18} color="#087a50" />
        <Text style={styles.issueSecurityText}>
          Mensajes y adjuntos cifrados; sólo participan las personas del servicio.
        </Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.supportMessages}>
        {loading ? (
          <ActivityIndicator color="#7c3cff" />
        ) : messages.length === 0 ? (
          <View style={styles.foodEmpty}>
            <Ionicons name="chatbubbles-outline" size={42} color="#7c3cff" />
            <Text style={styles.cardText}>Todavía no hay mensajes.</Text>
          </View>
        ) : (
          messages.map((message) => {
            const own = message.senderId === currentUserId,
              read = own && message.readBy.some((entry) => entry.userId !== currentUserId);
            return (
              <View
                key={message.id}
                style={[
                  styles.supportMessage,
                  own ? styles.supportMessageOwn : styles.supportMessageStaff,
                ]}
              >
                {message.body ? (
                  <Text style={[styles.supportMessageText, own && styles.supportMessageTextOwn]}>
                    {message.body}
                  </Text>
                ) : null}
                {message.attachments.map((attachment) => (
                  <Pressable
                    key={attachment.id}
                    style={styles.issueCategoryPill}
                    onPress={() => void openAttachment(attachment.id)}
                  >
                    <Ionicons
                      name={
                        attachment.mimeType === "application/pdf"
                          ? "document-text-outline"
                          : "image-outline"
                      }
                      size={16}
                      color={own ? "#fff" : "#7c3cff"}
                    />
                    <Text
                      style={[styles.issueCategoryText, own && styles.supportMessageTextOwn]}
                      numberOfLines={1}
                    >
                      {attachment.fileName} · {Math.ceil(attachment.sizeBytes / 1024)} KB
                    </Text>
                  </Pressable>
                ))}
                <Text style={[styles.supportMessageTime, own && styles.supportMessageTextOwn]}>
                  {own ? "Vos" : message.senderName} ·{" "}
                  {new Date(message.createdAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {own ? (read ? " · Leído" : " · Enviado") : ""}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
      {error ? <Text style={styles.complianceRejection}>{error}</Text> : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.paymentBrandRail}
      >
        {quickReplies.map((reply) => (
          <Pressable key={reply} style={styles.issueCategoryPill} onPress={() => setBody(reply)}>
            <Text style={styles.issueCategoryText}>{reply}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {pendingAttachment ? (
        <View style={styles.issueSecurityNote}>
          <Ionicons name="attach-outline" size={18} color="#7c3cff" />
          <View style={styles.itemCopy}>
            <Text style={styles.issueSecurityText} numberOfLines={1}>
              {pendingAttachment.fileName} · {Math.ceil(pendingAttachment.sizeBytes / 1024)} KB
            </Text>
          </View>
          <Pressable onPress={() => setPendingAttachment(null)}>
            <Ionicons name="close-circle" size={20} color="#8f3840" />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.supportReplyRow}>
        <Pressable disabled={sending} style={styles.foodBack} onPress={() => void pickAttachment()}>
          <Ionicons name="attach" size={20} color="#7c3cff" />
        </Pressable>
        <TextInput
          style={[styles.input, styles.supportReplyInput]}
          value={body}
          onChangeText={setBody}
          maxLength={1000}
          placeholder="Escribí un mensaje"
          multiline
        />
        <Pressable
          disabled={sending || (!body.trim() && !pendingAttachment)}
          style={[
            styles.supportSendButton,
            (sending || (!body.trim() && !pendingAttachment)) && styles.disabledButton,
          ]}
          onPress={() => void send()}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </MobileTaskSheet>
  );
}

export function KpiRow({ items }: { items: Array<[string, number | string]> }) {
  return (
    <View style={styles.kpiGrid}>
      {items.map(([label, value]) => (
        <View key={label} style={styles.kpi}>
          <Text style={styles.kpiLabel}>{label}</Text>
          <Text style={styles.kpiValue}>
            {typeof value === "number" && value > 999 ? money.format(value) : value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function OrderCard({
  order,
  disabled,
  onPress,
}: {
  order: Order;
  disabled?: boolean;
  onPress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{mobileOrderStatusLabel[order.status]}</Text>
      <Text style={styles.cardText}>{order.deliveryAddress}</Text>
      <Text style={styles.cardText}>
        {order.items.length} items - {money.format(order.total)}
      </Text>
      {onPress && <ActionButton label="Avanzar" disabled={disabled} onPress={onPress} />}
    </View>
  );
}

export function ActionButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, disabled && styles.actionDisabled]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}
