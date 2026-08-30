import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { styles } from "../styles";
import type { ShipmentClaim, ShipmentReturn } from "../types";

type OrderIssueCategory =
  | "missing_item"
  | "wrong_item"
  | "damaged_item"
  | "quality"
  | "late"
  | "other";

export type CustomerServiceIssueState =
  | { kind: "none" }
  | { kind: "return"; shipmentId: string; reason: string }
  | {
      kind: "claim";
      shipmentId: string;
      claimType: ShipmentClaim["claimType"];
      description: string;
      amount: string;
    }
  | {
      kind: "order";
      orderId: string;
      category: OrderIssueCategory;
      description: string;
      refund: string;
    };

const closed: CustomerServiceIssueState = { kind: "none" };

export function CustomerServiceIssueModals({
  value,
  busy,
  runAction,
  onChange,
  onReturnCreated,
  onClaimCreated,
}: {
  value: CustomerServiceIssueState;
  busy: boolean;
  runAction: (action: () => Promise<unknown>, success: string) => void;
  onChange: (value: CustomerServiceIssueState) => void;
  onReturnCreated: (shipmentReturn: ShipmentReturn) => void;
  onClaimCreated: (claim: ShipmentClaim) => void;
}) {
  return (
    <>
      <Modal
        transparent
        visible={value.kind === "return"}
        animationType="slide"
        onRequestClose={() => onChange(closed)}
      >
        <View style={styles.issueModalBackdrop}>
          <View style={styles.issueModalSheet}>
            <View style={styles.issueModalHandle} />
            <View style={styles.issueModalHeader}>
              <View>
                <Text style={styles.substitutionEyebrow}>LOGÍSTICA INVERSA</Text>
                <Text style={styles.foodRestaurantTitle}>Solicitar devolución</Text>
              </View>
              <Pressable style={styles.issueModalClose} onPress={() => onChange(closed)}>
                <Ionicons name="close" size={21} color="#403a43" />
              </Pressable>
            </View>
            <Text style={styles.cardText}>
              Operaciones validará el motivo antes de programar el retiro.
            </Text>
            <TextInput
              multiline
              numberOfLines={4}
              value={value.kind === "return" ? value.reason : ""}
              onChangeText={(reason) => {
                if (value.kind === "return") onChange({ ...value, reason });
              }}
              maxLength={500}
              placeholder="Explicá por qué necesitás devolver el envío"
              style={[styles.input, styles.issueDescriptionInput]}
            />
            <Pressable
              disabled={busy || value.kind !== "return" || value.reason.trim().length < 5}
              style={[
                styles.issueSubmitButton,
                (busy || value.kind !== "return" || value.reason.trim().length < 5) &&
                  styles.disabledButton,
              ]}
              onPress={() => {
                if (value.kind !== "return") return;
                const { shipmentId, reason } = value;
                runAction(async () => {
                  const result = await api.requestShipmentReturn(shipmentId, reason.trim());
                  onReturnCreated(result.return);
                  onChange(closed);
                }, "Solicitud de devolución registrada");
              }}
            >
              <Ionicons name="return-down-back" size={18} color="#fff" />
              <Text style={styles.issueSubmitText}>Enviar solicitud</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={value.kind === "claim"}
        animationType="slide"
        onRequestClose={() => onChange(closed)}
      >
        <View style={styles.issueModalBackdrop}>
          <View style={styles.issueModalSheet}>
            <View style={styles.issueModalHandle} />
            <View style={styles.issueModalHeader}>
              <View>
                <Text style={styles.substitutionEyebrow}>PROTECCIÓN FLASH</Text>
                <Text style={styles.foodRestaurantTitle}>Reportar siniestro</Text>
              </View>
              <Pressable style={styles.issueModalClose} onPress={() => onChange(closed)}>
                <Ionicons name="close" size={21} color="#403a43" />
              </Pressable>
            </View>
            <Text style={styles.cardText}>
              La cobertura y franquicia se validan contra el contrato del envío. La aprobación no
              simula un pago externo.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.issueCategoryRail}
            >
              {(
                [
                  ["lost", "Extraviado"],
                  ["damaged", "Dañado"],
                  ["stolen", "Robado"],
                ] as const
              ).map(([claimType, label]) => {
                const selected = value.kind === "claim" && value.claimType === claimType;
                return (
                  <Pressable
                    key={claimType}
                    style={[styles.issueCategoryPill, selected && styles.issueCategoryPillActive]}
                    onPress={() => {
                      if (value.kind === "claim") onChange({ ...value, claimType });
                    }}
                  >
                    <Text
                      style={[styles.issueCategoryText, selected && styles.issueCategoryTextActive]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              multiline
              numberOfLines={4}
              value={value.kind === "claim" ? value.description : ""}
              onChangeText={(description) => {
                if (value.kind === "claim") onChange({ ...value, description });
              }}
              maxLength={1000}
              placeholder="Describí qué ocurrió y qué evidencia tenés"
              style={[styles.input, styles.issueDescriptionInput]}
            />
            <TextInput
              value={value.kind === "claim" ? value.amount : ""}
              onChangeText={(amount) => {
                if (value.kind === "claim") {
                  onChange({ ...value, amount: amount.replace(/[^0-9]/g, "") });
                }
              }}
              keyboardType="numeric"
              placeholder="Monto reclamado"
              style={styles.input}
            />
            <Pressable
              disabled={
                busy ||
                value.kind !== "claim" ||
                value.description.trim().length < 10 ||
                !Number(value.amount)
              }
              style={[
                styles.issueSubmitButton,
                (busy ||
                  value.kind !== "claim" ||
                  value.description.trim().length < 10 ||
                  !Number(value.amount)) &&
                  styles.disabledButton,
              ]}
              onPress={() => {
                if (value.kind !== "claim") return;
                const { shipmentId, claimType, description, amount } = value;
                runAction(async () => {
                  const result = await api.createShipmentClaim(shipmentId, {
                    claimType,
                    description: description.trim(),
                    requestedAmount: Number(amount),
                  });
                  onClaimCreated(result.claim);
                  onChange(closed);
                }, "Siniestro registrado para revisión");
              }}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color="#fff" />
              <Text style={styles.issueSubmitText}>Enviar reclamo</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={value.kind === "order"}
        animationType="slide"
        onRequestClose={() => onChange(closed)}
      >
        <View style={styles.issueModalBackdrop}>
          <View style={styles.issueModalSheet}>
            <View style={styles.issueModalHandle} />
            <View style={styles.issueModalHeader}>
              <View>
                <Text style={styles.substitutionEyebrow}>Ayuda con tu pedido</Text>
                <Text style={styles.foodRestaurantTitle}>Reportar un problema</Text>
              </View>
              <Pressable style={styles.issueModalClose} onPress={() => onChange(closed)}>
                <Ionicons name="close" size={21} color="#403a43" />
              </Pressable>
            </View>
            <Text style={styles.cardText}>
              Operaciones revisará el caso y, si corresponde, realizará un reintegro parcial a tu
              Wallet.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.issueCategoryRail}
            >
              {(
                [
                  ["missing_item", "Faltó un producto"],
                  ["wrong_item", "Producto incorrecto"],
                  ["damaged_item", "Llegó dañado"],
                  ["quality", "Problema de calidad"],
                  ["late", "Demora"],
                  ["other", "Otro"],
                ] as const
              ).map(([category, label]) => {
                const selected = value.kind === "order" && value.category === category;
                return (
                  <Pressable
                    key={category}
                    style={[styles.issueCategoryPill, selected && styles.issueCategoryPillActive]}
                    onPress={() => {
                      if (value.kind === "order") onChange({ ...value, category });
                    }}
                  >
                    <Text
                      style={[styles.issueCategoryText, selected && styles.issueCategoryTextActive]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.issueFieldLabel}>Contanos qué pasó</Text>
            <TextInput
              multiline
              numberOfLines={4}
              value={value.kind === "order" ? value.description : ""}
              onChangeText={(description) => {
                if (value.kind === "order") onChange({ ...value, description });
              }}
              placeholder="Ej.: faltaron las papas del combo"
              style={[styles.input, styles.issueDescriptionInput]}
            />
            <Text style={styles.issueFieldLabel}>Reintegro solicitado</Text>
            <View style={styles.issueMoneyInput}>
              <Text style={styles.issueMoneyPrefix}>$</Text>
              <TextInput
                value={value.kind === "order" ? value.refund : ""}
                onChangeText={(refund) => {
                  if (value.kind === "order") {
                    onChange({ ...value, refund: refund.replace(/[^0-9]/g, "") });
                  }
                }}
                keyboardType="numeric"
                placeholder="0"
                style={styles.issueMoneyTextInput}
              />
            </View>
            <View style={styles.issueSecurityNote}>
              <Ionicons name="shield-checkmark-outline" size={18} color="#087a50" />
              <Text style={styles.issueSecurityText}>
                No se mueve dinero hasta que operaciones valide la evidencia y el importe.
              </Text>
            </View>
            <Pressable
              disabled={
                busy ||
                value.kind !== "order" ||
                value.description.trim().length < 5 ||
                !Number(value.refund)
              }
              style={[
                styles.issueSubmitButton,
                (busy ||
                  value.kind !== "order" ||
                  value.description.trim().length < 5 ||
                  !Number(value.refund)) &&
                  styles.disabledButton,
              ]}
              onPress={() => {
                if (value.kind !== "order") return;
                const { orderId, category, description, refund } = value;
                runAction(async () => {
                  await api.createOrderIssue(orderId, {
                    category,
                    description: description.trim(),
                    requestedRefund: Number(refund),
                  });
                  onChange(closed);
                }, "Incidencia enviada a operaciones");
              }}
            >
              <Ionicons name="paper-plane-outline" size={18} color="#fff" />
              <Text style={styles.issueSubmitText}>Enviar incidencia</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}
