// Referidos de cuenta (ARC-001).
//
// Uber Rewards / DoorDash DashPass aíslan el código de invitación del cobro.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Share, Text, TextInput, View } from "react-native";

import { api } from "../api";
import { money } from "../format";
import { styles } from "../styles";
import type { ReferralSummary } from "../types";
import type { AccountRunAction } from "./CustomerAccountTypes";

export function CustomerAccountReferrals({
  busy,
  runAction,
  referral,
  setReferral,
  referralClaim,
  setReferralClaim,
}: {
  busy: boolean;
  runAction: AccountRunAction;
  referral: ReferralSummary | null;
  setReferral: (value: ReferralSummary) => void;
  referralClaim: string;
  setReferralClaim: (value: string) => void;
}) {
  if (!referral) return null;
  return (
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
  );
}
