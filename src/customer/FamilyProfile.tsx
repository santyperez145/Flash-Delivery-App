import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Users } from "lucide-react";

import { api } from "../api";
import {
  getFamilyProfile,
  inviteFamilyMember,
  leaveFamilyProfile,
  removeFamilyMember,
  respondFamilyInvitation,
  setFamilyMemberLimit,
} from "../family-profile-api";
import { money } from "../format";
import type { FamilyMember, FamilyProfile as PerfilFamiliar } from "../types";

// Perfil familiar (PAG-05), como el de Uber: la Flash Wallet de quien organiza paga
// los viajes, envíos y pedidos de las personas que suma, con un tope por mes
// opcional para cada una. Quien es miembro ve quién paga y cuánto le queda, nunca el
// saldo de quien organiza. Mismo comportamiento que la app móvil.

/** El mismo mínimo que valida el servidor: avisarlo antes evita un 400 seguro. */
const TOPE_MINIMO = 1000;
const estadoTexto: Record<FamilyMember["status"], string> = {
  invited: "Invitado",
  active: "Activo",
};
const topeTexto = (tope: number | null) =>
  tope === null ? "Sin tope" : `Tope ${money.format(tope)} por mes`;
/** Vacío es «sin tope» (`null`); lo que no sea un entero desde el mínimo, inválido. */
const leerTope = (texto: string): number | null | undefined => {
  const limpio = texto.trim();
  if (!limpio) return null;
  const valor = Number(limpio);
  return Number.isInteger(valor) && valor >= TOPE_MINIMO ? valor : undefined;
};
const mensajeDe = (error: unknown, porDefecto: string) =>
  error instanceof Error ? error.message : porDefecto;

