import {
  ArrowRight,
  Bike,
  Car,
  Eye,
  EyeOff,
  Flame,
  LockKeyhole,
  Package,
  ShieldCheck,
  ShoppingBag,
  Store,
  UserRound,
} from "lucide-react";
import { useState } from "react";

type WebLoginProps = {
  busy: boolean;
  error: string | null;
  mfaChallenge: string;
  onLogin: (email: string, password: string) => Promise<void>;
  onMfa: (code: string) => Promise<void>;
};

const navLinks = [
  { href: "#comida", label: "Comida" },
  { href: "#viajes", label: "Viajes" },
  { href: "#envios", label: "Envíos" },
  { href: "#servicios", label: "Para equipos" },
];

const services = [
  {
    id: "comida",
    icon: ShoppingBag,
    label: "Comida",
    detail: "Catálogo, carrito y checkout con precio firmado por el servidor.",
  },
  {
    id: "viajes",
    icon: Car,
    label: "Viajes",
    detail: "Cotizá con origen geocodificado. Sin ruta ficticia ni precio inventado.",
  },
  {
    id: "envios",
    icon: Package,
    label: "Envíos",
    detail: "Quote, protección y seguimiento reales una vez autenticado.",
  },
];

const audiences = [
  { icon: UserRound, label: "Clientes", detail: "Pedidos, viajes y envíos" },
  { icon: Store, label: "Comercios", detail: "Cocina, catálogo y ventas" },
  { icon: Bike, label: "Repartidores", detail: "Demanda, tareas y ganancias" },
  { icon: ShieldCheck, label: "Operaciones", detail: "Soporte y control" },
];

export function WebLogin({ busy, error, mfaChallenge, onLogin, onMfa }: WebLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isMfa = Boolean(mfaChallenge);

  return (
    <main className="web-auth-shell">
      <header className="web-auth-nav">
        <a className="web-auth-brand" href="#ingreso">
          <span className="web-auth-mark" aria-hidden="true">
            <Flame size={22} strokeWidth={2.4} />
          </span>
          <strong>Flash</strong>
        </a>
        <nav aria-label="Servicios Flash">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
        <a className="web-auth-nav-cta" href="#ingreso">
          Ingresar
        </a>
      </header>

      <section className="web-auth-hero">
        <div className="web-auth-story" aria-label="Flash para cada operación">
          <div className="web-auth-story-copy">
            <span className="web-auth-eyebrow">Comida, viajes y envíos</span>
            <h1>Andá a cualquier lado con Flash.</h1>
            <p>
              Pedí, viajá o enviá con la cuenta que te asignaron. El precio, la cobertura y los
              permisos los confirma el servidor; esta portada no cotiza en anónimo.
            </p>
          </div>
          <ul className="web-auth-service-pills">
            {services.map((service) => (
              <li key={service.id}>
                <a href={`#${service.id}`}>{service.label}</a>
              </li>
            ))}
          </ul>
        </div>

        <section className="web-auth-panel" id="ingreso">
          <form
            className="web-auth-card"
            onSubmit={(event) => {
              event.preventDefault();
              void (isMfa ? onMfa(mfaCode) : onLogin(email, password));
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
              <h2>{isMfa ? "Verificá tu identidad" : "Ingresá a tu espacio"}</h2>
              <p>
                {isMfa
                  ? "Usá el código de tu autenticador o uno de recuperación."
                  : "Accedé con la cuenta asignada a tu operación Flash."}
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
              <span>{busy ? "Verificando…" : isMfa ? "Verificar acceso" : "Ingresar"}</span>
              {!busy && <ArrowRight size={19} />}
            </button>
            <p className="web-auth-footnote">
              El acceso y los permisos se validan en el servidor para cada cuenta.
            </p>
          </form>
        </section>
      </section>

      <section className="web-auth-explore" id="servicios" aria-label="Qué podés hacer con Flash">
        <h2>Explorá lo que podés hacer con Flash</h2>
        <p>
          Cada servicio se abre con la cuenta autenticada. No hay ciudades, comercios ni tarifas de
          demostración en esta portada.
        </p>
        <div className="web-auth-explore-grid">
          {services.map(({ id, icon: Icon, label, detail }) => (
            <article key={id} id={id}>
              <span aria-hidden="true">
                <Icon size={22} />
              </span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </article>
          ))}
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
    </main>
  );
}
