import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { deleteAccount } from "./account-api";
import { flashDesign } from "./design-system";
import { getMfaStatus } from "./mfa-api";

// Eliminar la cuenta desde la app (LAN-001). Apple y Google lo exigen en toda
// app que permite crear cuentas, así que va en las tres variantes. Mismo
// contrato y mismos textos que `src/ui/AccountDeletion.tsx` de la web: antes de
// pedir la contraseña dice qué se borra y qué se conserva.

const ROJO = flashDesign.color.danger;

export function AccountDeletion({ onDeleted }: { onDeleted: () => Promise<void> | void }) {
  const [abierto, setAbierto] = useState(false);
  const [password, setPassword] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<"deleted" | "requested" | null>(null);
  // Con la verificación en dos pasos activa (SEG-08) también se pide el código. Si
  // no se puede saber, se muestra el campo: el servidor decide si lo exige.
  const [conCodigo, setConCodigo] = useState(false);
  const [codigo, setCodigo] = useState("");
  useEffect(() => {
    if (!abierto) return;
    getMfaStatus()
      .then((respuesta) => setConCodigo(respuesta.mfa.enabled))
      .catch(() => setConCodigo(true));
  }, [abierto]);
  const listo = Boolean(password) && (!conCodigo || codigo.length >= 6);

  const eliminar = async () => {
    setOcupado(true);
    setError("");
    try {
      const { status } = await deleteAccount(password, conCodigo ? codigo : undefined);
      setPassword("");
      setCodigo("");
      setResultado(status);
      // El servidor ya cerró las sesiones; esto limpia la guardada en el teléfono.
      if (status === "deleted") await onDeleted();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo eliminar la cuenta");
    } finally {
      setOcupado(false);
    }
  };

  if (resultado)
    return (
      <View style={estilos.caja} accessibilityRole="summary">
        <Text style={estilos.titulo}>
          {resultado === "deleted" ? "Tu cuenta fue eliminada" : "Recibimos tu solicitud"}
        </Text>
        <Text style={estilos.texto}>
          {resultado === "deleted"
            ? "Borramos tus datos personales y cerramos todas tus sesiones."
            : "Tu cuenta tiene pagos o liquidaciones pendientes. Soporte te va a contactar para cerrarlos y eliminarla."}
        </Text>
      </View>
    );

  if (!abierto)
    return (
      <Pressable
        onPress={() => setAbierto(true)}
        style={estilos.abrir}
        accessibilityRole="button"
        accessibilityLabel="Eliminar mi cuenta"
      >
        <Text style={estilos.abrirTexto}>Eliminar mi cuenta</Text>
      </Pressable>
    );

  return (
    <View style={estilos.caja}>
      <Text style={estilos.titulo}>Eliminar tu cuenta</Text>
      {[
        "Se borran tu nombre, correo, teléfono, direcciones, dispositivos y preferencias.",
        "Se desactivan tus métodos de pago guardados y tu suscripción.",
        "Tus pedidos, pagos y comprobantes se conservan sin tus datos, porque son registros que la ley obliga a guardar.",
        "No se puede deshacer.",
      ].map((linea) => (
        <Text key={linea} style={estilos.texto}>
          • {linea}
        </Text>
      ))}
      <TextInput
        value={password}
        onChangeText={setPassword}
        editable={!ocupado}
        secureTextEntry
        autoComplete="current-password"
        placeholder="Confirmá con tu contraseña"
        placeholderTextColor={flashDesign.color.muted}
        style={estilos.campo}
        accessibilityLabel="Contraseña para confirmar"
      />
      {conCodigo ? (
        <TextInput
          value={codigo}
          onChangeText={(texto) => setCodigo(texto.trim())}
          editable={!ocupado}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          placeholder="Código de tu app autenticadora"
          placeholderTextColor={flashDesign.color.muted}
          style={estilos.campo}
          accessibilityLabel="Código de verificación en dos pasos"
        />
      ) : null}
      {error ? (
        <Text style={estilos.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={estilos.acciones}>
        <Pressable
          onPress={() => setAbierto(false)}
          disabled={ocupado}
          style={estilos.boton}
          accessibilityRole="button"
        >
          <Text style={estilos.botonTexto}>Cancelar</Text>
        </Pressable>
        <Pressable
          onPress={() => void eliminar()}
          disabled={ocupado || !listo}
          style={[estilos.boton, estilos.peligro, (ocupado || !listo) && estilos.inactivo]}
          accessibilityRole="button"
          accessibilityLabel="Eliminar definitivamente"
        >
          <Text style={[estilos.botonTexto, estilos.peligroTexto]}>
            {ocupado ? "Eliminando…" : "Eliminar definitivamente"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  abrir: {
    alignSelf: "flex-start",
    marginHorizontal: flashDesign.space.md,
    marginVertical: 18,
    paddingVertical: 8,
  },
  abrirTexto: { color: ROJO, fontSize: 14, fontWeight: "700" },
  caja: {
    gap: 8,
    margin: flashDesign.space.md,
    padding: 14,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: ROJO,
    borderRadius: 14,
  },
  titulo: { color: flashDesign.color.ink, fontSize: 15, fontWeight: "800" },
  texto: { color: flashDesign.color.inkSoft, fontSize: 13, lineHeight: 19 },
  campo: {
    padding: 12,
    color: flashDesign.color.ink,
    fontSize: 14,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    borderRadius: 12,
  },
  error: { color: ROJO, fontSize: 13, fontWeight: "700" },
  acciones: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" },
  boton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
    borderRadius: 12,
  },
  botonTexto: { color: flashDesign.color.ink, fontSize: 14, fontWeight: "700" },
  peligro: { backgroundColor: ROJO, borderColor: ROJO },
  peligroTexto: { color: "#fff" },
  inactivo: { opacity: 0.55 },
});
