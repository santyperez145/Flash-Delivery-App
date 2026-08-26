// Pantalla de acceso (ticket ARC-001, paso 12).
//
// No pertenece a ninguna audiencia: es la que decide cuál sos. Por eso queda en
// su propio archivo y no dentro de `CustomerScreen` ni de `DriverScreen` — un
// entrypoint por audiencia va a necesitarla entera, sea cual sea.

import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { api, mobileAppVariant } from "../api";
import { flashDesign } from "../design-system";
import { styles } from "../styles";
import type { User } from "../types";

export function LoginScreen({
  busy,
  onLogin,
  onRegister,
}: {
  busy: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
  }) => Promise<{
    user: User;
    verificationRequired: true;
    developmentCode?: string;
    expiresAt?: string;
  }>;
}) {
  const [creating, setCreating] = useState(false);
  const [loginStep, setLoginStep] = useState<"email" | "password">("email");
  const [recoveryStep, setRecoveryStep] = useState<"none" | "request" | "confirm">("none");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const { height } = useWindowDimensions();
  const compactAuth = height < 700;
  const normalizedEmail = email.trim().toLowerCase();
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const isCustomerAccess = mobileAppVariant === "customer";
  const audiencePresentation =
    mobileAppVariant === "driver"
      ? {
          eyebrow: "FLASH DRIVER",
          title: "Tu jornada,\nbajo control.",
          copy: "Ofertas, navegación y ganancias con seguridad desde una sola app.",
          services: [
            { icon: "map-outline" as const, label: "Mapa", color: "#c9afff" },
            { icon: "wallet-outline" as const, label: "Ganancias", color: "#d6ff72" },
            { icon: "shield-checkmark-outline" as const, label: "Seguridad", color: "#8ce1bd" },
          ],
        }
      : mobileAppVariant === "merchant"
        ? {
            eyebrow: "FLASH NEGOCIOS",
            title: "Tu local,\nen movimiento.",
            copy: "Pedidos, catálogo y operación diaria en un único espacio de trabajo.",
            services: [
              { icon: "pulse-outline" as const, label: "Hoy", color: "#ffb584" },
              { icon: "receipt-outline" as const, label: "Pedidos", color: "#c9afff" },
              { icon: "grid-outline" as const, label: "Catálogo", color: "#8ce1bd" },
            ],
          }
        : {
            eyebrow: "TU CIUDAD EN UNA APP",
            title: "Lo que necesitás,\nen movimiento.",
            copy: "Pedí, viajá o enviá con seguimiento y soporte desde una sola cuenta.",
            services: [
              { icon: "restaurant-outline" as const, label: "Comidas", color: "#ffb584" },
              { icon: "car-sport-outline" as const, label: "Viajes", color: "#c9afff" },
              { icon: "cube-outline" as const, label: "Envíos", color: "#8ce1bd" },
            ],
          };

  const returnToEntry = () => {
    setCreating(false);
    setLoginStep("email");
    setRecoveryStep("none");
    setRecoveryToken("");
    setVerificationEmail("");
    setVerificationCode("");
    setPassword("");
    setConfirmation("");
    setPasswordVisible(false);
    setError("");
  };

  const submit = async () => {
    setError("");
    if (verificationEmail) {
      try {
        setRecoveryBusy(true);
        await api.confirmEmailVerification(verificationEmail, verificationCode.trim());
        await onLogin(verificationEmail, password);
        setVerificationEmail("");
        setVerificationCode("");
      } catch (verificationError) {
        setError(
          verificationError instanceof Error
            ? verificationError.message
            : "No se pudo verificar el email",
        );
      } finally {
        setRecoveryBusy(false);
      }
      return;
    }
    if (recoveryStep === "request") {
      if (!emailIsValid) return setError("Ingresá un email válido para recuperar tu cuenta.");
      try {
        setRecoveryBusy(true);
        const result = await api.requestPasswordRecovery(normalizedEmail);
        setRecoveryToken("");
        setRecoveryStep("confirm");
        Alert.alert("Revisá tu email", result.message);
      } catch (recoveryError) {
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "No se pudo iniciar la recuperación",
        );
      } finally {
        setRecoveryBusy(false);
      }
      return;
    }
    if (recoveryStep === "confirm") {
      if (password !== confirmation) return setError("Las contraseñas no coinciden");
      try {
        setRecoveryBusy(true);
        await api.confirmPasswordRecovery(recoveryToken.trim(), password);
        setRecoveryStep("none");
        setLoginStep("password");
        setRecoveryToken("");
        setPassword("");
        setConfirmation("");
        Alert.alert(
          "Contraseña actualizada",
          "Todas las sesiones anteriores fueron cerradas. Ya podés ingresar.",
        );
      } catch (recoveryError) {
        setError(
          recoveryError instanceof Error
            ? recoveryError.message
            : "No se pudo cambiar la contraseña",
        );
      } finally {
        setRecoveryBusy(false);
      }
      return;
    }
    if (!creating && loginStep === "email") {
      if (!emailIsValid) return setError("Ingresá un email válido para continuar.");
      setLoginStep("password");
      return;
    }
    if (creating && password !== confirmation) return setError("Las contraseñas no coinciden");
    try {
      if (creating) {
        const registration = await onRegister({
          name: name.trim(),
          email: normalizedEmail,
          password,
          phone: phone.trim() || undefined,
        });
        setVerificationEmail(normalizedEmail);
        setVerificationCode("");
        setCreating(false);
        Alert.alert("Verificá tu email", "Ingresá el código de seis dígitos que enviamos.");
      } else await onLogin(normalizedEmail, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "No se pudo iniciar sesion");
      if (
        !creating &&
        recoveryStep === "none" &&
        loginError instanceof Error &&
        loginError.message.includes("verificar")
      ) {
        setVerificationEmail(normalizedEmail);
        try {
          await api.resendEmailVerification(normalizedEmail);
          setVerificationCode("");
        } catch (_error) {}
      }
    }
  };

  const isVerification = Boolean(verificationEmail);
  const title = isVerification
    ? "Confirmá que sos vos"
    : recoveryStep === "request"
      ? "Recuperá tu cuenta"
      : recoveryStep === "confirm"
        ? "Creá una contraseña nueva"
        : creating
          ? "Creá tu cuenta Flash"
          : loginStep === "password"
            ? "Te damos la bienvenida"
            : mobileAppVariant === "driver"
              ? "Entrá a Flash Driver"
              : mobileAppVariant === "merchant"
                ? "Entrá a Flash Negocios"
                : "Entrá a Flash";
  const copy = isVerification
    ? `Ingresá el código de seis dígitos que enviamos a ${verificationEmail}.`
    : recoveryStep === "request"
      ? "Te enviaremos instrucciones si encontramos una cuenta con ese email."
      : recoveryStep === "confirm"
        ? "Pegá el código recibido y elegí una contraseña segura."
        : creating
          ? "Comidas, viajes y envíos con una única cuenta protegida."
          : loginStep === "password"
            ? "Ingresá tu contraseña para continuar de forma segura."
            : isCustomerAccess
              ? "Usá tu email para continuar. Tu cuenta funciona en todos los servicios."
              : "Usá el email habilitado para tu espacio de trabajo.";
  const primaryLabel =
    busy || recoveryBusy
      ? "Procesando…"
      : isVerification
        ? "Verificar y entrar"
        : recoveryStep === "request"
          ? "Enviar instrucciones"
          : recoveryStep === "confirm"
            ? "Actualizar contraseña"
            : creating
              ? "Crear cuenta"
              : loginStep === "password"
                ? "Ingresar"
                : "Continuar";
  const primaryDisabled =
    busy ||
    recoveryBusy ||
    (isVerification
      ? verificationCode.length !== 6
      : recoveryStep === "request"
        ? !emailIsValid
        : recoveryStep === "confirm"
          ? !recoveryToken.trim() || password.length < 8 || !confirmation
          : creating
            ? !name.trim() || !emailIsValid || password.length < 8 || !confirmation
            : loginStep === "password"
              ? !emailIsValid || !password
              : !emailIsValid);

  return (
    <LinearGradient
      colors={["#17131c", "#241535", "#5c25bc"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.loginRoot}
    >
      <View pointerEvents="none" style={styles.loginGlow} />
      <View pointerEvents="none" style={styles.loginGlowSecondary} />
      <ScrollView
        style={styles.loginScroll}
        contentContainerStyle={[styles.loginContent, compactAuth && styles.loginContentCompact]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.loginHero, compactAuth && styles.loginHeroCompact]}>
          <View style={styles.loginBrandRow}>
            <View style={styles.loginMark}>
              <Ionicons name="flash" size={23} color={flashDesign.color.brand} />
            </View>
            <Text style={styles.loginWordmark}>Flash</Text>
            <View style={styles.loginSecurePill}>
              <Ionicons name="shield-checkmark" size={13} color="#d6ff72" />
              <Text style={styles.loginSecureText}>Acceso protegido</Text>
            </View>
          </View>
          <View style={styles.loginHeroCopy}>
            <Text style={styles.loginEyebrow}>{audiencePresentation.eyebrow}</Text>
            <Text style={[styles.loginTitle, compactAuth && styles.loginTitleCompact]}>
              {audiencePresentation.title}
            </Text>
            <Text style={styles.loginCopy}>{audiencePresentation.copy}</Text>
          </View>
          <View style={styles.loginServices}>
            {audiencePresentation.services.map((service) => (
              <View key={service.label} style={styles.loginService}>
                <View style={[styles.loginServiceIcon, { backgroundColor: service.color }]}>
                  <Ionicons name={service.icon} size={17} color="#17131c" />
                </View>
                <Text style={styles.loginServiceText}>{service.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.loginCard}>
          <View style={styles.loginCardHeader}>
            {loginStep === "password" || creating || recoveryStep !== "none" || isVerification ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Volver"
                disabled={busy || recoveryBusy}
                onPress={returnToEntry}
                style={styles.loginBack}
              >
                <Ionicons name="arrow-back" size={20} color={flashDesign.color.ink} />
              </Pressable>
            ) : null}
            <View style={styles.loginCardHeading}>
              <Text style={styles.loginCardTitle}>{title}</Text>
              <Text style={styles.loginCardCopy}>{copy}</Text>
            </View>
          </View>

          {!creating && recoveryStep === "none" && loginStep === "password" && !isVerification ? (
            <Pressable
              onPress={() => {
                setLoginStep("email");
                setPassword("");
                setError("");
              }}
              style={styles.loginIdentity}
            >
              <View style={styles.loginIdentityIcon}>
                <Ionicons name="mail-outline" size={17} color={flashDesign.color.brand} />
              </View>
              <Text numberOfLines={1} style={styles.loginIdentityText}>
                {normalizedEmail}
              </Text>
              <Text style={styles.loginIdentityAction}>Cambiar</Text>
            </Pressable>
          ) : null}

          {creating ? (
            <View style={styles.loginFieldGroup}>
              <Text style={styles.loginFieldLabel}>Nombre y apellido</Text>
              <View style={styles.loginInputShell}>
                <Ionicons name="person-outline" size={19} color="#77717d" />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  placeholder="Tu nombre"
                  placeholderTextColor="#918b96"
                  style={styles.loginInput}
                />
              </View>
            </View>
          ) : null}

          {creating || (!isVerification && recoveryStep !== "confirm" && loginStep === "email") ? (
            <View style={styles.loginFieldGroup}>
              <Text style={styles.loginFieldLabel}>Email</Text>
              <View
                style={[
                  styles.loginInputShell,
                  error && !emailIsValid && styles.loginInputShellError,
                ]}
              >
                <Ionicons name="mail-outline" size={19} color="#77717d" />
                <TextInput
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError("");
                  }}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    if (!creating) void submit();
                  }}
                  placeholder="nombre@ejemplo.com"
                  placeholderTextColor="#918b96"
                  style={styles.loginInput}
                />
              </View>
            </View>
          ) : null}

          {creating ? (
            <View style={styles.loginFieldGroup}>
              <View style={styles.loginLabelRow}>
                <Text style={styles.loginFieldLabel}>Teléfono</Text>
                <Text style={styles.loginOptional}>Opcional</Text>
              </View>
              <View style={styles.loginInputShell}>
                <Ionicons name="call-outline" size={19} color="#77717d" />
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  autoComplete="tel"
                  keyboardType="phone-pad"
                  placeholder="+54 11 0000 0000"
                  placeholderTextColor="#918b96"
                  style={styles.loginInput}
                />
              </View>
            </View>
          ) : null}

          {recoveryStep === "confirm" ? (
            <View style={styles.loginFieldGroup}>
              <Text style={styles.loginFieldLabel}>Código de recuperación</Text>
              <View style={styles.loginInputShell}>
                <Ionicons name="key-outline" size={19} color="#77717d" />
                <TextInput
                  value={recoveryToken}
                  onChangeText={setRecoveryToken}
                  autoCapitalize="none"
                  placeholder="Pegá el código recibido"
                  placeholderTextColor="#918b96"
                  style={styles.loginInput}
                />
              </View>
            </View>
          ) : null}

          {isVerification ? (
            <View style={styles.loginFieldGroup}>
              <Text style={styles.loginFieldLabel}>Código de verificación</Text>
              <View style={styles.loginCodeShell}>
                <TextInput
                  accessibilityLabel="Código de 6 dígitos"
                  value={verificationCode}
                  onChangeText={(value) => {
                    setVerificationCode(value.replace(/\D/g, "").slice(0, 6));
                    setError("");
                  }}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  placeholderTextColor="#c5c0c8"
                  style={styles.loginCodeInput}
                />
              </View>
            </View>
          ) : null}

          {!isVerification &&
          recoveryStep !== "request" &&
          (creating || loginStep === "password") ? (
            <View style={styles.loginFieldGroup}>
              <View style={styles.loginLabelRow}>
                <Text style={styles.loginFieldLabel}>
                  {recoveryStep === "confirm" ? "Nueva contraseña" : "Contraseña"}
                </Text>
                {!creating && recoveryStep === "none" ? (
                  <Pressable
                    onPress={() => {
                      setRecoveryStep("request");
                      setPassword("");
                      setConfirmation("");
                      setError("");
                    }}
                  >
                    <Text style={styles.loginInlineAction}>¿La olvidaste?</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.loginInputShell}>
                <Ionicons name="lock-closed-outline" size={19} color="#77717d" />
                <TextInput
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setError("");
                  }}
                  secureTextEntry={!passwordVisible}
                  autoComplete={creating ? "new-password" : "current-password"}
                  placeholder={
                    creating || recoveryStep === "confirm" ? "Mínimo 8 caracteres" : "Tu contraseña"
                  }
                  placeholderTextColor="#918b96"
                  style={styles.loginInput}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                  onPress={() => setPasswordVisible((value) => !value)}
                  hitSlop={10}
                >
                  <Ionicons
                    name={passwordVisible ? "eye-off-outline" : "eye-outline"}
                    size={20}
                    color="#77717d"
                  />
                </Pressable>
              </View>
            </View>
          ) : null}

          {creating || recoveryStep === "confirm" ? (
            <View style={styles.loginFieldGroup}>
              <Text style={styles.loginFieldLabel}>Repetir contraseña</Text>
              <View style={styles.loginInputShell}>
                <Ionicons name="shield-checkmark-outline" size={19} color="#77717d" />
                <TextInput
                  value={confirmation}
                  onChangeText={(value) => {
                    setConfirmation(value);
                    setError("");
                  }}
                  secureTextEntry={!passwordVisible}
                  autoComplete="new-password"
                  placeholder="Volvé a escribirla"
                  placeholderTextColor="#918b96"
                  style={styles.loginInput}
                />
              </View>
              <View style={styles.loginPasswordHint}>
                <Ionicons
                  name={password.length >= 8 ? "checkmark-circle" : "ellipse-outline"}
                  size={15}
                  color={password.length >= 8 ? flashDesign.color.shipment : "#aaa4ad"}
                />
                <Text style={styles.loginPasswordHintText}>Usá al menos 8 caracteres</Text>
              </View>
            </View>
          ) : null}

          {error ? (
            <View accessibilityLiveRegion="polite" style={styles.loginError}>
              <Ionicons name="alert-circle" size={18} color={flashDesign.color.danger} />
              <Text style={styles.loginErrorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={primaryDisabled}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.loginPrimary,
              primaryDisabled && styles.loginPrimaryDisabled,
              pressed && !primaryDisabled && styles.loginPrimaryPressed,
            ]}
          >
            {busy || recoveryBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.loginPrimaryText}>{primaryLabel}</Text>
                <Ionicons name="arrow-forward" size={19} color="#fff" />
              </>
            )}
          </Pressable>

          {isCustomerAccess &&
          !creating &&
          recoveryStep === "none" &&
          loginStep === "email" &&
          !isVerification ? (
            <View style={styles.loginSecondaryBlock}>
              <View style={styles.loginDivider}>
                <View style={styles.loginDividerLine} />
                <Text style={styles.loginDividerText}>¿Primera vez?</Text>
                <View style={styles.loginDividerLine} />
              </View>
              <Pressable
                disabled={busy || recoveryBusy}
                onPress={() => {
                  setCreating(true);
                  setPassword("");
                  setConfirmation("");
                  setError("");
                }}
                style={({ pressed }) => [
                  styles.loginSecondary,
                  pressed && styles.loginSecondaryPressed,
                ]}
              >
                <Text style={styles.loginSecondaryText}>Crear una cuenta</Text>
              </Pressable>
            </View>
          ) : null}

          {!isCustomerAccess &&
          !creating &&
          recoveryStep === "none" &&
          loginStep === "email" &&
          !isVerification ? (
            <View style={styles.loginAudienceNote}>
              <View style={styles.loginAudienceNoteIcon}>
                <Ionicons name="business-outline" size={17} color={flashDesign.color.brand} />
              </View>
              <Text style={styles.loginAudienceNoteText}>
                {mobileAppVariant === "driver"
                  ? "El alta de conductor requiere identidad, vehículo y documentos aprobados."
                  : "El acceso se habilita desde el onboarding verificado de tu negocio."}
              </Text>
            </View>
          ) : null}

          {creating ? (
            <Pressable
              disabled={busy || recoveryBusy}
              style={styles.loginSwitch}
              onPress={returnToEntry}
            >
              <Text style={styles.loginSwitchText}>
                ¿Ya tenés cuenta? <Text style={styles.loginSwitchStrong}>Ingresar</Text>
              </Text>
            </Pressable>
          ) : null}
          {recoveryStep !== "none" ? (
            <Pressable
              disabled={busy || recoveryBusy}
              style={styles.loginSwitch}
              onPress={() => {
                setRecoveryStep("none");
                setLoginStep("password");
                setRecoveryToken("");
                setPassword("");
                setConfirmation("");
                setError("");
              }}
            >
              <Text style={styles.loginSwitchText}>Volver a ingresar</Text>
            </Pressable>
          ) : null}
          {isVerification ? (
            <View style={styles.loginVerificationActions}>
              <Pressable
                disabled={busy || recoveryBusy}
                style={styles.loginSwitch}
                onPress={async () => {
                  try {
                    setRecoveryBusy(true);
                    const resent = await api.resendEmailVerification(verificationEmail);
                    setVerificationCode("");
                    Alert.alert("Código reenviado", resent.message);
                  } catch (resendError) {
                    setError(
                      resendError instanceof Error ? resendError.message : "No se pudo reenviar",
                    );
                  } finally {
                    setRecoveryBusy(false);
                  }
                }}
              >
                <Text style={styles.loginSwitchText}>Reenviar código</Text>
              </Pressable>
              <Pressable
                disabled={busy || recoveryBusy}
                style={styles.loginSwitch}
                onPress={returnToEntry}
              >
                <Text style={styles.loginSwitchText}>Usar otra cuenta</Text>
              </Pressable>
            </View>
          ) : null}

          {creating ||
          (isCustomerAccess &&
            !isVerification &&
            recoveryStep === "none" &&
            loginStep === "email") ? (
            <Text style={styles.loginLegal}>
              Al continuar aceptás los Términos y reconocés la Política de privacidad de Flash.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}
