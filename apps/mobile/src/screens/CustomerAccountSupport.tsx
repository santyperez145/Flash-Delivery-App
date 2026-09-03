// Soporte de cuenta (ARC-001).
//
// Uber Help y DoorDash aíslan tickets/SLA de pagos y de la libreta.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { AppState, User } from "../types";
import type { AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountSupport({
  state,
  user,
  busy,
  runAction,
  supportSubject,
  setSupportSubject,
  supportBody,
  setSupportBody,
  supportCategory,
  setSupportCategory,
  supportReplies,
  setSupportReplies,
}: {
  state: AppState;
  user: User;
  busy: boolean;
  runAction: AccountRunAction;
  supportSubject: string;
  setSupportSubject: (value: string) => void;
  supportBody: string;
  setSupportBody: (value: string) => void;
  supportCategory: "food" | "ride" | "shipment" | "payment" | "account" | "safety" | "other";
  setSupportCategory: (
    value: "food" | "ride" | "shipment" | "payment" | "account" | "safety" | "other",
  ) => void;
  supportReplies: Record<string, string>;
  setSupportReplies: (
    value: Record<string, string> | ((current: Record<string, string>) => Record<string, string>),
  ) => void;
}) {
  return (
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
  );
}
