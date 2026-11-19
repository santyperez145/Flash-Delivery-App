import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Flame,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  Store,
  XCircle,
} from "lucide-react";
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { api } from "../api";
import { RUBROS } from "../customer/VerticalRail";
import type { MerchantApplication, MerchantVertical, User } from "../types";

// «Sumá tu comercio» (FE-05): el único camino de producto para que exista un comercio.
//
// Hasta esta ola el único INSERT INTO merchants estaba en un seed, y con la regla «todo
// real, nada falso» eso dejaba el catálogo vacío para siempre. Acá alguien con su cuenta
// de Flash presenta la solicitud; operaciones la revisa y, recién al aprobarla, el
// servidor crea el comercio (cerrado y sin horarios) y le da el rol `merchant`.
//
// Qué pide la competencia: el alta de Uber Eats
// (https://merchants.ubereats.com/us/es/s/signup) arranca con la dirección y el nombre
// del local, el tipo de negocio y un teléfono de contacto, y deja la documentación
// fiscal y bancaria para la revisión. Flash pide lo fiscal (razón social y CUIT) desde
// el primer paso porque en la Argentina sin CUIT válido no se puede facturar ni cobrar,
// y validarlo acá evita una solicitud que operaciones tendría que rechazar por un dígito.
// El cobro (Mercado Pago) y los horarios se cargan después, ya en el portal.

type Rubro = MerchantVertical;
const ORDEN_RUBROS: Rubro[] = ["restaurant", "grocery", "pharmacy", "kiosk", "retail"];
const rubroLabel = (vertical: string) => RUBROS[vertical as Rubro]?.label ?? vertical;

