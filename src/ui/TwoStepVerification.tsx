import { useCallback, useEffect, useState } from "react";
import { Copy, Download, KeyRound, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";

import { api } from "../api";
import { disableMfa, regenerateMfaRecoveryCodes } from "../mfa-api";
import type { MfaEnrollment, MfaStatus } from "../types";

// Verificación en dos pasos de la cuenta (SEG-08), como Uber y Mercado Pago. Con
// ella activa, ingresar en un dispositivo nuevo, eliminar la cuenta o autorizar un
// retiro piden, además de la contraseña, un código de una app autenticadora.
//
// Los códigos de recuperación se muestran una sola vez (al activar o al generar
// nuevos) y nunca se guardan en el navegador: sólo se pueden copiar o descargar.

const mensaje = (error: unknown, otro: string) => (error instanceof Error ? error.message : otro);
const fecha = (valor: string) =>
  new Date(valor).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

function CodigosDeRecuperacion({ codigos }: { codigos: string[] }) {
  const [aviso, setAviso] = useState("");
  const texto = `Flash · Códigos de recuperación\n\n${codigos.join("\n")}\n\nCada código sirve una sola vez. Guardalos fuera de este dispositivo.`;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setAviso("Copiados. Guardalos en un gestor de contraseñas.");
    } catch {
      setAviso("No se pudieron copiar: descargalos o anotalos.");
    }
  };
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = "flash-codigos-de-recuperacion.txt";
    enlace.click();
    URL.revokeObjectURL(url);
    setAviso("Descargados. Movelos a un lugar seguro.");
  };
  return (
    <div className="two-step-codes">
      <p>
        Si perdés el teléfono, cada uno de estos códigos te deja entrar una vez. Se muestran sólo
        ahora.
      </p>
      <ul aria-label="Códigos de recuperación">
        {codigos.map((codigo) => (
          <li key={codigo}>
            <code>{codigo}</code>
          </li>
        ))}
      </ul>
      <div className="two-step-actions">
        <button type="button" className="secondary" onClick={() => void copiar()}>
          <Copy size={15} aria-hidden="true" /> Copiar
        </button>
        <button type="button" className="secondary" onClick={descargar}>
          <Download size={15} aria-hidden="true" /> Descargar
        </button>
      </div>
      {aviso && <small role="status">{aviso}</small>}
    </div>
  );
}

function CampoCodigo({
  valor,
  onChange,
  etiqueta,
  recuperacion = false,
}: {
  valor: string;
  onChange: (valor: string) => void;
  etiqueta: string;
  recuperacion?: boolean;
}) {
  return (
    <label className="two-step-code-field">
      <span>{etiqueta}</span>
      <input
        value={valor}
        onChange={(event) =>
          onChange(
            recuperacion
              ? event.target.value.toUpperCase().slice(0, 16)
              : event.target.value.replace(/\D/g, "").slice(0, 6),
          )
        }
        inputMode={recuperacion ? "text" : "numeric"}
        autoComplete="one-time-code"
        placeholder={recuperacion ? "000000 o ABCD-1234" : "000000"}
      />
    </label>
  );
}

