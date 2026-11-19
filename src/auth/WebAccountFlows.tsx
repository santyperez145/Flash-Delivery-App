// Alta de cuenta, verificación del email y recuperación de la contraseña en la web.
//
// La app ya tenía los tres flujos; la web sólo dejaba ingresar, así que una persona que
// llegaba por el navegador no podía crear su cuenta ni recuperarla. Los endpoints son los
// mismos que usa la app: no hay reglas nuevas en el servidor.
import { ArrowRight, Eye, EyeOff, KeyRound, MailCheck, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { api } from "../api";

export type Modo = "ingresar" | "crear" | "verificar" | "recuperar";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO = /^\+[1-9][0-9]{7,14}$/;
const mensaje = (error: unknown, porDefecto: string) =>
  error instanceof Error && error.message ? error.message : porDefecto;

/** El código de desarrollo sólo llega fuera de producción: así se prueba sin un proveedor de email. */
function CodigoDeDesarrollo({ codigo }: { codigo?: string }) {
  if (!codigo) return null;
  return (
    <p className="web-auth-dev-code" role="note">
      Entorno de desarrollo, sin envío de emails. Código: <strong>{codigo}</strong>
    </p>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label>
      <span>{etiqueta}</span>
      {children}
    </label>
  );
}

function Clave({
  etiqueta,
  valor,
  onCambio,
  autoComplete,
  placeholder,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  autoComplete: string;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Campo etiqueta={etiqueta}>
      <div className="web-auth-password">
        <input
          type={visible ? "text" : "password"}
          aria-label={etiqueta}
          autoComplete={autoComplete}
          value={valor}
          onChange={(event) => onCambio(event.target.value)}
          placeholder={placeholder}
          minLength={8}
          maxLength={128}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((actual) => !actual)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
    </Campo>
  );
}

function Enviar({
  ocupado,
  texto,
  ocupadoTexto,
}: {
  ocupado: boolean;
  texto: string;
  ocupadoTexto: string;
}) {
  return (
    <button className="web-auth-submit" type="submit" disabled={ocupado}>
      <span>{ocupado ? ocupadoTexto : texto}</span>
      {!ocupado && <ArrowRight size={19} />}
    </button>
  );
}

function Falla({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <div className="web-auth-error" role="alert">
      {texto}
    </div>
  );
}

/** Crear una cuenta de cliente. Después se verifica el email con un código. */
export function CrearCuenta({
  onCreada,
  onIngresar,
}: {
  onCreada: (datos: { email: string; password: string; codigo?: string }) => void;
  onIngresar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const enviar = async () => {
    const correo = email.trim().toLowerCase();
    const fono = telefono.replace(/[\s-]/g, "");
    if (nombre.trim().length < 2) return setError("Escribí tu nombre y apellido.");
    if (!EMAIL.test(correo)) return setError("Ingresá un email válido.");
    if (fono && !TELEFONO.test(fono))
      return setError("Escribí el teléfono con código de país, por ejemplo +5491112345678.");
    if (password.length < 8) return setError("La contraseña necesita al menos 8 caracteres.");
    if (password !== repetida) return setError("Las contraseñas no coinciden.");
    setOcupado(true);
    setError("");
    try {
      const alta = await api.register({
        name: nombre.trim(),
        email: correo,
        password,
        ...(fono ? { phone: fono } : {}),
      });
      onCreada({ email: correo, password, codigo: alta.developmentCode });
    } catch (fallo) {
      setError(mensaje(fallo, "No se pudo crear la cuenta"));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form
      className="web-auth-card"
      onSubmit={(event) => {
        event.preventDefault();
        void enviar();
      }}
    >
      <header>
        <span>
          <UserPlus size={14} aria-hidden="true" /> Cuenta nueva
        </span>
        <h2>Creá tu cuenta Flash</h2>
        <p>Pedidos, viajes y envíos con una sola cuenta.</p>
      </header>
      <div className="web-auth-fields">
        <Campo etiqueta="Nombre y apellido">
          <input
            aria-label="Nombre y apellido"
            autoComplete="name"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
            placeholder="Tu nombre"
            required
            autoFocus
          />
        </Campo>
        <Campo etiqueta="Email">
          <input
            type="email"
            aria-label="Email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nombre@ejemplo.com"
            required
          />
        </Campo>
        <Campo etiqueta="Teléfono (opcional)">
          <input
            type="tel"
            aria-label="Teléfono (opcional)"
            autoComplete="tel"
            value={telefono}
            onChange={(event) => setTelefono(event.target.value)}
            placeholder="+54 9 11 1234 5678"
          />
        </Campo>
        <Clave
          etiqueta="Contraseña"
          valor={password}
          onCambio={setPassword}
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
        />
        <Clave
          etiqueta="Repetí la contraseña"
          valor={repetida}
          onCambio={setRepetida}
          autoComplete="new-password"
          placeholder="Volvé a escribirla"
        />
      </div>
      <Falla texto={error} />
      <Enviar ocupado={ocupado} texto="Crear cuenta" ocupadoTexto="Creando tu cuenta…" />
      <p className="web-auth-switch">
        ¿Ya tenés cuenta?{" "}
        <button type="button" onClick={onIngresar}>
          Ingresá
        </button>
      </p>
    </form>
  );
}

/** El código de seis dígitos que llega al email, antes del primer ingreso. */
export function VerificarEmail({
  email,
  codigoInicial,
  onVerificada,
  onOtraCuenta,
}: {
  email: string;
  codigoInicial?: string;
  onVerificada: () => Promise<void>;
  onOtraCuenta: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [desarrollo, setDesarrollo] = useState(codigoInicial);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const enviar = async () => {
    if (!/^\d{6}$/.test(codigo.trim())) return setError("El código tiene 6 números.");
    setOcupado(true);
    setError("");
    try {
      await api.confirmEmailVerification(email, codigo.trim());
      await onVerificada();
    } catch (fallo) {
      setError(mensaje(fallo, "No se pudo verificar el email"));
    } finally {
      setOcupado(false);
    }
  };
  const reenviar = async () => {
    setError("");
    try {
      const respuesta = await api.resendEmailVerification(email);
      setDesarrollo(respuesta.developmentCode);
      setAviso(respuesta.message);
    } catch (fallo) {
      setError(mensaje(fallo, "No se pudo reenviar el código"));
    }
  };
  return (
    <form
      className="web-auth-card"
      onSubmit={(event) => {
        event.preventDefault();
        void enviar();
      }}
    >
      <header>
        <span>
          <MailCheck size={14} aria-hidden="true" /> Verificación
        </span>
        <h2>Confirmá que sos vos</h2>
        <p>Ingresá el código de seis números que enviamos a {email}.</p>
      </header>
      <label className="web-auth-mfa">
        <span>Código de verificación</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={codigo}
          onChange={(event) => setCodigo(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          required
          autoFocus
        />
      </label>
      <CodigoDeDesarrollo codigo={desarrollo} />
      {aviso && (
        <p className="web-auth-notice" role="status">
          {aviso}
        </p>
      )}
      <Falla texto={error} />
      <Enviar ocupado={ocupado} texto="Verificar e ingresar" ocupadoTexto="Verificando…" />
      <p className="web-auth-switch">
        <button type="button" onClick={() => void reenviar()}>
          Reenviar código
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={onOtraCuenta}>
          Usar otra cuenta
        </button>
      </p>
    </form>
  );
}

/** Recuperar la contraseña: se pide por email y se cambia con el código que llega. */
export function RecuperarClave({
  emailInicial,
  onListo,
  onIngresar,
}: {
  emailInicial: string;
  onListo: (aviso: string, email: string) => void;
  onIngresar: () => void;
}) {
  const [paso, setPaso] = useState<"pedir" | "cambiar">("pedir");
  const [email, setEmail] = useState(emailInicial);
  const [codigo, setCodigo] = useState("");
  const [desarrollo, setDesarrollo] = useState<string>();
  const [password, setPassword] = useState("");
  const [repetida, setRepetida] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const pedir = async () => {
    const correo = email.trim().toLowerCase();
    if (!EMAIL.test(correo)) return setError("Ingresá un email válido.");
    setOcupado(true);
    setError("");
    try {
      const respuesta = await api.requestPasswordRecovery(correo);
      setDesarrollo(respuesta.developmentToken);
      setAviso(respuesta.message);
      setPaso("cambiar");
    } catch (fallo) {
      setError(mensaje(fallo, "No se pudo iniciar la recuperación"));
    } finally {
      setOcupado(false);
    }
  };
  const cambiar = async () => {
    if (!codigo.trim()) return setError("Pegá el código de recuperación del email.");
    if (password.length < 8) return setError("La contraseña necesita al menos 8 caracteres.");
    if (password !== repetida) return setError("Las contraseñas no coinciden.");
    setOcupado(true);
    setError("");
    try {
      await api.confirmPasswordRecovery(codigo.trim(), password);
      onListo(
        "Cambiaste tu contraseña y cerramos las sesiones anteriores. Ya podés ingresar.",
        email.trim().toLowerCase(),
      );
    } catch (fallo) {
      setError(mensaje(fallo, "No se pudo cambiar la contraseña"));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form
      className="web-auth-card"
      onSubmit={(event) => {
        event.preventDefault();
        void (paso === "pedir" ? pedir() : cambiar());
      }}
    >
      <header>
        <span>
          <KeyRound size={14} aria-hidden="true" /> Recuperación
        </span>
        <h2>{paso === "pedir" ? "Recuperá tu cuenta" : "Elegí una contraseña nueva"}</h2>
        <p>
          {paso === "pedir"
            ? "Te enviamos un código por email para cambiar la contraseña."
            : "Pegá el código que te enviamos y elegí la contraseña nueva."}
        </p>
      </header>
      {paso === "pedir" ? (
        <div className="web-auth-fields">
          <Campo etiqueta="Email">
            <input
              type="email"
              aria-label="Email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nombre@ejemplo.com"
              required
              autoFocus
            />
          </Campo>
        </div>
      ) : (
        <div className="web-auth-fields">
          {aviso && (
            <p className="web-auth-notice" role="status">
              {aviso}
            </p>
          )}
          <Campo etiqueta="Código de recuperación">
            <input
              aria-label="Código de recuperación"
              autoComplete="one-time-code"
              value={codigo}
              onChange={(event) => setCodigo(event.target.value)}
              placeholder="Pegalo desde el email"
              required
              autoFocus
            />
          </Campo>
          <CodigoDeDesarrollo codigo={desarrollo} />
          <Clave
            etiqueta="Contraseña nueva"
            valor={password}
            onCambio={setPassword}
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
          />
          <Clave
            etiqueta="Repetí la contraseña"
            valor={repetida}
            onCambio={setRepetida}
            autoComplete="new-password"
            placeholder="Volvé a escribirla"
          />
        </div>
      )}
      <Falla texto={error} />
      <Enviar
        ocupado={ocupado}
        texto={paso === "pedir" ? "Enviar código" : "Cambiar contraseña"}
        ocupadoTexto={paso === "pedir" ? "Enviando…" : "Cambiando…"}
      />
      <p className="web-auth-switch">
        <button type="button" onClick={onIngresar}>
          Volver a ingresar
        </button>
      </p>
    </form>
  );
}
