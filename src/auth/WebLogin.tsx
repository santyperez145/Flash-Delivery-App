import { ArrowLeft, ArrowRight, Eye, EyeOff, Flame, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { PublicLanding } from "./PublicLanding";

type WebLoginProps = {
  busy: boolean;
  error: string | null;
  mfaChallenge: string;
  onLogin: (email: string, password: string) => Promise<void>;
  onMfa: (code: string) => Promise<void>;
};

export function WebLogin({ busy, error, mfaChallenge, onLogin, onMfa }: WebLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isMfa = Boolean(mfaChallenge);
  const [surface, setSurface] = useState<"landing" | "login">(isMfa ? "login" : "landing");

  if (surface === "landing" && !isMfa) {
    return <PublicLanding onEnter={() => setSurface("login")} />;
  }

  return (
    <main className="web-auth-shell web-auth-shell-login">
      <header className="web-auth-nav">
        <button
          type="button"
          className="web-auth-brand"
          onClick={() => {
            if (!isMfa) setSurface("landing");
          }}
        >
          <span className="web-auth-mark" aria-hidden="true">
            <Flame size={22} strokeWidth={2.4} />
          </span>
          <strong>Flash</strong>
        </button>
        {!isMfa && (
          <button type="button" className="web-auth-back" onClick={() => setSurface("landing")}>
            <ArrowLeft size={18} aria-hidden="true" />
            Volver
          </button>
        )}
      </header>

      <section className="web-auth-panel" id="ingreso" aria-label="Ingreso">
        <form
          className="web-auth-card"
          onSubmit={(event) => {
            event.preventDefault();
            void (isMfa ? onMfa(mfaCode) : onLogin(email, password));
          }}
        >
          <div className="web-auth-secure">
            <LockKeyhole size={14} />
            Acceso protegido
          </div>
          <header>
            <span>{isMfa ? "Segundo paso" : "Tu cuenta"}</span>
            <h2>{isMfa ? "Verificá tu identidad" : "Ingresá a Flash"}</h2>
            <p>
              {isMfa
                ? "Usá el código de tu autenticador o uno de recuperación."
                : "Email y contraseña de la cuenta asignada a tu operación."}
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
                  placeholder="nombre@empresa.com"
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
                    minLength={6}
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

          {error && (
            <div className="web-auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="web-auth-submit" type="submit" disabled={busy}>
            <span>{busy ? "Verificando…" : isMfa ? "Verificar acceso" : "Entrar"}</span>
            {!busy && <ArrowRight size={19} />}
          </button>
          <p className="web-auth-footnote">
            El acceso y los permisos se validan en el servidor para cada cuenta.
          </p>
        </form>
      </section>
    </main>
  );
}
