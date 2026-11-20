import {
  ArrowRight,
  Bike,
  FileCheck2,
  Eye,
  EyeOff,
  Flame,
  LockKeyhole,
  MapPin,
  ShieldCheck,
  Store,
  UserRound,
} from "lucide-react";
import { useState } from "react";

import { CrearCuenta, RecuperarClave, VerificarEmail, type Modo } from "./WebAccountFlows";

type WebLoginProps = {
  busy: boolean;
  error: string | null;
  mfaChallenge: string;
  /** Devuelve `verificationRequired` cuando la cuenta todavía no confirmó su email. */
  onLogin: (email: string, password: string) => Promise<{ verificationRequired: true } | void>;
  onMfa: (code: string) => Promise<void>;
  /** El token del enlace del email de recuperación, leído por `App` antes que la sesión. */
  tokenRecuperacion?: string;
  /** Terminó la recuperación abierta por el enlace; `cambiada` si se cambió la contraseña. */
  onRecuperacionTerminada?: (cambiada: boolean) => void;
  /** `comercio` cuando se llega desde «Sumá tu comercio» (/comercios) y `repartidor`
   *  desde «Repartí con Flash» (/repartir): el ingreso es el paso previo a la
   *  postulación y el texto lo dice. */
  contexto?: "comercio" | "repartidor";
  /** Abre la postulación de comercios sin recargar la página. */
  onComercios?: () => void;
  /** Abre la postulación para repartir sin recargar la página. */
  onRepartir?: () => void;
};

const audiences = [
  { icon: UserRound, label: "Clientes", detail: "Pedidos y seguimiento" },
  { icon: Store, label: "Comercios", detail: "Cocina, catálogo y ventas" },
  { icon: Bike, label: "Repartidores", detail: "Demanda, tareas y ganancias" },
  { icon: ShieldCheck, label: "Operaciones", detail: "Soporte y control" },
];

// Lo que sigue al ingreso cuando se viene a sumar un comercio: los mismos tres pasos del
// formulario, para que nadie cree la cuenta sin saber qué le van a pedir después.
const pasosComercio = [
  { icon: Store, label: "Rubro y datos", detail: "Nombre, razón social, CUIT y teléfono" },
  { icon: MapPin, label: "Dirección", detail: "La ubicación exacta del local" },
  { icon: ShieldCheck, label: "Revisión", detail: "Operaciones la aprueba antes de publicar" },
];

// Lo que sigue al ingreso cuando se viene a repartir (FE-06): los mismos pasos de la
// postulación, como en Uber, que dice qué documentos se piden antes de empezar.
const pasosRepartidor = [
  { icon: Bike, label: "Tu vehículo", detail: "Bici, moto o auto, y la ciudad" },
  { icon: FileCheck2, label: "Tus documentos", detail: "Según el vehículo, con foto o PDF" },
  { icon: ShieldCheck, label: "Revisión", detail: "Operaciones aprueba antes de conectarte" },
];

// El texto del ingreso según de dónde se llega. Sin contexto es el ingreso general.
const TEXTOS = {
  general: {
    eyebrow: "Una plataforma conectada",
    titulo: "Todo lo que se mueve, bajo control.",
    bajada:
      "Una sola cuenta para entrar a las herramientas que corresponden a tu rol, con datos y permisos reales.",
    nota: "Flash Delivery · Acceso por audiencia",
    saludo: "Bienvenido",
    accion: "Ingresá a Flash",
    ayuda: "Pedí, viajá y enviá, o entrá a tu panel de comercio u operaciones.",
  },
  comercio: {
    eyebrow: "Flash para comercios",
    titulo: "Sumá tu comercio a Flash.",
    bajada:
      "Ingresá o creá tu cuenta para empezar la solicitud. La revisamos antes de publicar tu comercio.",
    nota: "Flash para comercios",
    saludo: "Sumá tu comercio",
    accion: "Ingresá para seguir",
    ayuda: "Con tu cuenta de Flash, o creá una nueva. Después completás la solicitud.",
  },
  repartidor: {
    eyebrow: "Repartí con Flash",
    titulo: "Generá ingresos con tus horarios.",
    bajada:
      "Ingresá o creá tu cuenta para postularte. Revisamos tus documentos antes de que te conectes.",
    nota: "Flash para repartidores y conductores",
    saludo: "Repartí con Flash",
    accion: "Ingresá para postularte",
    ayuda:
      "Con tu cuenta de Flash, o creá una nueva. Después elegís tu vehículo y subís los documentos.",
  },
};

