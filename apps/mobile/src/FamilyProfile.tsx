import { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { flashDesign } from "./design-system";
import {
  getFamilyChargeReceipt,
  getFamilyProfile,
  inviteFamilyMember,
  leaveFamilyProfile,
  removeFamilyMember,
  respondFamilyInvitation,
  setFamilyMemberLimit,
} from "./family-profile-api";
import { money } from "./format";
import { getMfaStatus } from "./mfa-api";
import type { FamilyCharge, FamilyMember, FamilyProfile as FamilyProfileState } from "./types";

// Perfil familiar (PAG-05), como el de Uber: la Flash Wallet de quien organiza paga
// los viajes, envíos y pedidos de las personas que invita, cuando eligen «Perfil
// familiar» al pagar. Quien organiza pone un tope por mes a cada una (o ninguno) y
// las saca cuando quiere. Quien es miembro ve quién paga y cuánto le queda, nunca el
// saldo de quien organiza. Mismo comportamiento que la web.

const estadoTexto: Record<FamilyMember["status"], string> = {
  invited: "Invitado",
  active: "Activo",
};
const mensaje = (error: unknown) =>
  error instanceof Error ? error.message : "No se pudo completar";
const topeTexto = (tope: number | null) =>
  tope === null ? "Sin tope" : `Tope ${money.format(tope)} por mes`;
const servicioTexto: Record<FamilyCharge["service"], string> = {
  order: "Pedido",
  ride: "Viaje",
  shipment: "Envío",
};
/** El servidor manda hasta 20; el tope se repite acá por si una versión manda más. */
const COBROS_VISIBLES = 20;
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-AR");
type Comprobante = Awaited<ReturnType<typeof getFamilyChargeReceipt>>["receipt"];
/** El comprobante abierto: uno por vez, para que la lista no crezca sin control. */
type ComprobanteAbierto =
  | { jobId: string; estado: "cargando" }
  | { jobId: string; estado: "listo"; datos: Comprobante }
  | { jobId: string; estado: "error"; texto: string };
/** Sólo un servicio terminado tiene comprobante; si no, se dice en qué quedó. */
const estadoCobro = (cobro: FamilyCharge) =>
  cobro.status === "completed" ? null : cobro.status === "cancelled" ? "Cancelado" : "En curso";
const devueltoTexto = (cobro: FamilyCharge) =>
  cobro.refunded >= cobro.amount ? "Devuelto" : `Devuelto ${money.format(cobro.refunded)}`;

/** El mismo mínimo que la web y el servidor. */
const TOPE_MINIMO = 1000;
/** Vacío es sin tope; si no, pesos enteros desde el mínimo. `undefined`: no es válido. */
const leerTope = (valor: string): number | null | undefined => {
  if (!valor.trim()) return null;
  const pesos = Number(valor);
  return Number.isInteger(pesos) && pesos >= TOPE_MINIMO ? pesos : undefined;
};

function Boton({
  texto,
  onPress,
  tipo = "primario",
  deshabilitado = false,
  icono,
  etiqueta,
}: {
  texto: string;
  onPress: () => void;
  tipo?: "primario" | "secundario" | "peligro";
  deshabilitado?: boolean;
  icono?: keyof typeof Ionicons.glyphMap;
  /** Para el lector de pantalla, cuando el texto solo no dice a qué se refiere. */
  etiqueta?: string;
}) {
  const secundario = tipo === "secundario";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta ?? texto}
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

export function FamilyProfile({
  onChanged,
}: {
  /** Algo del perfil cambió: la cuenta (y su Wallet) se vuelve a leer. */
  onChanged?: () => void;
}) {
  const [familia, setFamilia] = useState<FamilyProfileState | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [tope, setTope] = useState("");
  const [editando, setEditando] = useState<{ id: string; tope: string } | null>(null);
  const [codigoMfa, setCodigoMfa] = useState("");
  // `null`: no se pudo saber. El campo se muestra, pero no se exige: el servidor
  // responde si hace falta (igual que en las tarjetas de regalo).
  const [conMfa, setConMfa] = useState<boolean | null>(false);
  const [comprobante, setComprobante] = useState<ComprobanteAbierto | null>(null);

  const cargar = useCallback(
    () =>
      getFamilyProfile()
        .then((respuesta) => {
          setFamilia(respuesta.family);
          setEstado("listo");
        })
        .catch(() => setEstado("error")),
    [],
  );
  // Invitar y cambiar un tope piden el código con la verificación en dos pasos
  // activa. El estado se lee al abrir y otra vez antes de mandar: se puede activar
  // en esta misma pantalla, y sin el campo la acción fallaría sin forma de mandarlo.
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

  const hacer = async (id: string, trabajo: () => Promise<string>) => {
    setOcupado(id);
    setAviso(null);
    try {
      setAviso({ texto: await trabajo(), error: false });
      onChanged?.();
      await cargar();
    } catch (error) {
      setAviso({ texto: mensaje(error), error: true });
      // Una acción cuya respuesta se perdió pudo haberse hecho: el estado lo muestra.
      void cargar();
    } finally {
      setOcupado(null);
    }
  };

  /** Manda el código si hace falta; un código usado en un intento fallido no sirve más. */
  const conCodigo = async <T,>(accion: (mfaCode?: string) => Promise<T>): Promise<T> => {
    // Sólo si no hay un código escrito: con uno, se manda y el servidor decide.
    if (!codigoMfa && conMfa !== true && (await releerMfa()) === true)
      throw new Error("Escribí el código de tu app autenticadora para continuar");
    const mandaCodigo = conMfa !== false && Boolean(codigoMfa);
    try {
      return await accion(mandaCodigo ? codigoMfa : undefined);
    } catch (fallo) {
      // Un 403 que pide el código, entre otros: se vuelve a leer el estado.
      void releerMfa();
      if (mandaCodigo)
        throw new Error(`${mensaje(fallo)}. Para reintentar, escribí un código nuevo.`);
      throw fallo;
    } finally {
      // Sirve una sola vez, salga bien o mal.
      if (mandaCodigo) setCodigoMfa("");
    }
  };

  const topeNuevo = leerTope(tope);
  const emailValido = /^\S+@\S+\.\S+$/.test(email.trim());
  const faltaCodigo = conMfa === true && !codigoMfa;

  const invitar = () =>
    void hacer("invitar", async () => {
      const destino = email.trim();
      await conCodigo((mfaCode) =>
        inviteFamilyMember({
          email: destino,
          monthlyLimit: topeNuevo ?? null,
          ...(mfaCode ? { mfaCode } : {}),
        }),
      );
      setEmail("");
      setTope("");
      return `Invitaste a ${destino}. Va a ver la invitación en su cuenta de Flash.`;
    });

  const guardarTope = (miembro: FamilyMember, valor: string) => {
    const nuevo = leerTope(valor);
    if (nuevo === undefined) return;
    void hacer(miembro.id, async () => {
      await conCodigo((mfaCode) =>
        setFamilyMemberLimit(miembro.id, {
          monthlyLimit: nuevo,
          ...(mfaCode ? { mfaCode } : {}),
        }),
      );
      setEditando(null);
      return `${miembro.name || miembro.email || "La persona"}: ${topeTexto(nuevo).toLowerCase()}`;
    });
  };

  const sacar = (miembro: FamilyMember) => {
    const nombre = miembro.name || miembro.email || "esta persona";
    Alert.alert(
      `¿Sacar a ${nombre}?`,
      "Deja de poder pagar con tu Flash Wallet. Lo que ya pagó no cambia.",
      [
        { text: "Volver", style: "cancel" },
        {
          text: "Sacar",
          style: "destructive",
          onPress: () =>
            void hacer(miembro.id, async () => {
              await removeFamilyMember(miembro.id);
              return `${nombre} ya no está en tu perfil familiar`;
            }),
        },
      ],
    );
  };

  const dejar = (organizador: string) =>
    Alert.alert(
      "¿Dejar el perfil familiar?",
      `${organizador} deja de pagar tus viajes, envíos y pedidos. Para volver tiene que invitarte de nuevo.`,
      [
        { text: "Volver", style: "cancel" },
        {
          text: "Dejar el perfil",
          style: "destructive",
          onPress: () =>
            void hacer("dejar", async () => {
              await leaveFamilyProfile();
              return "Dejaste el perfil familiar";
            }),
        },
      ],
    );

  // Tocar el mismo cobro lo cierra. Si se abre otro mientras uno carga, la respuesta
  // vieja se descarta: no puede pisar el comprobante que la persona pidió después.
  const verComprobante = (jobId: string) => {
    if (comprobante?.jobId === jobId && comprobante.estado !== "cargando") {
      setComprobante(null);
      return;
    }
    setComprobante({ jobId, estado: "cargando" });
    getFamilyChargeReceipt(jobId)
      .then((respuesta) =>
        setComprobante((actual) =>
          actual?.jobId === jobId ? { jobId, estado: "listo", datos: respuesta.receipt } : actual,
        ),
      )
      .catch((error: unknown) =>
        setComprobante((actual) =>
          actual?.jobId === jobId ? { jobId, estado: "error", texto: mensaje(error) } : actual,
        ),
      );
  };

  const campoMfa =
    conMfa !== false ? (
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
    ) : null;

  const membresia = familia?.membership ?? null;
  const organizador = familia?.organizer ?? null;
  const miembros = organizador?.members ?? [];
  // `?? []`: un servidor anterior a los cobros no manda el campo.
  const cobros = (organizador?.charges ?? []).slice(0, COBROS_VISIBLES);
  // Quien ya es miembro no puede organizar: el servidor responde 409.
  const puedeOrganizar = familia !== null && familia.role !== "member";

  return (
    <View style={estilos.caja} accessibilityLabel="Perfil familiar">
      <View style={estilos.cabecera}>
        <Ionicons name="people-outline" size={22} color={flashDesign.color.brand} />
        <View style={estilos.cabeceraTexto}>
          <Text style={estilos.titulo}>Perfil familiar</Text>
          <Text style={estilos.texto}>
            {membresia
              ? "Elegí «Perfil familiar» al pagar un viaje, un envío o un pedido."
              : `Pagá los viajes, envíos y pedidos de tu familia con tu Flash Wallet.${
                  organizador ? ` Hasta ${organizador.maxMembers} personas.` : ""
                }`}
          </Text>
        </View>
      </View>

      {estado === "cargando" && (
        <View style={estilos.fila}>
          <ActivityIndicator color={flashDesign.color.brand} />
          <Text style={estilos.texto}>Cargando tu perfil familiar…</Text>
        </View>
      )}
      {estado === "error" && (
        <View style={estilos.fila}>
          <Text style={estilos.error}>No pudimos leer tu perfil familiar.</Text>
          <Boton texto="Reintentar" tipo="secundario" onPress={() => void cargar()} />
        </View>
      )}

      {familia?.invitations.map((invitacion) => (
        <View key={invitacion.id} style={[estilos.tarjeta, estilos.recibida]}>
          <Text style={estilos.tarjetaTitulo}>
            {invitacion.organizerName} te invitó a su perfil familiar
          </Text>
          <Text style={estilos.texto}>
            Paga tus viajes, envíos y pedidos cuando elijas «Perfil familiar» ·{" "}
            {topeTexto(invitacion.monthlyLimit).toLowerCase()}
          </Text>
          <View style={estilos.fila}>
            <Boton
              texto="Aceptar"
              icono="checkmark"
              deshabilitado={ocupado === invitacion.id}
              onPress={() =>
                void hacer(invitacion.id, async () => {
                  await respondFamilyInvitation(invitacion.id, true);
                  return `Listo: ${invitacion.organizerName} paga lo que elijas con «Perfil familiar»`;
                })
              }
            />
            <Boton
              texto="Rechazar"
              tipo="secundario"
              deshabilitado={ocupado === invitacion.id}
              onPress={() =>
                void hacer(invitacion.id, async () => {
                  await respondFamilyInvitation(invitacion.id, false);
                  return "Rechazaste la invitación";
                })
              }
            />
          </View>
        </View>
      ))}

      {membresia ? (
        <View style={estilos.tarjeta}>
          <Text style={estilos.tarjetaTitulo}>Paga {membresia.organizerName}</Text>
          <Text style={estilos.texto}>
            {topeTexto(membresia.monthlyLimit)} · usaste {money.format(membresia.spentThisMonth)}{" "}
            este mes
          </Text>
          {membresia.remaining !== null ? (
            <Text style={estilos.etiqueta}>
              Te quedan {money.format(membresia.remaining)} este mes
            </Text>
          ) : null}
          <Boton
            texto="Dejar el perfil"
            tipo="peligro"
            deshabilitado={ocupado === "dejar"}
            onPress={() => dejar(membresia.organizerName)}
          />
        </View>
      ) : null}

      {puedeOrganizar ? (
        <>
          <Text style={estilos.subtitulo}>Invitar a alguien</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email de su cuenta de Flash"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            accessibilityLabel="Email de la persona que invitás"
            style={estilos.input}
          />
          <TextInput
            value={tope}
            onChangeText={(valor) => setTope(valor.replace(/\D/g, ""))}
            placeholder="Tope por mes en pesos (vacío: sin tope)"
            keyboardType="number-pad"
            accessibilityLabel="Tope por mes en pesos, opcional"
            style={estilos.input}
          />
          {topeNuevo === undefined ? (
            <Text style={estilos.texto}>El tope mínimo es {money.format(TOPE_MINIMO)}.</Text>
          ) : null}
          {editando ? null : campoMfa}
          <Boton
            texto="Invitar"
            icono="person-add-outline"
            deshabilitado={
              !emailValido || topeNuevo === undefined || faltaCodigo || ocupado === "invitar"
            }
            onPress={invitar}
          />
        </>
      ) : null}

      {aviso ? (
        <Text style={aviso.error ? estilos.error : estilos.aviso} accessibilityLiveRegion="polite">
          {aviso.texto}
        </Text>
      ) : null}

      {puedeOrganizar && miembros.length > 0 && (
        <Text style={estilos.subtitulo}>
          Tu familia · {organizador?.activeMembers ?? 0} de {organizador?.maxMembers ?? 0} activas
        </Text>
      )}
      {puedeOrganizar &&
        miembros.map((miembro) => {
          const enEdicion = editando?.id === miembro.id ? editando : null;
          return (
            <View key={miembro.id} style={estilos.tarjeta}>
              <View style={estilos.fila}>
                <Text style={[estilos.tarjetaTitulo, estilos.nombre]} numberOfLines={1}>
                  {miembro.name || miembro.email || "Invitación"}
                </Text>
                <Text
                  style={[
                    estilos.estado,
                    miembro.status === "active" ? estilos.estadoActivo : estilos.estadoInvitado,
                  ]}
                >
                  {estadoTexto[miembro.status]}
                </Text>
              </View>
              {miembro.name && miembro.email ? (
                <Text style={estilos.texto} numberOfLines={1}>
                  {miembro.email}
                </Text>
              ) : null}
              <Text style={estilos.texto}>
                {topeTexto(miembro.monthlyLimit)} · usó {money.format(miembro.spentThisMonth)} este
                mes
              </Text>
              {enEdicion ? (
                <>
                  <TextInput
                    value={enEdicion.tope}
                    onChangeText={(valor) =>
                      setEditando({ id: miembro.id, tope: valor.replace(/\D/g, "") })
                    }
                    placeholder="Tope por mes en pesos (vacío: sin tope)"
                    keyboardType="number-pad"
                    accessibilityLabel={`Nuevo tope por mes de ${miembro.name || miembro.email || "la persona"}`}
                    style={estilos.input}
                  />
                  {leerTope(enEdicion.tope) === undefined ? (
                    <Text style={estilos.texto}>
                      El tope mínimo es {money.format(TOPE_MINIMO)}.
                    </Text>
                  ) : null}
                  {campoMfa}
                  <View style={estilos.fila}>
                    <Boton
                      texto="Guardar"
                      deshabilitado={
                        leerTope(enEdicion.tope) === undefined ||
                        faltaCodigo ||
                        ocupado === miembro.id
                      }
                      onPress={() => guardarTope(miembro, enEdicion.tope)}
                    />
                    <Boton texto="Cancelar" tipo="secundario" onPress={() => setEditando(null)} />
                  </View>
                </>
              ) : (
                <View style={estilos.fila}>
                  <Boton
                    texto="Cambiar tope"
                    tipo="secundario"
                    deshabilitado={ocupado === miembro.id}
                    onPress={() =>
                      setEditando({
                        id: miembro.id,
                        tope: miembro.monthlyLimit === null ? "" : String(miembro.monthlyLimit),
                      })
                    }
                  />
                  <Boton
                    texto="Sacar"
                    tipo="peligro"
                    deshabilitado={ocupado === miembro.id}
                    onPress={() => sacar(miembro)}
                  />
                </View>
              )}
            </View>
          );
        })}
      {puedeOrganizar && estado === "listo" && miembros.length === 0 ? (
        <Text style={estilos.texto}>Todavía no invitaste a nadie.</Text>
      ) : null}

      {/* Lo que pagó la Wallet de quien organiza, con el comprobante de cada servicio
          terminado: sin esto no tenía cómo controlar qué se cobró ni a nombre de quién. */}
      {puedeOrganizar && organizador ? (
        <>
          <Text style={estilos.subtitulo}>Cobros del perfil</Text>
          {cobros.length === 0 ? (
            <Text style={estilos.texto}>Todavía no hay cobros con tu perfil.</Text>
          ) : null}
          {cobros.map((cobro) => {
            const servicio = servicioTexto[cobro.service] ?? "Servicio";
            const estadoServicio = estadoCobro(cobro);
            const abierto = comprobante?.jobId === cobro.jobId ? comprobante : null;
            const visible = abierto !== null && abierto.estado !== "cargando";
            return (
              <View key={cobro.jobId} style={estilos.tarjeta}>
                <View style={estilos.filaCobro}>
                  <Text style={[estilos.tarjetaTitulo, estilos.nombre]} numberOfLines={2}>
                    {cobro.memberName} · {servicio}
                  </Text>
                  <Text style={estilos.tarjetaTitulo}>{money.format(cobro.amount)}</Text>
                </View>
                <Text style={estilos.texto}>
                  {fecha(cobro.createdAt)}
                  {cobro.refunded > 0 ? ` · ${devueltoTexto(cobro)}` : ""}
                </Text>
                {estadoServicio ? (
                  <Text style={estilos.etiqueta}>{estadoServicio}</Text>
                ) : (
                  <Boton
                    texto={visible ? "Ocultar comprobante" : "Ver comprobante"}
                    tipo="secundario"
                    icono="receipt-outline"
                    etiqueta={`${visible ? "Ocultar" : "Ver"} el comprobante: ${servicio.toLowerCase()} de ${cobro.memberName}`}
                    deshabilitado={abierto?.estado === "cargando"}
                    onPress={() => verComprobante(cobro.jobId)}
                  />
                )}
                {abierto?.estado === "cargando" ? (
                  <View style={estilos.fila}>
                    <ActivityIndicator color={flashDesign.color.brand} />
                    <Text style={estilos.texto}>Cargando el comprobante…</Text>
                  </View>
                ) : null}
                {abierto?.estado === "error" ? (
                  <Text style={estilos.error} accessibilityLiveRegion="polite">
                    {abierto.texto}
                  </Text>
                ) : null}
                {abierto?.estado === "listo" ? (
                  <View style={estilos.comprobante} accessibilityLiveRegion="polite">
                    <Text style={estilos.etiqueta}>Comprobante {abierto.datos.number}</Text>
                    <Text style={estilos.texto}>
                      Total {money.format(abierto.datos.total)} · emitido el{" "}
                      {fecha(abierto.datos.issuedAt)}
                    </Text>
                    <Text style={estilos.aviso}>Pagado con tu perfil familiar</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
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
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: flashDesign.space.xs },
  // El importe queda a la derecha y el nombre se achica: uno largo no lo empuja afuera.
  filaCobro: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: flashDesign.space.xs,
  },
  comprobante: {
    gap: 2,
    padding: flashDesign.space.sm,
    borderRadius: flashDesign.radius.control,
    backgroundColor: flashDesign.color.surface,
    borderWidth: 1,
    borderColor: flashDesign.color.line,
  },
  input: {
    minHeight: flashDesign.control.touch,
    paddingHorizontal: flashDesign.space.sm,
    color: flashDesign.color.ink,
    fontSize: flashDesign.type.body,
    backgroundColor: flashDesign.color.canvas,
    borderRadius: flashDesign.radius.control,
  },
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
  // Un email largo se corta en vez de empujar la etiqueta de estado fuera de la tarjeta.
  nombre: { flexShrink: 1 },
  estado: {
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: flashDesign.radius.pill,
    fontSize: 12,
    fontWeight: "800",
  },
  estadoActivo: { color: "#0f6b3a", backgroundColor: "#ddf5e7" },
  estadoInvitado: { color: flashDesign.color.inkSoft, backgroundColor: flashDesign.color.surface },
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
