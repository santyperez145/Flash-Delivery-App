import { ArrowRight, Bike, Car, Flame, Package, ShoppingBag } from "lucide-react";

type PublicLandingProps = {
  onEnter: () => void;
};

const navLinks = [
  { href: "#comida", label: "Comida" },
  { href: "#viajes", label: "Viajes" },
  { href: "#envios", label: "Envíos" },
];

const services = [
  {
    id: "comida",
    tone: "food" as const,
    icon: ShoppingBag,
    label: "Comida",
    title: "Pedí lo que se te antoje.",
    detail: "Catálogo vivo, carrito y checkout con precio firmado por el servidor.",
  },
  {
    id: "viajes",
    tone: "ride" as const,
    icon: Car,
    label: "Viajes",
    title: "Llegá sin adivinar el precio.",
    detail: "Cotizá con origen geocodificado. Sin ruta ficticia ni tarifa inventada.",
  },
  {
    id: "envios",
    tone: "shipment" as const,
    icon: Package,
    label: "Envíos",
    title: "Mandá algo de un punto a otro.",
    detail: "Quote, protección y seguimiento reales una vez autenticado.",
  },
];

export function PublicLanding({ onEnter }: PublicLandingProps) {
  return (
    <main className="flash-landing">
      <header className="web-auth-nav">
        <a className="web-auth-brand" href="#inicio">
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
        <button type="button" className="web-auth-nav-cta" onClick={onEnter}>
          Ingresar
        </button>
      </header>

      <section className="flash-landing-hero" id="inicio" aria-label="Flash">
        <div className="flash-landing-hero-copy">
          <p className="flash-landing-kicker">Comida · Viajes · Envíos</p>
          <h1>Andá a cualquier lado con Flash.</h1>
          <p className="flash-landing-lead">
            La app para pedir, viajar y enviar en tu ciudad. El precio y los permisos los confirma
            el servidor —esta portada no cotiza en anónimo.
          </p>
          <div className="flash-landing-cta-row">
            <button type="button" className="flash-landing-cta-primary" onClick={onEnter}>
              <span>Ingresar a Flash</span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
            <a className="flash-landing-cta-secondary" href="#comida">
              Ver servicios
            </a>
          </div>
        </div>
        <div className="flash-landing-hero-visual" aria-hidden="true">
          <div className="flash-landing-orbit flash-landing-orbit-food">
            <ShoppingBag size={28} />
            <span>Comida</span>
          </div>
          <div className="flash-landing-orbit flash-landing-orbit-ride">
            <Car size={28} />
            <span>Viajes</span>
          </div>
          <div className="flash-landing-orbit flash-landing-orbit-ship">
            <Package size={28} />
            <span>Envíos</span>
          </div>
          <div className="flash-landing-orbit flash-landing-orbit-bike">
            <Bike size={28} />
            <span>En camino</span>
          </div>
        </div>
      </section>

      <section className="flash-landing-services" aria-label="Servicios">
        {services.map(({ id, tone, icon: Icon, label, title, detail }) => (
          <article
            key={id}
            id={id}
            className={`flash-landing-service flash-landing-service-${tone}`}
          >
            <div className="flash-landing-service-copy">
              <span className="flash-landing-service-label">
                <Icon size={18} aria-hidden="true" />
                {label}
              </span>
              <h2>{title}</h2>
              <p>{detail}</p>
              <button type="button" onClick={onEnter}>
                Empezar
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </section>

      <footer className="flash-landing-footer">
        <strong>Flash</strong>
        <span>Delivery · courier · movilidad con cuenta</span>
        <button type="button" onClick={onEnter}>
          Ingresar
        </button>
      </footer>
    </main>
  );
}
