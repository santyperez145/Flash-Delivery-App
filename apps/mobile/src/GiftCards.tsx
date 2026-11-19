import { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";

import { flashDesign } from "./design-system";
import { money } from "./format";
import {
  cancelGiftCard,
  claimGiftCard,
  getGiftCards,
  purchaseGiftCard,
  redeemGiftCardCode,
} from "./gift-card-api";
import { getMfaStatus } from "./mfa-api";
import type { GiftCard, ReceivedGiftCard } from "./types";

// Tarjetas de regalo (PAG-04), como las de Uber: se compran con el saldo de Flash
// Wallet y se regalan con el código o dirigidas a otra cuenta Flash. Quien la
// recibe la canjea y el importe entra a su Wallet. No vence. Quien la compró la
// anula mientras nadie la canjeó. Mismo comportamiento que la web. El código se
// comparte con la hoja del sistema (WhatsApp, mensajes, mail).

const MINIMO = 1000;
const SUGERIDOS = [5000, 10000, 20000];
const estadoTexto: Record<GiftCard["status"], string> = {
  active: "Vigente",
  redeemed: "Canjeada",
  cancelled: "Anulada",
};
// `randomUUID` existe en Hermes desde RN 0.74; los tipos no lo declaran.
const nuevaClave = () =>
  `gift-${
    (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`;
const mensaje = (error: unknown) =>
  error instanceof Error ? error.message : "No se pudo completar";

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

const compartir = (card: GiftCard) => {
  if (!card.code) return;
  void Share.share({
    title: "Tarjeta de regalo de Flash",
    message: `Te regalo ${money.format(card.amount)} para usar en Flash. Canjealo en la Wallet con el código ${card.code}`,
  }).catch(() => undefined);
};

export function GiftCards({
  wallet,
  onWalletChanged,
}: {
  /** El saldo de la Wallet: una tarjeta no puede costar más. */
  wallet: number;
  /** La Wallet cambió (compra, canje o anulación): la cuenta se vuelve a leer. */
  onWalletChanged: () => void;
}) {
  const [compradas, setCompradas] = useState<GiftCard[]>([]);
  const [recibidas, setRecibidas] = useState<ReceivedGiftCard[]>([]);
  const [fallo, setFallo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [monto, setMonto] = useState(String(SUGERIDOS[1]));
  const [email, setEmail] = useState("");
  const [nota, setNota] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");
  // `null`: no se pudo saber. El campo se muestra, pero no se exige: el servidor
  // responde si hace falta. Exigirlo dejaba sin poder comprar a quien no la usa
  // cada vez que la lectura fallaba (por ejemplo, sin conexión).
  const [conMfa, setConMfa] = useState<boolean | null>(false);
  const [codigoCanje, setCodigoCanje] = useState("");
  const [recien, setRecien] = useState<GiftCard | null>(null);
  // Una clave por compra: un reintento tras un corte devuelve la misma tarjeta. Si
  // cambian el importe, el destinatario o el mensaje, es otra compra y lleva otra clave
  // (el servidor además rechaza una clave repetida con otros datos).
  const clave = useRef(nuevaClave());
  useEffect(() => {
    clave.current = nuevaClave();
  }, [monto, email, nota]);

  const cargar = useCallback(
    () =>
      getGiftCards()
        .then((respuesta) => {
          setCompradas(respuesta.purchased);
          setRecibidas(respuesta.received);
          setFallo(false);
        })
        .catch(() => setFallo(true)),
    [],
  );
  // Con la verificación en dos pasos activa, comprar pide el código. El estado se
  // lee al abrir y **otra vez antes de comprar**: se puede activar en esta misma
  // pantalla, y sin el campo la compra fallaría sin forma de mandar el código.
  const releerMfa = useCallback(
    () =>
      getMfaStatus()
        .then((respuesta): boolean | null => respuesta.mfa.enabled)
        .catch(() => null)
        .then((activa) => {
          setConMfa(activa);
          return activa;
        }),
    [],
  );
  useEffect(() => {
    void cargar();
    void releerMfa();
  }, [cargar, releerMfa]);

  const importe = Number(monto);
  const importeValido = Number.isInteger(importe) && importe >= MINIMO;
  const alcanza = importeValido && importe <= wallet;

  const hacer = async (id: string, trabajo: () => Promise<string>) => {
    setOcupado(id);
    setAviso(null);
    try {
      setAviso({ texto: await trabajo(), error: false });
      onWalletChanged();
      await cargar();
    } catch (error) {
      setAviso({ texto: mensaje(error), error: true });
      // Una compra cuya respuesta se perdió pudo haberse hecho: la lista lo muestra.
      void cargar();
    } finally {
      setOcupado(null);
    }
  };

  const comprar = () =>
    void hacer("comprar", async () => {
      // Sólo si no hay un código escrito: con uno, se manda y el servidor decide.
      if (!codigoMfa && conMfa !== true && (await releerMfa()) === true)
        throw new Error("Escribí el código de tu app autenticadora para comprar");
      const conCodigo = conMfa !== false && Boolean(codigoMfa);
      const { card } = await purchaseGiftCard(
        {
          amount: importe,
          ...(email.trim() ? { recipientEmail: email.trim() } : {}),
          ...(nota.trim() ? { message: nota.trim() } : {}),
          ...(conCodigo ? { mfaCode: codigoMfa } : {}),
        },
        clave.current,
      ).catch((fallo: unknown) => {
        // Un 403 que pide el código, entre otros: se vuelve a leer el estado.
        void releerMfa();
        // El código pudo haberse usado aunque la compra fallara: sirve una sola vez.
        if (conCodigo) {
          setCodigoMfa("");
          throw new Error(
            `${fallo instanceof Error ? fallo.message : "No se pudo comprar"}. Para reintentar, escribí un código nuevo.`,
          );
        }
        throw fallo;
      });
      clave.current = nuevaClave();
      setRecien(card);
      setEmail("");
      setNota("");
      setCodigoMfa("");
      return `Compraste una tarjeta de ${money.format(card.amount)}`;
    });

  const anular = (tarjeta: GiftCard) =>
    Alert.alert(
      "¿Anular la tarjeta?",
      `El código deja de servir y ${money.format(tarjeta.amount)} vuelven a tu Wallet.`,
      [
        { text: "Volver", style: "cancel" },
        {
          text: "Anular",
          style: "destructive",
          onPress: () =>
            void hacer(tarjeta.id, async () => {
              await cancelGiftCard(tarjeta.id);
              if (recien?.id === tarjeta.id) setRecien(null);
              return `Anulada: ${money.format(tarjeta.amount)} volvieron a tu Wallet`;
            }),
        },
      ],
    );

  return (
    <View style={estilos.caja} accessibilityLabel="Tarjetas de regalo">
      <View style={estilos.cabecera}>
        <Ionicons name="gift-outline" size={22} color={flashDesign.color.brand} />
        <View style={estilos.cabeceraTexto}>
          <Text style={estilos.titulo}>Tarjetas de regalo</Text>
          <Text style={estilos.texto}>
            Regalá saldo de Flash para pedidos, viajes y envíos. No vence y no se cambia por dinero.
          </Text>
        </View>
      </View>

      {fallo && (
        <View style={estilos.fila}>
          <Text style={estilos.error}>No pudimos leer tus tarjetas de regalo.</Text>
          <Boton texto="Reintentar" tipo="secundario" onPress={() => void cargar()} />
        </View>
      )}

      {recibidas.map((tarjeta) => (
        <View key={tarjeta.id} style={[estilos.tarjeta, estilos.recibida]}>
          <Text style={estilos.tarjetaTitulo}>
            {tarjeta.fromName} te regaló {money.format(tarjeta.amount)}
          </Text>
          {tarjeta.message ? <Text style={estilos.nota}>“{tarjeta.message}”</Text> : null}
          <Boton
            texto="Canjear"
            icono="wallet-outline"
            deshabilitado={ocupado === tarjeta.id}
            onPress={() =>
              void hacer(tarjeta.id, async () => {
                const { card } = await claimGiftCard(tarjeta.id);
                return `Listo: sumaste ${money.format(card.amount)} a tu Flash Wallet`;
              })
            }
          />
        </View>
      ))}

      <Text style={estilos.etiqueta}>¿Te regalaron un código?</Text>
      <View style={estilos.filaCanje}>
        <TextInput
          value={codigoCanje}
          onChangeText={(valor) => setCodigoCanje(valor.toUpperCase())}
          placeholder="ABCD-EFGH-JKLM-NPQR"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={24}
          accessibilityLabel="Código de la tarjeta de regalo"
          style={[estilos.input, estilos.inputCodigo]}
        />
        <Boton
          texto="Canjear"
          deshabilitado={!codigoCanje.trim() || ocupado === "canjear"}
          onPress={() =>
            void hacer("canjear", async () => {
              const { card } = await redeemGiftCardCode(codigoCanje.trim());
              setCodigoCanje("");
              return `Listo: sumaste ${money.format(card.amount)} a tu Flash Wallet`;
            })
          }
        />
      </View>

      <Text style={estilos.subtitulo}>Regalar una tarjeta</Text>
      <View style={estilos.fila} accessibilityRole="radiogroup">
        {SUGERIDOS.map((sugerido) => (
          <Pressable
            key={sugerido}
            accessibilityRole="radio"
            accessibilityState={{ checked: importe === sugerido }}
            onPress={() => setMonto(String(sugerido))}
            style={[estilos.chip, importe === sugerido && estilos.chipActivo]}
          >
            <Text style={importe === sugerido ? estilos.chipTextoActivo : estilos.chipTexto}>
              {money.format(sugerido)}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={monto}
        onChangeText={(valor) => setMonto(valor.replace(/\D/g, ""))}
        keyboardType="number-pad"
        accessibilityLabel="Importe de la tarjeta"
        style={estilos.input}
      />
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email de quien la recibe (opcional)"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={254}
        accessibilityLabel="Email de quien la recibe"
        style={estilos.input}
      />
      <TextInput
        value={nota}
        onChangeText={setNota}
        placeholder="Mensaje (opcional)"
        maxLength={140}
        accessibilityLabel="Mensaje"
        style={estilos.input}
      />
      {conMfa !== false && (
        <TextInput
          value={codigoMfa}
          onChangeText={(valor) => setCodigoMfa(valor.replace(/\s/g, ""))}
          placeholder={
            conMfa ? "Código de tu app autenticadora" : "Código de tu app autenticadora, si la usás"
          }
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={32}
          accessibilityLabel="Código de tu app autenticadora"
          style={estilos.input}
        />
      )}
      {importeValido && !alcanza ? (
        <Text style={estilos.texto}>
          Tu saldo es {money.format(wallet)}: cargá la Wallet primero.
        </Text>
      ) : null}
      <Boton
        texto={
          importeValido ? `Comprar por ${money.format(importe)}` : `Mínimo ${money.format(MINIMO)}`
        }
        icono="gift-outline"
        deshabilitado={!alcanza || ocupado === "comprar" || (conMfa === true && !codigoMfa)}
        onPress={comprar}
      />

      {recien?.code ? (
        <View style={estilos.nueva} accessibilityLiveRegion="polite">
          <Text style={estilos.nuevaTexto}>Tu tarjeta de {money.format(recien.amount)}</Text>
          <Text selectable style={estilos.nuevaCodigo}>
            {recien.code}
          </Text>
          <Boton texto="Compartir" icono="share-outline" onPress={() => compartir(recien)} />
        </View>
      ) : null}

      {aviso ? (
        <Text style={aviso.error ? estilos.error : estilos.aviso} accessibilityLiveRegion="polite">
          {aviso.texto}
        </Text>
      ) : null}

      {compradas.length > 0 && <Text style={estilos.subtitulo}>Las que regalaste</Text>}
      {compradas.map((tarjeta) => (
        <View key={tarjeta.id} style={estilos.tarjeta}>
          <View style={estilos.fila}>
            <Text style={estilos.tarjetaTitulo}>{money.format(tarjeta.amount)}</Text>
            <Text
              style={[
                estilos.estado,
                tarjeta.status === "active" ? estilos.estadoVigente : estilos.estadoCerrado,
              ]}
            >
              {estadoTexto[tarjeta.status]}
            </Text>
          </View>
          <Text style={estilos.texto}>
            {tarjeta.recipientEmail ? `Para ${tarjeta.recipientEmail} · ` : ""}
            {new Date(tarjeta.createdAt).toLocaleDateString("es-AR")}
            {tarjeta.code ? "" : ` · termina en ${tarjeta.last4}`}
          </Text>
          {tarjeta.code ? (
            <Text selectable style={estilos.codigo}>
              {tarjeta.code}
            </Text>
          ) : null}
          {tarjeta.status === "active" && tarjeta.code ? (
            <View style={estilos.fila}>
              <Boton
                texto="Compartir"
                tipo="secundario"
                icono="share-outline"
                onPress={() => compartir(tarjeta)}
              />
              <Boton
                texto="Anular"
                tipo="peligro"
                deshabilitado={ocupado === tarjeta.id}
                onPress={() => anular(tarjeta)}
              />
            </View>
          ) : null}
        </View>
      ))}
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
  cabecera: { flexDirection: "row", alignItems: "flex-start", gap: flashDesign.space.xs },
  cabeceraTexto: { flex: 1, gap: 2 },
  titulo: { color: flashDesign.color.ink, fontSize: 15, fontWeight: "800" },
  subtitulo: { color: flashDesign.color.ink, fontSize: flashDesign.type.body, fontWeight: "800" },
  etiqueta: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.metadata,
    fontWeight: "700",
  },
  texto: { color: flashDesign.color.inkSoft, fontSize: flashDesign.type.metadata, lineHeight: 19 },
  nota: { color: flashDesign.color.inkSoft, fontStyle: "italic" },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: flashDesign.space.xs },
  filaCanje: { flexDirection: "row", gap: flashDesign.space.xs },
  input: {
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.sm,
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.body,
    backgroundColor: flashDesign.color.canvas,
    borderRadius: flashDesign.radius.control,
  },
  inputCodigo: { flex: 1, fontFamily: "monospace", letterSpacing: 1 },
  chip: {
    justifyContent: "center",
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.md,
    borderRadius: flashDesign.radius.pill,
    backgroundColor: flashDesign.color.surfaceMuted,
  },
  chipActivo: { backgroundColor: flashDesign.color.ink },
  chipTexto: { color: flashDesign.color.ink, fontWeight: "800" },
  chipTextoActivo: { color: "#fff", fontWeight: "800" },
  tarjeta: {
    gap: flashDesign.space.xs,
    padding: flashDesign.space.sm,
    borderRadius: flashDesign.radius.control,
    backgroundColor: flashDesign.color.canvas,
  },
  recibida: { backgroundColor: "#f3ecff" },
  tarjetaTitulo: {
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.body,
    fontWeight: "800",
  },
  codigo: {
    color: flashDesign.color.ink,
    fontFamily: "monospace",
    fontSize: 15,
    letterSpacing: 1,
  },
  estado: {
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: flashDesign.radius.pill,
    fontSize: 12,
    fontWeight: "800",
  },
  estadoVigente: { color: "#0f6b3a", backgroundColor: "#ddf5e7" },
  estadoCerrado: { color: flashDesign.color.inkSoft, backgroundColor: flashDesign.color.surface },
  nueva: {
    gap: flashDesign.space.xs,
    padding: flashDesign.space.md,
    borderRadius: flashDesign.radius.card,
    backgroundColor: flashDesign.color.brandDeep,
  },
  nuevaTexto: { color: "#fff", fontWeight: "700" },
  nuevaCodigo: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
  },
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
