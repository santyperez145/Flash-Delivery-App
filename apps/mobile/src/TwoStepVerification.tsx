import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "./api";
import { flashDesign } from "./design-system";
import { disableMfa, enrollMfa, getMfaStatus, regenerateMfaRecoveryCodes } from "./mfa-api";
import type { MfaEnrollment, MfaStatus } from "./types";

// Verificación en dos pasos de la cuenta (SEG-08), como Uber y Mercado Pago. Mismo
// comportamiento que la web. En el teléfono no se puede escanear la propia
// pantalla: la app autenticadora se abre con el enlace `otpauth`, o se copia la
// clave. Los códigos de recuperación se comparten (a un gestor de contraseñas o
// a notas) y nunca se guardan en el dispositivo.

const mensaje = (error: unknown, otro: string) => (error instanceof Error ? error.message : otro);

function Boton({
  texto,
  onPress,
  tipo = "primario",
  deshabilitado = false,
  icono,
}: {
  texto: string;
  onPress: () => void;
  tipo?: "primario" | "secundario" | "peligro";
  deshabilitado?: boolean;
  icono?: keyof typeof Ionicons.glyphMap;
}) {
  const secundario = tipo === "secundario";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      disabled={deshabilitado}
      onPress={onPress}
      style={[
        estilos.boton,
        secundario && estilos.botonSecundario,
        tipo === "peligro" && estilos.botonPeligro,
        deshabilitado && estilos.apagado,
      ]}
    >
      {icono ? (
        <Ionicons name={icono} size={16} color={secundario ? flashDesign.color.ink : "#fff"} />
      ) : null}
      <Text style={secundario ? estilos.botonTextoSecundario : estilos.botonTexto}>{texto}</Text>
    </Pressable>
  );
}

function Codigos({ codigos }: { codigos: string[] }) {
  const guardar = () =>
    void Share.share({
      title: "Códigos de recuperación de Flash",
      message: `Flash · Códigos de recuperación\n\n${codigos.join("\n")}\n\nCada código sirve una sola vez.`,
    }).catch(() => undefined);
  return (
    <View style={estilos.codigos}>
      <Text style={estilos.texto}>
        Si perdés el teléfono, cada código te deja entrar una vez. Se muestran sólo ahora.
      </Text>
      <View style={estilos.grilla} accessibilityLabel="Códigos de recuperación">
        {codigos.map((codigo) => (
          <Text key={codigo} selectable style={estilos.codigo}>
            {codigo}
          </Text>
        ))}
      </View>
      <Boton texto="Guardarlos" tipo="secundario" icono="share-outline" onPress={guardar} />
    </View>
  );
}

