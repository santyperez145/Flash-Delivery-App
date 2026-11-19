import {
  ArrowRight,
  Bike,
  Eye,
  EyeOff,
  Flame,
  LockKeyhole,
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
};

const audiences = [
  { icon: UserRound, label: "Clientes", detail: "Pedidos y seguimiento" },
  { icon: Store, label: "Comercios", detail: "Cocina, catálogo y ventas" },
  { icon: Bike, label: "Repartidores", detail: "Demanda, tareas y ganancias" },
  { icon: ShieldCheck, label: "Operaciones", detail: "Soporte y control" },
];

export function WebLogin({
  busy,
  error,
  mfaChallenge,
  onLogin,
  onMfa,
  tokenRecuperacion = "",
  onRecuperacionTerminada,
}: WebLoginProps) {
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
          <span className="web-auth-eyebrow">Una plataforma conectada</span>
          <h1>Todo lo que se mueve, bajo control.</h1>
          <p>
            Una sola cuenta para entrar a las herramientas que corresponden a tu rol, con datos y
            permisos reales.
          </p>
        </div>
        <div className="web-auth-audiences">
          {audiences.map(({ icon: Icon, label, detail }) => (
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
        <small className="web-auth-story-note">Flash Delivery · Acceso por audiencia</small>
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
              <span>{isMfa ? "Segundo paso" : "Bienvenido"}</span>
              <h2>{isMfa ? "Verificá tu identidad" : "Ingresá a Flash"}</h2>
              <p>
                {isMfa
                  ? "Usá el código de tu autenticador o uno de recuperación."
                  : "Pedí, viajá y enviá, o entrá a tu panel de comercio u operaciones."}
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
            <p className="web-auth-footnote">
              El acceso y los permisos se validan en el servidor para cada cuenta.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