export function FamilyProfile({
  onWalletChanged,
}: {
  /** Algo del perfil cambió: la cuenta se vuelve a leer y se muestra el aviso. */
  onWalletChanged?: (aviso: string) => void;
}) {
  const [perfil, setPerfil] = useState<PerfilFamiliar | null>(null);
  const [lectura, setLectura] = useState<"cargando" | "lista" | "error">("cargando");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [email, setEmail] = useState("");
  const [tope, setTope] = useState("");
  const [codigoMfa, setCodigoMfa] = useState("");
  // Edición en línea del tope de una persona: una a la vez, con su propio código.
  const [edicion, setEdicion] = useState<{ id: string; tope: string; codigo: string } | null>(null);
  // `null`: no se pudo saber. El campo se muestra, pero no se exige: el servidor
  // responde si hace falta. Igual que en las tarjetas de regalo.
  const [conMfa, setConMfa] = useState<boolean | null>(false);

  const cargar = useCallback(
    () =>
      getFamilyProfile()
        .then(({ family }) => {
          setPerfil(family);
          setLectura("lista");
        })
        .catch(() => setLectura("error")),
    [],
  );
  // Sumar a alguien o cambiar su tope es darle permiso para gastar de tu Wallet: con
  // la verificación en dos pasos activa, pide el código. El estado se lee al abrir y
  // otra vez antes de mandar, porque se puede activar sin salir de la pantalla.
  const releerMfa = useCallback(
    () =>
      api
        .getMfaStatus()
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
      const texto = await trabajo();
      setAviso({ texto, error: false });
      onWalletChanged?.(texto);
      await cargar();
    } catch (error) {
      setAviso({ texto: mensajeDe(error, "No se pudo completar"), error: true });
      // Una respuesta perdida no dice si se hizo: la lista vuelve a leerse.
      void cargar();
    } finally {
      setOcupado(null);
    }
  };

  /** Manda una operación que puede pedir el código de la app autenticadora. */
  const conCodigo = async <T,>(
    accion: string,
    codigo: string,
    olvidarCodigo: () => void,
    llamada: (mfaCode?: string) => Promise<T>,
  ) => {
    // Sólo si no hay un código escrito: con uno, se manda y el servidor decide.
    if (!codigo && conMfa !== true && (await releerMfa()) === true)
      throw new Error(`Escribí el código de tu app autenticadora para ${accion}`);
    const usaCodigo = conMfa !== false && Boolean(codigo);
    try {
      return await llamada(usaCodigo ? codigo : undefined);
    } catch (fallo) {
      // Un 403 que pide el código, entre otros: se vuelve a leer el estado.
      void releerMfa();
      // El código pudo haberse usado aunque la operación fallara: sirve una sola vez.
      if (usaCodigo) {
        olvidarCodigo();
        throw new Error(
          `${mensajeDe(fallo, "No se pudo completar")}. Para reintentar, escribí un código nuevo.`,
        );
      }
      throw fallo;
    }
  };

  const topeNuevo = leerTope(tope);
  const invitar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (topeNuevo === undefined || !email.trim()) return;
    void hacer("invitar", async () => {
      const { member } = await conCodigo(
        "invitar",
        codigoMfa,
        () => setCodigoMfa(""),
        (mfaCode) =>
          inviteFamilyMember({
            email: email.trim(),
            monthlyLimit: topeNuevo,
            ...(mfaCode ? { mfaCode } : {}),
          }),
      );
      setEmail("");
      setTope("");
      setCodigoMfa("");
      return `Invitamos a ${member.email || email.trim()} a tu perfil familiar`;
    });
  };

  const guardarTope = (event: FormEvent<HTMLFormElement>, miembro: FamilyMember) => {
    event.preventDefault();
    if (!edicion) return;
    const nuevo = leerTope(edicion.tope);
    if (nuevo === undefined) return;
    void hacer(miembro.id, async () => {
      await conCodigo(
        "cambiar el tope",
        edicion.codigo,
        () => setEdicion((actual) => (actual ? { ...actual, codigo: "" } : actual)),
        (mfaCode) =>
          setFamilyMemberLimit(miembro.id, {
            monthlyLimit: nuevo,
            ...(mfaCode ? { mfaCode } : {}),
          }),
      );
      setEdicion(null);
      return nuevo === null
        ? `${miembro.name || miembro.email || "La persona"} ya no tiene tope`
        : `Tope de ${money.format(nuevo)} por mes para ${miembro.name || miembro.email || "la persona"}`;
    });
  };

  const sacar = (miembro: FamilyMember) => {
    const quien = miembro.name || miembro.email || "esta persona";
    const pregunta =
      miembro.status === "invited"
        ? `¿Cancelar la invitación a ${quien}?`
        : `¿Sacar a ${quien} del perfil familiar? Deja de poder pagar con tu Flash Wallet.`;
    if (!window.confirm(pregunta)) return;
    void hacer(miembro.id, async () => {
      await removeFamilyMember(miembro.id);
      if (edicion?.id === miembro.id) setEdicion(null);
      return miembro.status === "invited"
        ? `Cancelaste la invitación a ${quien}`
        : `${quien} ya no está en tu perfil familiar`;
    });
  };

  const campoCodigo = (valor: string, cambiar: (valor: string) => void, id: string) =>
    conMfa !== false && (
      <label htmlFor={id}>
        {conMfa ? "Código de tu app autenticadora" : "Código de tu app autenticadora, si la usás"}
        <input
          id={id}
          value={valor}
          onChange={(event) => cambiar(event.target.value.replace(/\s/g, ""))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={32}
        />
      </label>
    );

  const membresia = perfil?.membership ?? null;
  const organizador = perfil?.organizer ?? null;
  const miembros = organizador?.members ?? [];
  const lleno = Boolean(organizador && miembros.length >= organizador.maxMembers);

  return (
    <section className="family-profile" aria-labelledby="family-profile-title">
      <header>
        <Users size={20} aria-hidden="true" />
        <div>
          <strong id="family-profile-title">Perfil familiar</strong>
          <p>
            {membresia
              ? `${membresia.organizerName} paga tus viajes, envíos y pedidos cuando elegís «Perfil familiar».`
              : `Pagá los viajes, envíos y pedidos de tu familia con tu Flash Wallet.${
                  organizador ? ` Hasta ${organizador.maxMembers} personas.` : ""
                }`}
          </p>
        </div>
      </header>

      {lectura === "cargando" && <p role="status">Cargando tu perfil familiar…</p>}
      {lectura === "error" && (
        <p role="alert">
          No pudimos leer tu perfil familiar.{" "}
          <button type="button" className="secondary" onClick={() => void cargar()}>
            Reintentar
          </button>
        </p>
      )}

      {perfil?.invitations.map((invitacion) => (
        <article key={invitacion.id} className="family-card family-card-invitation">
          <div>
            <strong>{invitacion.organizerName} te invitó a su perfil familiar</strong>
            <small>
              {invitacion.monthlyLimit === null
                ? "Sin tope por mes"
                : `Con un tope de ${money.format(invitacion.monthlyLimit)} por mes`}
            </small>
          </div>
          <div className="family-actions">
            <button
              type="button"
              disabled={ocupado === invitacion.id}
              onClick={() =>
                void hacer(invitacion.id, async () => {
                  await respondFamilyInvitation(invitacion.id, true);
                  return `Listo: ${invitacion.organizerName} paga lo que elijas con «Perfil familiar»`;
                })
              }
            >
              Aceptar
            </button>
            <button
              type="button"
              className="secondary"
              disabled={ocupado === invitacion.id}
              onClick={() =>
                void hacer(invitacion.id, async () => {
                  await respondFamilyInvitation(invitacion.id, false);
                  return "Rechazaste la invitación";
                })
              }
            >
              Rechazar
            </button>
          </div>
        </article>
      ))}

      {membresia && (
        <div className="family-membership">
          <dl>
            <div>
              <dt>Paga</dt>
              <dd>{membresia.organizerName}</dd>
            </div>
            <div>
              <dt>Tope por mes</dt>
              <dd>
                {membresia.monthlyLimit === null
                  ? "Sin tope"
                  : money.format(membresia.monthlyLimit)}
              </dd>
            </div>
            {membresia.remaining !== null && (
              <div>
                <dt>Te queda este mes</dt>
                <dd>{money.format(membresia.remaining)}</dd>
              </div>
            )}
            <div>
              <dt>Gastaste este mes</dt>
              <dd>{money.format(membresia.spentThisMonth)}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="danger"
            disabled={ocupado === "dejar"}
            onClick={() => {
              if (
                !window.confirm(
                  `¿Dejar el perfil familiar de ${membresia.organizerName}? Vas a pagar con tus propios medios.`,
                )
              )
                return;
              void hacer("dejar", async () => {
                await leaveFamilyProfile();
                return "Dejaste el perfil familiar";
              });
            }}
          >
            Dejar el perfil
          </button>
        </div>
      )}

      {/* Quien es miembro no puede organizar: el servidor responde 409. Ofrecer el
          formulario sería ofrecer un camino que termina en error. */}
      {perfil && perfil.role !== "member" && (
        <form className="family-invite" onSubmit={invitar}>
          <strong>Sumar a alguien</strong>
          <label>
            Email de su cuenta Flash
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              maxLength={254}
              required
            />
          </label>
          <label>
            Tope por mes en pesos (opcional)
            <input
              type="number"
              inputMode="numeric"
              min={TOPE_MINIMO}
              step={1}
              value={tope}
              onChange={(event) => setTope(event.target.value)}
              placeholder="Sin tope"
            />
          </label>
          {topeNuevo === undefined && (
            <small role="status">El tope mínimo es {money.format(TOPE_MINIMO)}.</small>
          )}
          {campoCodigo(codigoMfa, setCodigoMfa, "family-invite-code")}
          {lleno && (
            <small role="status">
              Llegaste al máximo de {organizador?.maxMembers} personas en tu perfil.
            </small>
          )}
          <button
            type="submit"
            disabled={
              !email.trim() ||
              topeNuevo === undefined ||
              lleno ||
              ocupado === "invitar" ||
              (conMfa === true && !codigoMfa)
            }
          >
            Invitar
          </button>
        </form>
      )}

      {aviso && <p role={aviso.error ? "alert" : "status"}>{aviso.texto}</p>}

      {perfil?.role !== "member" && miembros.length > 0 && (
        <div className="family-list">
          <strong>
            Tu familia · {organizador?.activeMembers ?? 0}{" "}
            {organizador?.activeMembers === 1 ? "persona activa" : "personas activas"}
          </strong>
          {miembros.map((miembro) => (
            <article key={miembro.id} className="family-card">
              <div>
                <strong>{miembro.name || miembro.email || "Invitación pendiente"}</strong>
                {miembro.name && miembro.email && <small>{miembro.email}</small>}
                <span className={`family-status family-status-${miembro.status}`}>
                  {estadoTexto[miembro.status]}
                </span>
                <small>
                  {miembro.status === "active"
                    ? `Gastó ${money.format(miembro.spentThisMonth)} este mes · `
                    : ""}
                  {topeTexto(miembro.monthlyLimit)}
                </small>
              </div>
              {edicion?.id === miembro.id ? (
                <form className="family-limit" onSubmit={(event) => guardarTope(event, miembro)}>
                  <label htmlFor={`family-limit-${miembro.id}`}>
                    Nuevo tope por mes en pesos (vacío es sin tope)
                  </label>
                  <input
                    id={`family-limit-${miembro.id}`}
                    type="number"
                    inputMode="numeric"
                    min={TOPE_MINIMO}
                    step={1}
                    value={edicion.tope}
                    onChange={(event) => setEdicion({ ...edicion, tope: event.target.value })}
                    placeholder="Sin tope"
                  />
                  {leerTope(edicion.tope) === undefined && (
                    <small role="status">El tope mínimo es {money.format(TOPE_MINIMO)}.</small>
                  )}
                  {campoCodigo(
                    edicion.codigo,
                    (codigo) => setEdicion({ ...edicion, codigo }),
                    `family-limit-code-${miembro.id}`,
                  )}
                  <div className="family-actions">
                    <button
                      type="submit"
                      disabled={
                        ocupado === miembro.id ||
                        leerTope(edicion.tope) === undefined ||
                        (conMfa === true && !edicion.codigo)
                      }
                    >
                      Guardar
                    </button>
                    <button type="button" className="secondary" onClick={() => setEdicion(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <div className="family-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={ocupado === miembro.id}
                    onClick={() =>
                      setEdicion({
                        id: miembro.id,
                        tope: miembro.monthlyLimit === null ? "" : String(miembro.monthlyLimit),
                        codigo: "",
                      })
                    }
                  >
                    Cambiar tope
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={ocupado === miembro.id}
                    onClick={() => sacar(miembro)}
                  >
                    Sacar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