export function TwoStepVerification() {
  const [estado, setEstado] = useState<MfaStatus | null>(null);
  const [falloCarga, setFalloCarga] = useState("");
  const [alta, setAlta] = useState<MfaEnrollment | null>(null);
  const [codigo, setCodigo] = useState("");
  const [accion, setAccion] = useState<"desactivar" | "regenerar" | null>(null);
  const [nuevos, setNuevos] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(() => {
    setFalloCarga("");
    getMfaStatus()
      .then((respuesta) => setEstado(respuesta.mfa))
      .catch((fallo) =>
        setFalloCarga(mensaje(fallo, "No pudimos ver tu verificación en dos pasos")),
      );
  }, []);
  useEffect(() => cargar(), [cargar]);

  const correr = async (tarea: () => Promise<void>, otro: string) => {
    setOcupado(true);
    setError("");
    setAviso("");
    try {
      await tarea();
    } catch (fallo) {
      setError(mensaje(fallo, otro));
    } finally {
      setOcupado(false);
    }
  };
  const empezar = () =>
    correr(async () => {
      setNuevos(null);
      setAlta((await enrollMfa()).enrollment);
    }, "No se pudo empezar la activación");
  const confirmar = () =>
    correr(async () => {
      const respuesta = await api.confirmMfa(codigo);
      setEstado(respuesta.mfa);
      setAlta(null);
      setCodigo("");
      setAviso(
        respuesta.revokedSessions
          ? `Listo: quedó activa y cerramos ${respuesta.revokedSessions} sesión(es) en otros dispositivos.`
          : "Listo: la verificación en dos pasos quedó activa.",
      );
    }, "Código inválido");
  const terminar = () =>
    correr(async () => {
      if (accion === "desactivar") {
        setEstado((await disableMfa(codigo)).mfa);
        setAviso("Desactivaste la verificación en dos pasos.");
      } else {
        const respuesta = await regenerateMfaRecoveryCodes(codigo);
        setEstado(respuesta.mfa);
        setNuevos(respuesta.recoveryCodes);
        setAviso("Generamos códigos nuevos: los anteriores ya no sirven.");
      }
      setAccion(null);
      setCodigo("");
    }, "Código inválido");

  if (falloCarga)
    return (
      <Pressable accessibilityRole="button" onPress={cargar} style={estilos.caja}>
        <Text style={estilos.error}>{falloCarga} · Reintentar</Text>
      </Pressable>
    );
  if (!estado)
    return (
      <View style={estilos.caja}>
        <Text style={estilos.texto}>Consultando la seguridad de tu cuenta…</Text>
      </View>
    );

  const bloqueado = Boolean(estado.lockedUntil && new Date(estado.lockedUntil) > new Date());
  return (
    <View style={estilos.caja} accessibilityLabel="Verificación en dos pasos">
      <View style={estilos.cabecera}>
        <Ionicons
          name={estado.enabled ? "shield-checkmark-outline" : "shield-outline"}
          size={22}
          color={flashDesign.color.ink}
        />
        <Text style={estilos.titulo}>Verificación en dos pasos</Text>
        <Text style={[estilos.chip, estado.enabled ? estilos.chipActiva : estilos.chipApagada]}>
          {estado.enabled ? "Activa" : "Desactivada"}
        </Text>
      </View>

      {estado.enabled ? (
        <Text style={estilos.texto}>
          Te pedimos un código al ingresar en un dispositivo nuevo, eliminar tu cuenta o autorizar
          un retiro. Te quedan {estado.recoveryCodesRemaining} códigos de recuperación
          {estado.recoveryCodesRemaining <= 2 ? ": generá nuevos." : "."}
        </Text>
      ) : !alta ? (
        <Text style={estilos.texto}>
          Sumá a tu contraseña un código de una app autenticadora (Google Authenticator, Microsoft
          Authenticator, 1Password o Authy). Aunque alguien la sepa, no puede entrar ni mover tu
          plata sin tu teléfono.
        </Text>
      ) : null}
      {bloqueado ? (
        <Text style={estilos.error}>
          Demasiados códigos inválidos: probá de nuevo en 15 minutos.
        </Text>
      ) : null}

      {!estado.enabled && !alta ? (
        <Boton
          texto={ocupado ? "Preparando…" : "Activar"}
          icono="key-outline"
          deshabilitado={ocupado}
          onPress={() => void empezar()}
        />
      ) : null}

      {alta ? (
        <View style={estilos.pasos}>
          <Text style={estilos.paso}>1. Agregá tu cuenta a la app autenticadora</Text>
          <Boton
            texto="Abrir la app autenticadora"
            tipo="secundario"
            icono="open-outline"
            onPress={() =>
              void Linking.openURL(alta.otpauthUri).catch(() =>
                setError("No encontramos una app autenticadora: ingresá la clave a mano."),
              )
            }
          />
          <Text style={estilos.texto}>O ingresá esta clave a mano:</Text>
          <Text selectable style={estilos.codigo}>
            {alta.secret}
          </Text>
          <Text style={estilos.paso}>2. Guardá tus códigos de recuperación</Text>
          <Codigos codigos={alta.recoveryCodes} />
          <Text style={estilos.paso}>3. Ingresá el código de 6 dígitos que muestra la app</Text>
          <TextInput
            value={codigo}
            onChangeText={(texto) => setCodigo(texto.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            placeholder="000000"
            accessibilityLabel="Código de la app autenticadora"
            style={estilos.input}
          />
          <View style={estilos.fila}>
            <Boton
              texto="Cancelar"
              tipo="secundario"
              deshabilitado={ocupado}
              onPress={() => {
                setAlta(null);
                setCodigo("");
              }}
            />
            <Boton
              texto={ocupado ? "Verificando…" : "Activar verificación"}
              deshabilitado={ocupado || codigo.length !== 6}
              onPress={() => void confirmar()}
            />
          </View>
        </View>
      ) : null}

      {estado.enabled && !accion ? (
        <View style={estilos.fila}>
          <Boton
            texto="Códigos nuevos"
            tipo="secundario"
            icono="refresh-outline"
            onPress={() => setAccion("regenerar")}
          />
          <Boton texto="Desactivar" tipo="peligro" onPress={() => setAccion("desactivar")} />
        </View>
      ) : null}
      {estado.enabled && accion ? (
        <View style={estilos.pasos}>
          <Text style={estilos.texto}>
            {accion === "desactivar"
              ? "Para desactivarla, ingresá un código de la app o uno de recuperación."
              : "Para generar códigos nuevos, ingresá un código de la app o uno de recuperación."}
          </Text>
          <TextInput
            value={codigo}
            onChangeText={(texto) => setCodigo(texto.trim().toUpperCase().slice(0, 16))}
            autoCapitalize="characters"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            placeholder="000000 o ABCD-1234"
            accessibilityLabel="Código de verificación"
            style={estilos.input}
          />
          <View style={estilos.fila}>
            <Boton
              texto="Cancelar"
              tipo="secundario"
              deshabilitado={ocupado}
              onPress={() => {
                setAccion(null);
                setCodigo("");
              }}
            />
            <Boton
              texto={ocupado ? "Verificando…" : accion === "desactivar" ? "Desactivar" : "Generar"}
              tipo={accion === "desactivar" ? "peligro" : "primario"}
              deshabilitado={ocupado || codigo.length < 6}
              onPress={() => void terminar()}
            />
          </View>
        </View>
      ) : null}
      {nuevos ? <Codigos codigos={nuevos} /> : null}

      {error ? <Text style={estilos.error}>{error}</Text> : null}
      {aviso ? <Text style={estilos.aviso}>{aviso}</Text> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  caja: {
    gap: flashDesign.space.sm,
    padding: flashDesign.space.md,
    marginBottom: flashDesign.space.sm,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  cabecera: { flexDirection: "row", alignItems: "center", gap: flashDesign.space.xs },
  titulo: { flex: 1, color: flashDesign.color.ink, fontSize: 15, fontWeight: "800" },
  chip: {
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: flashDesign.radius.pill,
    fontSize: 12,
    fontWeight: "800",
  },
  chipActiva: { color: "#0f6b3a", backgroundColor: "#ddf5e7" },
  chipApagada: {
    color: flashDesign.color.inkSoft,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  texto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata, lineHeight: 19 },
  paso: { color: flashDesign.color.ink, fontWeight: "800" },
  pasos: { gap: flashDesign.space.xs },
  codigos: { gap: flashDesign.space.xs },
  grilla: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  codigo: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: flashDesign.color.ink,
    fontFamily: "monospace",
    letterSpacing: 1,
    backgroundColor: flashDesign.color.canvas,
    borderRadius: 8,
  },
  input: {
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.sm,
    color: flashDesign.color.ink,
    fontSize: 18,
    letterSpacing: 2,
    backgroundColor: flashDesign.color.canvas,
    borderRadius: flashDesign.radius.control,
  },
  fila: { flexDirection: "row", flexWrap: "wrap", gap: flashDesign.space.xs },
  boton: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.ink,
  },
  botonSecundario: { backgroundColor: flashDesign.color.surfaceMuted },
  botonPeligro: { backgroundColor: flashDesign.color.danger },
  apagado: { opacity: 0.45 },
  botonTexto: { color: "#fff", fontWeight: "800" },
  botonTextoSecundario: { color: flashDesign.color.ink, fontWeight: "800" },
  error: {
    color: flashDesign.color.danger,
    fontSize: flashDesign.type.metadata,
    fontWeight: "700",
  },
  aviso: { color: "#0f6b3a", fontSize: flashDesign.type.metadata, fontWeight: "700" },
});