export function WebLogin({
  busy,
  error,
  mfaChallenge,
  onLogin,
  onMfa,
  tokenRecuperacion = "",
  onRecuperacionTerminada,
  contexto,
  onComercios,
  onRepartir,
}: WebLoginProps) {
  const paraSocio = Boolean(contexto);
  const textos = TEXTOS[contexto ?? "general"];
  const tarjetas =
    contexto === "comercio"
      ? pasosComercio
      : contexto === "repartidor"
        ? pasosRepartidor
        : audiences;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  // Con el enlace del email de recuperación se entra directo al paso de la contraseña nueva.
  const [modo, setModo] = useState<Modo>(tokenRecuperacion ? "recuperar" : "ingresar");
  const [codigoInicial, setCodigoInicial] = useState<string>();
  const [aviso, setAviso] = useState("");
  const isMfa = Boolean(mfaChallenge);
  const ingresarCon = async (correo: string, clave: string) => {
    setAviso("");
    const resultado = await onLogin(correo.trim().toLowerCase(), clave);
    if (resultado?.verificationRequired) {
      setCodigoInicial(undefined);
      setModo("verificar");
    }
  };
  const ingresar = () => ingresarCon(email, password);
  const volverAIngresar = (texto = "") => {
    setAviso(texto);
    setModo("ingresar");
  };

  return (
    <main className="web-auth-shell">
      <section className="web-auth-story" aria-label="Flash para cada operación">
        <div className="web-auth-brand">
          <span className="web-auth-mark" aria-hidden="true">
            <Flame size={25} strokeWidth={2.4} />
          </span>
          <strong>Flash</strong>
        </div>
        <div className="web-auth-story-copy">
          <span className="web-auth-eyebrow">{textos.eyebrow}</span>
          <h1>{textos.titulo}</h1>
          <p>{textos.bajada}</p>
        </div>
        <div className="web-auth-audiences">
          {tarjetas.map(({ icon: Icon, label, detail }) => (
            <article key={label}>
              <span aria-hidden="true">
                <Icon size={20} />
              </span>
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
            </article>
          ))}
        </div>
        <small className="web-auth-story-note">{textos.nota}</small>
      </section>

      <section className="web-auth-panel">
        {!isMfa && modo === "crear" && (
          <CrearCuenta
            onIngresar={() => volverAIngresar()}
            onCreada={(datos) => {
              setEmail(datos.email);
              setPassword(datos.password);
              setCodigoInicial(datos.codigo);
              if (datos.verificar) setModo("verificar");
              // Sin verificación pendiente, el alta ya dejó la sesión: se ingresa directo.
              else void ingresarCon(datos.email, datos.password);
            }}
          />
        )}
        {!isMfa && modo === "verificar" && (
          <VerificarEmail
            email={email.trim().toLowerCase()}
            codigoInicial={codigoInicial}
            onOtraCuenta={() => {
              setPassword("");
              volverAIngresar();
            }}
            onVerificada={async () => {
              // El código ya se consumió: se vuelve al ingreso antes de intentar entrar, así
              // un fallo del ingreso automático se ve ahí y se reintenta sin otro código.
              volverAIngresar("Email verificado. Ingresá con tu contraseña.");
              if (password) await ingresar();
            }}
          />
        )}
        {!isMfa && modo === "recuperar" && (
          <RecuperarClave
            emailInicial={email}
            tokenInicial={tokenRecuperacion}
            onIngresar={() => {
              onRecuperacionTerminada?.(false);
              volverAIngresar();
            }}
            onListo={(texto, correo) => {
              setEmail(correo);
              setPassword("");
              onRecuperacionTerminada?.(true);
              volverAIngresar(texto);
            }}
          />
        )}
        {(isMfa || modo === "ingresar") && (
          <form
            className="web-auth-card"
            onSubmit={(event) => {
              event.preventDefault();
              void (isMfa ? onMfa(mfaCode) : ingresar());
            }}
          >
            <div className="web-auth-mobile-brand" aria-hidden="true">
              <span className="web-auth-mark">
                <Flame size={22} strokeWidth={2.4} />
              </span>
              <strong>Flash</strong>
            </div>
            <div className="web-auth-secure">
              <LockKeyhole size={14} />
              Acceso protegido
            </div>
            <header>
              <span>{isMfa ? "Segundo paso" : textos.saludo}</span>
              <h2>{isMfa ? "Verificá tu identidad" : textos.accion}</h2>
              <p>
                {isMfa ? "Usá el código de tu autenticador o uno de recuperación." : textos.ayuda}
              </p>
            </header>

            {!isMfa && (
              <div className="web-auth-fields">
                <label>
                  <span>Email</span>
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
                </label>
                <label>
                  <span>Contraseña</span>
                  <div className="web-auth-password">
                    <input
                      type={passwordVisible ? "text" : "password"}
                      aria-label="Contraseña"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Ingresá tu contraseña"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setPasswordVisible((current) => !current)}
                      aria-label={passwordVisible ? "Ocultar contraseña" : "Mostrar contraseña"}
                      aria-pressed={passwordVisible}
                    >
                      {passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </label>
              </div>
            )}

            {isMfa && (
              <label className="web-auth-mfa">
                <span>Código de verificación</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value)}
                  placeholder="000 000"
                  minLength={6}
                  required
                  autoFocus
                />
              </label>
            )}

            {aviso && !isMfa && (
              <p className="web-auth-notice" role="status">
                {aviso}
              </p>
            )}
            {error && (
              <div className="web-auth-error" role="alert">
                {error}
              </div>
            )}
            <button className="web-auth-submit" type="submit" disabled={busy}>
              <span>{busy ? "Verificando…" : isMfa ? "Verificar acceso" : "Ingresar"}</span>
              {!busy && <ArrowRight size={19} />}
            </button>
            {!isMfa && (
              <p className="web-auth-switch">
                <button type="button" onClick={() => setModo("recuperar")}>
                  ¿Olvidaste tu contraseña?
                </button>
              </p>
            )}
            {!isMfa && (
              <p className="web-auth-switch web-auth-signup">
                ¿Primera vez en Flash?{" "}
                <button type="button" onClick={() => setModo("crear")}>
                  Creá tu cuenta
                </button>
              </p>
            )}
            {/* FE-05: la entrada a la postulación desde el ingreso. Es un enlace real a
                /comercios (funciona sin JavaScript de la app y se puede abrir en otra
                pestaña); con `onComercios` se navega sin recargar. */}
            {!isMfa && !paraSocio && (
              <a
                className="web-auth-partner"
                href="/comercios"
                onClick={(event) => {
                  if (!onComercios || event.metaKey || event.ctrlKey || event.shiftKey) return;
                  event.preventDefault();
                  onComercios();
                }}
              >
                <Store size={17} aria-hidden="true" /> ¿Tenés un comercio? Sumalo a Flash
              </a>
            )}
            {/* FE-06: lo mismo para repartir, como el «Repartí con Uber» del ingreso. */}
            {!isMfa && !paraSocio && (
              <a
                className="web-auth-partner"
                href="/repartir"
                onClick={(event) => {
                  if (!onRepartir || event.metaKey || event.ctrlKey || event.shiftKey) return;
                  event.preventDefault();
                  onRepartir();
                }}
              >
                <Bike size={17} aria-hidden="true" /> ¿Querés repartir? Postulate
              </a>
            )}
            {!isMfa && paraSocio && (
              <a className="web-auth-partner" href="/">
                Volver al inicio de Flash
              </a>
            )}
            <p className="web-auth-footnote">
              El acceso y los permisos se validan en el servidor para cada cuenta.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