export function TwoStepVerification() {
  const [estado, setEstado] = useState<MfaStatus | null>(null);
  const [falloCarga, setFalloCarga] = useState("");
  const [alta, setAlta] = useState<MfaEnrollment | null>(null);
  const [qr, setQr] = useState("");
  const [codigo, setCodigo] = useState("");
  const [accion, setAccion] = useState<"desactivar" | "regenerar" | null>(null);
  const [nuevos, setNuevos] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(() => {
    setFalloCarga("");
    api
      .getMfaStatus()
      .then((respuesta) => setEstado(respuesta.mfa))
      .catch((fallo) =>
        setFalloCarga(mensaje(fallo, "No pudimos ver tu verificación en dos pasos")),
      );
  }, []);
  useEffect(() => cargar(), [cargar]);

  useEffect(() => {
    let vigente = true;
    if (!alta) return setQr("");
    import("qrcode")
      .then((modulo) =>
        modulo.default.toDataURL(alta.otpauthUri, {
          width: 220,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      )
      .then((imagen) => vigente && setQr(imagen))
      .catch(() => vigente && setError("No se pudo dibujar el QR: usá la clave manual."));
    return () => {
      vigente = false;
    };
  }, [alta]);

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
      setAlta((await api.enrollMfa()).enrollment);
    }, "No se pudo empezar la activación");
  const confirmar = () =>
    correr(async () => {
      const respuesta = await api.confirmMfa(codigo);
      setEstado(respuesta.mfa);
      setAlta(null);
      setCodigo("");
      setAviso(
        respuesta.revokedSessions
          ? `Listo: la verificación quedó activa y cerramos ${respuesta.revokedSessions} sesión(es) en otros dispositivos.`
          : "Listo: la verificación en dos pasos quedó activa.",
      );
    }, "Código inválido");
  const terminarAccion = () =>
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
      <section className="two-step" aria-label="Verificación en dos pasos">
        <p role="alert">
          {falloCarga}{" "}
          <button type="button" className="secondary" onClick={cargar}>
            <RefreshCw size={14} aria-hidden="true" /> Reintentar
          </button>
        </p>
      </section>
    );
  if (!estado)
    return (
      <section className="two-step" aria-label="Verificación en dos pasos" aria-busy="true">
        <p>Consultando la seguridad de tu cuenta…</p>
      </section>
    );

  const bloqueado = estado.lockedUntil && new Date(estado.lockedUntil) > new Date();
  return (
    <section className="two-step" aria-labelledby="two-step-title">
      <header>
        {estado.enabled ? (
          <ShieldCheck size={20} aria-hidden="true" />
        ) : (
          <ShieldOff size={20} aria-hidden="true" />
        )}
        <div>
          <strong id="two-step-title">Verificación en dos pasos</strong>
          <span className={estado.enabled ? "two-step-on" : "two-step-off"}>
            {estado.enabled ? "Activa" : "Desactivada"}
          </span>
        </div>
      </header>

      {estado.enabled ? (
        <p>
          Activa desde el {estado.confirmedAt ? fecha(estado.confirmedAt) : "—"}. Te pedimos un
          código al ingresar en un dispositivo nuevo, eliminar tu cuenta o autorizar un retiro.{" "}
          {estado.recoveryCodesRemaining <= 2 ? (
            <strong className="two-step-warning">
              Te quedan {estado.recoveryCodesRemaining} códigos de recuperación: generá nuevos.
            </strong>
          ) : (
            `Te quedan ${estado.recoveryCodesRemaining} códigos de recuperación.`
          )}
        </p>
      ) : (
        !alta && (
          <p>
            Sumá un código de una app autenticadora (Google Authenticator, Microsoft Authenticator,
            1Password o Authy) a tu contraseña. Aunque alguien la sepa, no puede entrar ni mover tu
            plata sin tu teléfono.
          </p>
        )
      )}
      {bloqueado && (
        <p role="alert">
          Demasiados códigos inválidos: probá de nuevo después de las{" "}
          {new Date(estado.lockedUntil as string).toLocaleTimeString("es-AR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      )}

      {!estado.enabled && !alta && (
        <div className="two-step-actions">
          <button type="button" disabled={ocupado} onClick={() => void empezar()}>
            <KeyRound size={15} aria-hidden="true" /> {ocupado ? "Preparando…" : "Activar"}
          </button>
        </div>
      )}

      {alta && (
        <ol className="two-step-steps">
          <li>
            <strong>Escaneá el código con tu app autenticadora</strong>
            {qr ? (
              <img src={qr} alt="Código QR para la app autenticadora" width={180} height={180} />
            ) : (
              <span className="two-step-qr-placeholder">Generando QR…</span>
            )}
            <a href={alta.otpauthUri}>Abrir en la app autenticadora de este dispositivo</a>
            <details>
              <summary>¿No podés escanear? Ingresá la clave a mano</summary>
              <code>{alta.secret}</code>
            </details>
          </li>
          <li>
            <strong>Guardá tus códigos de recuperación</strong>
            <CodigosDeRecuperacion codigos={alta.recoveryCodes} />
          </li>
          <li>
            <strong>Ingresá el código de 6 dígitos que muestra la app</strong>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void confirmar();
              }}
            >
              <CampoCodigo valor={codigo} onChange={setCodigo} etiqueta="Código de la app" />
              <div className="two-step-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={ocupado}
                  onClick={() => {
                    setAlta(null);
                    setCodigo("");
                  }}
                >
                  Cancelar
                </button>
                <button type="submit" disabled={ocupado || codigo.length !== 6}>
                  {ocupado ? "Verificando…" : "Activar verificación"}
                </button>
              </div>
            </form>
          </li>
        </ol>
      )}

      {estado.enabled && !accion && (
        <div className="two-step-actions">
          <button type="button" className="secondary" onClick={() => setAccion("regenerar")}>
            <RefreshCw size={15} aria-hidden="true" /> Generar códigos nuevos
          </button>
          <button type="button" className="danger" onClick={() => setAccion("desactivar")}>
            <ShieldOff size={15} aria-hidden="true" /> Desactivar
          </button>
        </div>
      )}
      {estado.enabled && accion && (
        <form
          className="two-step-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            void terminarAccion();
          }}
        >
          <CampoCodigo
            valor={codigo}
            onChange={setCodigo}
            recuperacion
            etiqueta={
              accion === "desactivar"
                ? "Para desactivarla, ingresá un código de la app o uno de recuperación"
                : "Para generar códigos nuevos, ingresá un código de la app o uno de recuperación"
            }
          />
          <div className="two-step-actions">
            <button
              type="button"
              className="secondary"
              disabled={ocupado}
              onClick={() => {
                setAccion(null);
                setCodigo("");
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={accion === "desactivar" ? "danger" : undefined}
              disabled={ocupado || codigo.length < 6}
            >
              {ocupado ? "Verificando…" : accion === "desactivar" ? "Desactivar" : "Generar"}
            </button>
          </div>
        </form>
      )}
      {nuevos && <CodigosDeRecuperacion codigos={nuevos} />}

      {error && <p role="alert">{error}</p>}
      {aviso && <p role="status">{aviso}</p>}
    </section>
  );
}