// El dígito verificador del CUIT: módulo 11 con los pesos 5-4-3-2-7-6-5-4-3-2 sobre los
// diez primeros dígitos. El servidor hace la misma cuenta; repetirla acá es para avisar
// mientras se escribe, no para reemplazar esa validación.
const PESOS_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
type EstadoCuit = { digitos: string; valido: boolean; mensaje: string };
function revisarCuit(valor: string): EstadoCuit {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  if (!digitos) return { digitos, valido: false, mensaje: "Son 11 dígitos, con o sin guiones." };
  if (digitos.length < 11) {
    const faltan = 11 - digitos.length;
    return {
      digitos,
      valido: false,
      mensaje: `Faltan ${faltan} ${faltan === 1 ? "dígito" : "dígitos"}.`,
    };
  }
  const suma = PESOS_CUIT.reduce(
    (total, peso, indice) => total + peso * Number(digitos[indice]),
    0,
  );
  const resto = 11 - (suma % 11);
  // 11 equivale a 0; 10 no es un verificador posible: ARCA nunca emite ese CUIT.
  const esperado = resto === 11 ? 0 : resto;
  if (resto === 10 || esperado !== Number(digitos[10]))
    return {
      digitos,
      valido: false,
      mensaje:
        "El dígito verificador no coincide. Revisalo en tu constancia de inscripción de ARCA (ex AFIP).",
    };
  return { digitos, valido: true, mensaje: "CUIT válido." };
}
const formatoCuit = (digitos: string) =>
  digitos.length === 11
    ? `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
    : digitos;

// El teléfono viaja en E.164 (+54…): se aceptan espacios, guiones y paréntesis al
// escribirlo y se sacan antes de validar. 10 dígitos después del 54 es un fijo o un
// celular sin el 9; 11, un celular con el 9.
const normalizarTelefono = (valor: string) => valor.replace(/[\s\-().]/g, "");
const telefonoValido = (valor: string) => /^\+54\d{10,11}$/.test(normalizarTelefono(valor));

const fecha = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const fechaDe = (iso: string | null) => (iso ? fecha.format(new Date(iso)) : "");

type Lugar = { label: string; lat: number; lng: number; provider: string };
type Borrador = {
  vertical: Rubro | null;
  businessName: string;
  legalName: string;
  taxId: string;
  contactPhone: string;
  address: string;
  lugar: Lugar | null;
  confirmada: boolean;
  notes: string;
};
const BORRADOR_VACIO: Borrador = {
  vertical: null,
  businessName: "",
  legalName: "",
  taxId: "",
  contactPhone: "",
  address: "",
  lugar: null,
  confirmada: false,
  notes: "",
};

type Paso = 1 | 2 | 3;
const PASOS: Record<Paso, string> = { 1: "Rubro y datos", 2: "Dirección", 3: "Revisión" };

function erroresPaso1(borrador: Borrador) {
  const errores: Partial<
    Record<"vertical" | "businessName" | "legalName" | "taxId" | "contactPhone", string>
  > = {};
  if (!borrador.vertical) errores.vertical = "Elegí el rubro de tu comercio.";
  const nombre = borrador.businessName.trim();
  if (nombre.length < 2 || nombre.length > 120)
    errores.businessName = "Escribí el nombre con el que te van a encontrar (2 a 120 caracteres).";
  const razon = borrador.legalName.trim();
  if (razon.length < 2 || razon.length > 160)
    errores.legalName = "Escribí la razón social como figura en ARCA (2 a 160 caracteres).";
  const cuit = revisarCuit(borrador.taxId);
  if (!cuit.valido)
    errores.taxId = cuit.digitos ? cuit.mensaje : "Escribí el CUIT: son 11 dígitos.";
  if (!telefonoValido(borrador.contactPhone))
    errores.contactPhone = "Escribilo con +54 y el código de área, por ejemplo +54 9 11 2345 6789.";
  return errores;
}

type Props = {
  user: User;
  /** Vuelve al resto de Flash sin cerrar la sesión. */
  onVolver: () => void;
  /** Abre el portal del comercio ya aprobado. */
  onAbrirPortal: () => void;
  onCerrarSesion: () => void;
};

export function MerchantApplicationPage({ user, onVolver, onAbrirPortal, onCerrarSesion }: Props) {
  const [carga, setCarga] = useState<
    | { estado: "cargando" }
    | { estado: "error"; mensaje: string }
    | { estado: "listo"; solicitudes: MerchantApplication[] }
  >({ estado: "cargando" });
  const [recienEnviada, setRecienEnviada] = useState(false);
  // Una solicitud rechazada no bloquea otra: quien la corrigió puede volver a presentarla.
  const [empezarOtra, setEmpezarOtra] = useState(false);

  const cargar = useCallback(async () => {
    setCarga({ estado: "cargando" });
    try {
      const respuesta = await api.getMyApplications();
      setCarga({ estado: "listo", solicitudes: respuesta.applications });
    } catch (error) {
      setCarga({
        estado: "error",
        mensaje: error instanceof Error ? error.message : "No pudimos cargar tu solicitud.",
      });
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  const ultima = carga.estado === "listo" ? (carga.solicitudes[0] ?? null) : null;
  const mostrarFormulario =
    carga.estado === "listo" &&
    (!ultima || (ultima.status === "rejected" && empezarOtra)) &&
    // Una cuenta que ya tiene un comercio no puede presentar otra solicitud: el servidor
    // la rechaza con 409, así que no se ofrece un formulario que termina en error.
    !(user.roles.includes("merchant") && !ultima);

  return (
    <main className="partner-shell">
      <header className="partner-top">
        <div className="partner-brand">
          <span className="web-auth-mark" aria-hidden="true">
            <Flame size={22} strokeWidth={2.4} />
          </span>
          <strong>Flash</strong>
          <span className="partner-brand-tag">para comercios</span>
        </div>
        <button type="button" className="partner-ghost" onClick={onVolver}>
          <ArrowLeft size={17} aria-hidden="true" /> Volver a Flash
        </button>
      </header>

      <div className="partner-layout">
        <aside className="partner-aside" aria-labelledby="partner-aside-title">
          <h1 id="partner-aside-title">Sumá tu comercio a Flash</h1>
          <p>
            Vendé en Flash con envíos y retiro en el local. Revisamos cada solicitud antes de
            publicar un comercio.
          </p>
          <h2>Qué vas a necesitar</h2>
          <ul>
            <li>La razón social y el CUIT como figuran en ARCA.</li>
            <li>La dirección del local.</li>
            <li>Un teléfono para que operaciones te contacte.</li>
          </ul>
          <h2>Cómo sigue</h2>
          <ol>
            <li>Revisamos la solicitud y te avisamos en Flash.</li>
            <li>Si la aprobamos, creamos tu comercio cerrado y sin horarios.</li>
            <li>Cargás el menú y el horario desde el portal, y abrís cuando estés listo.</li>
          </ol>
          <p className="partner-account">
            <span>
              Postulás con <strong>{user.email}</strong>.
            </span>
            <button type="button" className="partner-link" onClick={onCerrarSesion}>
              <LogOut size={14} aria-hidden="true" /> Cambiar de cuenta
            </button>
          </p>
        </aside>

        <section className="partner-main" aria-live="polite">
          {carga.estado === "cargando" && (
            <div className="partner-card partner-state" role="status">
              <RefreshCw className="spin" size={22} aria-hidden="true" />
              <p>Buscando tu solicitud…</p>
            </div>
          )}
          {carga.estado === "error" && (
            <div className="partner-card partner-state" role="alert">
              <CircleAlert size={22} aria-hidden="true" />
              <p>{carga.mensaje}</p>
              <button type="button" className="partner-primary" onClick={() => void cargar()}>
                <RefreshCw size={17} aria-hidden="true" /> Reintentar
              </button>
            </div>
          )}
          {carga.estado === "listo" && mostrarFormulario && (
            <Formulario
              onEnviada={(solicitud) => {
                setCarga({ estado: "listo", solicitudes: [solicitud, ...carga.solicitudes] });
                setRecienEnviada(true);
                setEmpezarOtra(false);
              }}
              onConflicto={async () => {
                // Se relee sin pasar por «cargando»: si apareció una solicitud abierta, se
                // muestra su estado; si no (por ejemplo, la cuenta ya tiene comercio), el
                // formulario queda con el mensaje del servidor a la vista.
                const respuesta = await api.getMyApplications().catch(() => null);
                const abierta = respuesta?.applications.find(
                  (solicitud) =>
                    solicitud.status === "pending" || solicitud.status === "needs_changes",
                );
                if (respuesta && abierta) {
                  setEmpezarOtra(false);
                  setCarga({ estado: "listo", solicitudes: respuesta.applications });
                }
              }}
            />
          )}
          {carga.estado === "listo" && !mostrarFormulario && !ultima && (
            <div className="partner-card partner-status partner-status-approved">
              <span className="partner-status-icon" aria-hidden="true">
                <Store size={24} />
              </span>
              <h2>Esta cuenta ya administra un comercio</h2>
              <p>Entrá al portal para cargar el menú, el horario y abrir el local.</p>
              <button type="button" className="partner-primary" onClick={onAbrirPortal}>
                Abrir el portal de comercio <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          )}
          {carga.estado === "listo" && !mostrarFormulario && ultima && (
            <EstadoSolicitud
              solicitud={ultima}
              recienEnviada={recienEnviada}
              onNueva={() => {
                setRecienEnviada(false);
                setEmpezarOtra(true);
              }}
              onAbrirPortal={onAbrirPortal}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function Formulario({
  onEnviada,
  onConflicto,
}: {
  onEnviada: (solicitud: MerchantApplication) => void;
  onConflicto: () => Promise<void>;
}) {
  const [paso, setPaso] = useState<Paso>(1);
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  // Los errores se muestran recién después del primer intento de seguir: marcar en rojo un
  // campo que la persona todavía no llegó a escribir es ruido, no ayuda.
  const [intentoPaso1, setIntentoPaso1] = useState(false);
  const [intentoPaso2, setIntentoPaso2] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState("");
  const titulo = useRef<HTMLHeadingElement>(null);
  const pasoMostrado = useRef<Paso>(1);
  const id = useId();

  // Al cambiar de paso el foco va al título: con lector de pantalla se oye dónde se está,
  // y con teclado no queda en un botón que ya desapareció.
  useEffect(() => {
    if (pasoMostrado.current === paso) return;
    pasoMostrado.current = paso;
    titulo.current?.focus();
  }, [paso]);

  const cambiar = <K extends keyof Borrador>(campo: K, valor: Borrador[K]) =>
    setBorrador((actual) => ({ ...actual, [campo]: valor }));

  const errores1 = erroresPaso1(borrador);
  const cuit = revisarCuit(borrador.taxId);
  const listoPaso2 = Boolean(borrador.lugar && borrador.confirmada);
  const notasLargas = borrador.notes.trim().length > 500;

  const enfocar = (campo: string) => document.getElementById(`${id}-${campo}`)?.focus();

  const seguir = (event: FormEvent) => {
    event.preventDefault();
    if (paso === 1) {
      setIntentoPaso1(true);
      const primero = Object.keys(errores1)[0];
      if (primero) return enfocar(primero);
      return setPaso(2);
    }
    if (paso === 2) {
      setIntentoPaso2(true);
      if (!listoPaso2) return enfocar(borrador.lugar ? "confirmada" : "address");
      return setPaso(3);
    }
    void enviar();
  };

  const enviar = async () => {
    if (!borrador.vertical || !borrador.lugar || notasLargas) return;
    setEnviando(true);
    setErrorEnvio("");
    try {
      const notas = borrador.notes.trim();
      const respuesta = await api.submitMerchantApplication({
        businessName: borrador.businessName.trim(),
        legalName: borrador.legalName.trim(),
        taxId: cuit.digitos,
        vertical: borrador.vertical,
        contactPhone: normalizarTelefono(borrador.contactPhone),
        address: borrador.lugar.label,
        lat: borrador.lugar.lat,
        lng: borrador.lugar.lng,
        ...(notas ? { notes: notas } : {}),
      });
      onEnviada(respuesta.application);
    } catch (error) {
      const status = (error as { status?: number }).status;
      setErrorEnvio(error instanceof Error ? error.message : "No pudimos enviar la solicitud.");
      // 409: ya hay una solicitud en curso o la cuenta ya tiene comercio. Se relee para
      // mostrar ese estado real en vez de dejar el formulario con un error sin salida.
      if (status === 409) await onConflicto();
    } finally {
      setEnviando(false);
    }
  };

  const ayuda = (campo: string) => `${id}-${campo}-ayuda`;

  return (
    <form className="partner-card partner-form" onSubmit={seguir} noValidate>
      <div className="partner-progress">
        <div
          className="partner-progress-track"
          role="progressbar"
          aria-label="Avance de la solicitud"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={paso}
          aria-valuetext={`Paso ${paso} de 3: ${PASOS[paso]}`}
        >
          <span style={{ width: `${(paso / 3) * 100}%` }} />
        </div>
        <ol className="partner-steps">
          {([1, 2, 3] as Paso[]).map((numero) => (
            <li
              key={numero}
              className={numero === paso ? "active" : numero < paso ? "done" : undefined}
              aria-current={numero === paso ? "step" : undefined}
            >
              <span aria-hidden="true">{numero < paso ? <Check size={13} /> : numero}</span>
              {PASOS[numero]}
            </li>
          ))}
        </ol>
      </div>

      <header className="partner-form-header">
        <small>Paso {paso} de 3</small>
        <h2 ref={titulo} tabIndex={-1}>
          {paso === 1
            ? "Contanos de tu comercio"
            : paso === 2
              ? "¿Dónde está el local?"
              : "Revisá y enviá"}
        </h2>
      </header>

      {paso === 1 && (
        <>
          <fieldset
            className="partner-rubros"
            aria-describedby={intentoPaso1 && errores1.vertical ? ayuda("vertical") : undefined}
          >
            <legend>Rubro</legend>
            <div className="partner-rubro-grid">
              {ORDEN_RUBROS.map((rubro, indice) => {
                const { label, Icon } = RUBROS[rubro];
                return (
                  <label key={rubro} className="partner-rubro">
                    <input
                      type="radio"
                      name={`${id}-rubro`}
                      id={indice === 0 ? `${id}-vertical` : undefined}
                      value={rubro}
                      checked={borrador.vertical === rubro}
                      onChange={() => cambiar("vertical", rubro)}
                    />
                    <span className="partner-rubro-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <strong>{label}</strong>
                  </label>
                );
              })}
            </div>
            {intentoPaso1 && errores1.vertical && (
              <small id={ayuda("vertical")} className="partner-error">
                {errores1.vertical}
              </small>
            )}
          </fieldset>

          <Campo
            id={`${id}-businessName`}
            etiqueta="Nombre comercial"
            ayuda="El que ven los clientes en Flash."
            error={intentoPaso1 ? errores1.businessName : undefined}
          >
            <input
              id={`${id}-businessName`}
              value={borrador.businessName}
              maxLength={120}
              autoComplete="organization"
              onChange={(event) => cambiar("businessName", event.target.value)}
            />
          </Campo>
          <Campo
            id={`${id}-legalName`}
            etiqueta="Razón social"
            ayuda="Como figura en tu constancia de ARCA."
            error={intentoPaso1 ? errores1.legalName : undefined}
          >
            <input
              id={`${id}-legalName`}
              value={borrador.legalName}
              maxLength={160}
              onChange={(event) => cambiar("legalName", event.target.value)}
            />
          </Campo>
          {/* El CUIT se valida mientras se escribe: el aviso del dígito verificador aparece
              apenas están los once dígitos, sin esperar a «Continuar». */}
          <Campo
            id={`${id}-taxId`}
            etiqueta="CUIT"
            ayuda={
              cuit.digitos.length === 11 || intentoPaso1
                ? cuit.mensaje
                : "Son 11 dígitos, con o sin guiones."
            }
            error={
              (cuit.digitos.length === 11 || intentoPaso1) && !cuit.valido
                ? cuit.mensaje
                : undefined
            }
            ok={cuit.valido}
          >
            <input
              id={`${id}-taxId`}
              inputMode="numeric"
              value={borrador.taxId}
              maxLength={13}
              placeholder="30-12345678-9"
              onChange={(event) => cambiar("taxId", event.target.value)}
              onBlur={() => cuit.valido && cambiar("taxId", formatoCuit(cuit.digitos))}
            />
          </Campo>
          <Campo
            id={`${id}-contactPhone`}
            etiqueta="Teléfono de contacto"
            ayuda="Con +54 y el código de área, sin 0 ni 15. Lo usa operaciones para hablar con vos."
            error={intentoPaso1 ? errores1.contactPhone : undefined}
          >
            <input
              id={`${id}-contactPhone`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={borrador.contactPhone}
              placeholder="+54 9 11 2345 6789"
              onFocus={() => !borrador.contactPhone && cambiar("contactPhone", "+54 ")}
              onChange={(event) => cambiar("contactPhone", event.target.value)}
            />
          </Campo>
        </>
      )}

      {paso === 2 && (
        <PasoDireccion
          id={id}
          borrador={borrador}
          cambiar={cambiar}
          mostrarError={intentoPaso2}
          setBorrador={setBorrador}
        />
      )}

      {paso === 3 && (
        <>
          <dl className="partner-review">
            <div className="partner-review-head">
              <dt>Comercio</dt>
              <dd>
                <button
                  type="button"
                  className="partner-link"
                  aria-label="Editar los datos del comercio"
                  onClick={() => setPaso(1)}
                >
                  Editar
                </button>
              </dd>
            </div>
            <Dato nombre="Rubro" valor={borrador.vertical ? rubroLabel(borrador.vertical) : ""} />
            <Dato nombre="Nombre comercial" valor={borrador.businessName.trim()} />
            <Dato nombre="Razón social" valor={borrador.legalName.trim()} />
            <Dato nombre="CUIT" valor={formatoCuit(cuit.digitos)} />
            <Dato nombre="Teléfono" valor={normalizarTelefono(borrador.contactPhone)} />
            <div className="partner-review-head">
              <dt>Local</dt>
              <dd>
                <button
                  type="button"
                  className="partner-link"
                  aria-label="Editar la dirección del local"
                  onClick={() => setPaso(2)}
                >
                  Editar
                </button>
              </dd>
            </div>
            <Dato nombre="Dirección" valor={borrador.lugar?.label ?? ""} />
          </dl>
          <Campo
            id={`${id}-notes`}
            etiqueta="Notas para operaciones (opcional)"
            ayuda={`${borrador.notes.trim().length} de 500 caracteres.`}
            error={notasLargas ? "Las notas pueden tener hasta 500 caracteres." : undefined}
          >
            <textarea
              id={`${id}-notes`}
              rows={4}
              value={borrador.notes}
              placeholder="Por ejemplo, si tenés más de un local o un horario especial."
              onChange={(event) => cambiar("notes", event.target.value)}
            />
          </Campo>
          <p className="partner-fineprint">
            Al enviar, operaciones revisa estos datos. Nada se publica hasta que la solicitud se
            apruebe.
          </p>
          {errorEnvio && (
            <div className="partner-alert" role="alert">
              <CircleAlert size={18} aria-hidden="true" /> {errorEnvio}
            </div>
          )}
        </>
      )}

      <div className="partner-actions">
        {paso > 1 && (
          <button
            type="button"
            className="partner-ghost"
            onClick={() => setPaso((paso - 1) as Paso)}
            disabled={enviando}
          >
            <ArrowLeft size={17} aria-hidden="true" /> Atrás
          </button>
        )}
        <button
          type="submit"
          className="partner-primary"
          disabled={enviando || (paso === 3 && notasLargas)}
        >
          {paso < 3 ? "Continuar" : enviando ? "Enviando…" : "Enviar solicitud"}
          {!enviando && <ArrowRight size={17} aria-hidden="true" />}
        </button>
      </div>
    </form>
  );
}

type Coincidencia = Awaited<ReturnType<typeof api.geocode>>["results"][number];

function PasoDireccion({
  id,
  borrador,
  cambiar,
  setBorrador,
  mostrarError,
}: {
  id: string;
  borrador: Borrador;
  cambiar: <K extends keyof Borrador>(campo: K, valor: Borrador[K]) => void;
  setBorrador: (actualizar: (actual: Borrador) => Borrador) => void;
  mostrarError: boolean;
}) {
  const [busqueda, setBusqueda] = useState<
    | { estado: "quieto" }
    | { estado: "buscando" }
    | { estado: "resultados"; coincidencias: Coincidencia[]; provider: string }
    | { estado: "error"; mensaje: string }
  >({ estado: "quieto" });

  // La misma geocodificación que la libreta de direcciones del cliente
  // (`CustomerAddressBook`): el local queda donde el proveedor de mapas lo ubica, no
  // donde alguien escribió que está. Sin coincidencia elegida no se puede seguir.
  const buscar = async () => {
    const consulta = borrador.address.trim();
    if (consulta.length < 3) return;
    setBusqueda({ estado: "buscando" });
    try {
      const respuesta = await api.geocode(consulta);
      setBusqueda({
        estado: "resultados",
        coincidencias: respuesta.results.slice(0, 5),
        provider: respuesta.provider,
      });
    } catch (error) {
      setBusqueda({
        estado: "error",
        mensaje: error instanceof Error ? error.message : "No pudimos buscar la dirección ahora.",
      });
    }
  };

  const elegir = (coincidencia: Coincidencia, provider: string) => {
    setBorrador((actual) => ({
      ...actual,
      address: coincidencia.label,
      lugar: {
        label: coincidencia.label,
        lat: coincidencia.point.lat,
        lng: coincidencia.point.lng,
        provider,
      },
      confirmada: false,
    }));
    setBusqueda({ estado: "quieto" });
  };

  const errorDireccion =
    mostrarError && !borrador.lugar
      ? "Buscá la dirección y elegí la que corresponde al local."
      : undefined;

  return (
    <>
      <Campo
        id={`${id}-address`}
        etiqueta="Dirección del local"
        ayuda="Calle, número y localidad. Después elegís la coincidencia correcta."
        error={errorDireccion}
        accion={
          <button
            type="button"
            className="partner-secondary"
            onClick={() => void buscar()}
            disabled={borrador.address.trim().length < 3 || busqueda.estado === "buscando"}
          >
            {busqueda.estado === "buscando" ? (
              <RefreshCw className="spin" size={17} aria-hidden="true" />
            ) : (
              <Search size={17} aria-hidden="true" />
            )}
            {busqueda.estado === "buscando" ? "Buscando…" : "Buscar"}
          </button>
        }
      >
        <input
          id={`${id}-address`}
          value={borrador.address}
          autoComplete="street-address"
          placeholder="Av. Corrientes 1234, CABA"
          onChange={(event) =>
            setBorrador((actual) => ({
              ...actual,
              address: event.target.value,
              lugar: null,
              confirmada: false,
            }))
          }
          onKeyDown={(event) => {
            // Enter acá busca: si siguiera el envío del formulario, se saltaría la
            // confirmación de la dirección.
            if (event.key === "Enter") {
              event.preventDefault();
              void buscar();
            }
          }}
        />
      </Campo>

      <div aria-live="polite">
        {busqueda.estado === "error" && (
          <div className="partner-alert" role="alert">
            <CircleAlert size={18} aria-hidden="true" /> {busqueda.mensaje}{" "}
            <button type="button" className="partner-link" onClick={() => void buscar()}>
              Reintentar
            </button>
          </div>
        )}
        {busqueda.estado === "resultados" && busqueda.coincidencias.length === 0 && (
          <p className="partner-alert">
            <CircleAlert size={18} aria-hidden="true" /> No encontramos esa dirección. Sumá el
            número, la localidad y la provincia.
          </p>
        )}
        {busqueda.estado === "resultados" && busqueda.coincidencias.length > 0 && (
          <div className="partner-matches" role="group" aria-label="Direcciones encontradas">
            <small>Elegí la del local</small>
            {busqueda.coincidencias.map((coincidencia) => (
              <button
                type="button"
                key={`${coincidencia.placeId || coincidencia.label}:${coincidencia.point.lat}:${coincidencia.point.lng}`}
                onClick={() => elegir(coincidencia, busqueda.provider)}
              >
                <MapPin size={17} aria-hidden="true" />
                <span>{coincidencia.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {borrador.lugar && (
        <div className="partner-found">
          <span className="partner-found-icon" aria-hidden="true">
            <MapPin size={20} />
          </span>
          <div>
            <small>Encontramos esta dirección</small>
            <strong>{borrador.lugar.label}</strong>
            <span className="partner-muted">
              {borrador.lugar.lat.toFixed(5)}, {borrador.lugar.lng.toFixed(5)}
              {borrador.lugar.provider ? ` · ${borrador.lugar.provider}` : ""}
            </span>
          </div>
          <label className="partner-check">
            <input
              id={`${id}-confirmada`}
              type="checkbox"
              checked={borrador.confirmada}
              onChange={(event) => cambiar("confirmada", event.target.checked)}
            />
            <span>Sí, el local está en esta dirección</span>
          </label>
          {mostrarError && !borrador.confirmada && (
            <small className="partner-error">Confirmá la dirección para seguir.</small>
          )}
        </div>
      )}
    </>
  );
}

function Campo({
  id,
  etiqueta,
  ayuda,
  error,
  ok = false,
  accion,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error?: string;
  ok?: boolean;
  /** Un botón al lado del campo, como «Buscar» en la dirección. */
  accion?: ReactNode;
  children: ReactElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const idAyuda = `${id}-texto`;
  // El campo lleva `aria-describedby` y `aria-invalid` hacia su ayuda o su error sin que
  // cada input lo repita: el lector de pantalla lee el motivo apenas entra al campo.
  const campo = cloneElement(children, {
    "aria-describedby": error || ayuda ? idAyuda : undefined,
    "aria-invalid": error ? true : undefined,
  });
  return (
    <div className={error ? "partner-field invalid" : ok ? "partner-field valid" : "partner-field"}>
      <label htmlFor={id}>{etiqueta}</label>
      {accion ? (
        <div className="partner-search">
          {campo}
          {accion}
        </div>
      ) : (
        campo
      )}
      {(error || ayuda) && (
        <small id={idAyuda} className={error ? "partner-error" : ok ? "partner-ok" : undefined}>
          {ok && !error && <Check size={13} aria-hidden="true" />} {error || ayuda}
        </small>
      )}
    </div>
  );
}

function Dato({ nombre, valor }: { nombre: string; valor: string }) {
  return (
    <div className="partner-review-row">
      <dt>{nombre}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function EstadoSolicitud({
  solicitud,
  recienEnviada,
  onNueva,
  onAbrirPortal,
}: {
  solicitud: MerchantApplication;
  recienEnviada: boolean;
  onNueva: () => void;
  onAbrirPortal: () => void;
}) {
  // Después de enviar, el formulario desaparece: el foco pasa al título del estado para que
  // el lector de pantalla lea la confirmación y el teclado no quede en el vacío.
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (recienEnviada) titulo.current?.focus();
  }, [recienEnviada]);
  const resumen = (
    <dl className="partner-review partner-review-compact">
      <Dato nombre="Comercio" valor={solicitud.businessName} />
      <Dato nombre="Rubro" valor={rubroLabel(solicitud.vertical)} />
      <Dato nombre="Razón social" valor={solicitud.legalName} />
      <Dato nombre="CUIT" valor={formatoCuit(solicitud.taxId.replace(/\D/g, ""))} />
      <Dato nombre="Dirección" valor={solicitud.address} />
      <Dato nombre="Presentada" valor={fechaDe(solicitud.createdAt)} />
    </dl>
  );

  if (solicitud.status === "pending")
    return (
      <div className="partner-card partner-status partner-status-pending" role="status">
        <span className="partner-status-icon" aria-hidden="true">
          <Clock3 size={24} />
        </span>
        <span className="partner-badge">En revisión</span>
        <h2 ref={titulo} tabIndex={-1} className="partner-focus-title">
          {recienEnviada
            ? "Recibimos tu solicitud. Te avisamos cuando la revisemos."
            : "Tu solicitud está en revisión"}
        </h2>
        <p>
          {recienEnviada
            ? "Operaciones revisa los datos y te avisa en Flash con la decisión."
            : "Todavía no hay una decisión. Te avisamos en Flash cuando la revisemos."}
        </p>
        {resumen}
      </div>
    );

  if (solicitud.status === "needs_changes")
    return (
      <div className="partner-card partner-status partner-status-changes">
        <span className="partner-status-icon" aria-hidden="true">
          <CircleAlert size={24} />
        </span>
        <span className="partner-badge">Te pedimos cambios</span>
        <h2>Operaciones revisó tu solicitud y necesita que corrijas algo</h2>
        {solicitud.decisionReason && (
          <blockquote className="partner-reason">
            <small>Qué hay que corregir</small>
            {solicitud.decisionReason}
          </blockquote>
        )}
        {/* La solicitud observada sigue abierta y el servidor no admite reemplazarla desde
            acá (una segunda solicitud da 409). Por eso se indica el canal real para
            responder en lugar de ofrecer un formulario que terminaría en error. */}
        <p>
          Escribinos desde <strong>Ayuda y soporte</strong> en la app de Flash, con la categoría
          Cuenta, y contanos el cambio. Con eso operaciones retoma la revisión de esta solicitud.
        </p>
        {resumen}
      </div>
    );

  if (solicitud.status === "approved")
    return (
      <div className="partner-card partner-status partner-status-approved">
        <span className="partner-status-icon" aria-hidden="true">
          <Check size={24} />
        </span>
        <span className="partner-badge">
          Aprobada {fechaDe(solicitud.decidedAt) && `· ${fechaDe(solicitud.decidedAt)}`}
        </span>
        <h2>¡{solicitud.businessName} ya es parte de Flash!</h2>
        <p>
          Creamos tu comercio cerrado y sin horarios. Desde el portal cargás el menú y el horario, y
          abrís el local cuando estés listo.
        </p>
        <button type="button" className="partner-primary" onClick={onAbrirPortal}>
          Abrir el portal de comercio <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    );

  return (
    <div className="partner-card partner-status partner-status-rejected">
      <span className="partner-status-icon" aria-hidden="true">
        <XCircle size={24} />
      </span>
      <span className="partner-badge">No aprobada</span>
      <h2>No pudimos aprobar tu solicitud</h2>
      {solicitud.decisionReason && (
        <blockquote className="partner-reason">
          <small>Motivo</small>
          {solicitud.decisionReason}
        </blockquote>
      )}
      <p>Si podés resolver el motivo, presentá una solicitud nueva con los datos corregidos.</p>
      {resumen}
      <button type="button" className="partner-primary" onClick={onNueva}>
        Empezar una solicitud nueva <ArrowRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
