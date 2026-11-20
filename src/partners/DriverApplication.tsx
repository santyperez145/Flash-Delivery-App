import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Car,
  Check,
  CircleAlert,
  Clock3,
  FileUp,
  Flame,
  LogOut,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";

import { api } from "../api";
import { achicarFoto } from "../media/achicarFoto";
import { DOCUMENTOS } from "./driverDocuments";
import type {
  DriverApplication,
  DriverApplicationVehicleKind,
  DriverCompliance,
  DriverDocument,
  DriverVehicle,
  User,
} from "../types";

// «Repartí con Flash» (FE-06): el único camino de producto para sumarse a repartir o
// manejar. Hasta esta ola un conductor existía sólo si lo creaba una semilla.
//
// Como en Uber (https://www.uber.com/us/en/deliver/), postularse es empezar: eligís con
// qué vas a trabajar, quedás registrado sin poder conectarte y subís los documentos que
// pide tu vehículo. En bicicleta, identidad y antecedentes; con moto o auto, además la
// licencia, la cédula y el seguro (Uber Eats pide lo mismo según el vehículo). Operaciones
// revisa cada documento y, con todo aprobado, ya te podés conectar desde la app.

type Props = {
  user: User;
  onVolver: () => void;
  onCerrarSesion: () => void;
};

type Ciudad = { id: string; name: string };
type Tipo = DriverDocument["type"];

const VEHICULOS: Record<
  DriverApplicationVehicleKind,
  { label: string; detalle: string; Icon: typeof Bike }
> = {
  bicycle: { label: "Bicicleta", detalle: "Entregas cerca, sin patente", Icon: Bike },
  motorcycle: { label: "Moto", detalle: "Entregas con licencia y seguro", Icon: Bike },
  car: { label: "Auto", detalle: "Entregas y viajes con pasajeros", Icon: Car },
};

const fecha = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const fechaDe = (iso: string | null) => (iso ? fecha.format(new Date(iso)) : "");

// Un PDF no se achica: entra como está si pesa menos que lo que admite el servidor.
const LIMITE_PDF = 750_000;
const leerBase64 = (archivo: File) =>
  new Promise<string>((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1] || "");
    lector.onerror = () => reject(new Error("No pudimos leer el archivo."));
    lector.readAsDataURL(archivo);
  });

export function DriverApplicationPage({ user, onVolver, onCerrarSesion }: Props) {
  const [carga, setCarga] = useState<
    | { estado: "cargando" }
    | { estado: "error"; mensaje: string }
    | { estado: "listo"; postulacion: DriverApplication | null }
  >({ estado: "cargando" });
  const [recienEnviada, setRecienEnviada] = useState(false);

  const cargar = useCallback(async () => {
    setCarga({ estado: "cargando" });
    try {
      const respuesta = await api.getMyDriverApplication();
      setCarga({ estado: "listo", postulacion: respuesta.application });
    } catch (error) {
      setCarga({
        estado: "error",
        mensaje: error instanceof Error ? error.message : "No pudimos cargar tu postulación.",
      });
    }
  }, []);
  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <main className="partner-shell">
      <header className="partner-top">
        <div className="partner-brand">
          <span className="web-auth-mark" aria-hidden="true">
            <Flame size={22} strokeWidth={2.4} />
          </span>
          <strong>Flash</strong>
          <span className="partner-brand-tag">para repartidores</span>
        </div>
        <button type="button" className="partner-ghost" onClick={onVolver}>
          <ArrowLeft size={17} aria-hidden="true" /> Volver a Flash
        </button>
      </header>

      <div className="partner-layout">
        <aside className="partner-aside" aria-labelledby="driver-aside-title">
          <h1 id="driver-aside-title">Repartí con Flash</h1>
          <p>
            Elegís cuándo conectarte y cobrás cada entrega o viaje. Revisamos tus documentos antes
            de que puedas recibir pedidos.
          </p>
          <h2>Qué vas a necesitar</h2>
          <ul>
            <li>Tu teléfono, verificado con un código.</li>
            <li>Tu DNI y el certificado de antecedentes penales.</li>
            <li>Con moto o auto, también la licencia, la cédula y el seguro.</li>
          </ul>
          <h2>Cómo sigue</h2>
          <ol>
            <li>Te postulás con tu vehículo y quedás registrado.</li>
            <li>Subís los documentos, con una foto o un PDF.</li>
            <li>Operaciones los revisa y, con todo aprobado, ya te podés conectar.</li>
          </ol>
          <p className="partner-account">
            <span>
              Te postulás con <strong>{user.email}</strong>.
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
              <p>Buscando tu postulación…</p>
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
          {carga.estado === "listo" && !carga.postulacion && (
            <Postularse
              user={user}
              onEnviada={(postulacion) => {
                setRecienEnviada(true);
                setCarga({ estado: "listo", postulacion });
              }}
              onYaRegistrado={() => void cargar()}
            />
          )}
          {carga.estado === "listo" && carga.postulacion && (
            <Requisitos postulacion={carga.postulacion} recienEnviada={recienEnviada} />
          )}
        </section>
      </div>
    </main>
  );
}

/** El teléfono verificado, el vehículo y la ciudad. */
function Postularse({
  user,
  onEnviada,
  onYaRegistrado,
}: {
  user: User;
  onEnviada: (postulacion: DriverApplication) => void;
  onYaRegistrado: () => void;
}) {
  const id = useId();
  const [verificado, setVerificado] = useState(Boolean(user.phoneVerifiedAt));
  const [ciudades, setCiudades] = useState<Ciudad[] | null>(null);
  const [cityId, setCityId] = useState("");
  const [kind, setKind] = useState<DriverApplicationVehicleKind | null>(null);
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [seats, setSeats] = useState("4");
  const [viajes, setViajes] = useState(false);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState("");

  useEffect(() => {
    let vigente = true;
    api
      .getCities()
      .then((respuesta) => {
        if (!vigente) return;
        setCiudades(respuesta.cities);
        if (respuesta.cities.length === 1) setCityId(respuesta.cities[0].id);
      })
      .catch(() => vigente && setCiudades([]));
    return () => {
      vigente = false;
    };
  }, []);

  const errores: Partial<Record<"cityId" | "kind" | "model" | "plate" | "seats", string>> = {};
  if (!cityId) errores.cityId = "Elegí la ciudad donde vas a trabajar.";
  if (!kind) errores.kind = "Elegí con qué vas a trabajar.";
  if (model.trim().length < 2) errores.model = "Escribí la marca y el modelo.";
  if (kind && kind !== "bicycle" && !/^[A-Za-z0-9 -]{3,16}$/.test(plate.trim()))
    errores.plate = "Escribí la patente con letras y números.";
  if (kind === "car" && viajes && !(Number(seats) >= 1 && Number(seats) <= 8))
    errores.seats = "Indicá cuántos pasajeros podés llevar (1 a 8).";

  const enviar = async (event: FormEvent) => {
    event.preventDefault();
    setIntento(true);
    const primero = Object.keys(errores)[0];
    if (primero) return document.getElementById(`${id}-${primero}`)?.focus();
    if (!kind) return;
    setEnviando(true);
    setErrorEnvio("");
    try {
      const respuesta = await api.submitDriverApplication({
        cityId,
        services: kind === "car" && viajes ? ["delivery", "ride"] : ["delivery"],
        vehicle: {
          kind,
          model: model.trim(),
          plate: kind === "bicycle" ? null : plate.trim().toUpperCase(),
          color: color.trim() || null,
          seats: kind === "car" ? Number(seats) || null : null,
        },
      });
      onEnviada(respuesta.application);
    } catch (error) {
      const cuerpo = (error as { body?: { code?: string } }).body;
      if (cuerpo?.code === "phone_verification_required") setVerificado(false);
      else if (cuerpo?.code === "already_registered") return onYaRegistrado();
      setErrorEnvio(error instanceof Error ? error.message : "No pudimos enviar la postulación.");
    } finally {
      setEnviando(false);
    }
  };

  if (!verificado)
    return <VerificarTelefono user={user} onVerificado={() => setVerificado(true)} />;

  const error = (campo: keyof typeof errores) => (intento ? errores[campo] : undefined);
  return (
    <form className="partner-card partner-form" onSubmit={enviar} noValidate>
      <header className="partner-form-header">
        <small>Tu postulación</small>
        <h2>¿Con qué vas a trabajar?</h2>
      </header>

      <div className={error("cityId") ? "partner-field invalid" : "partner-field"}>
        <label htmlFor={`${id}-cityId`}>Ciudad</label>
        <select
          id={`${id}-cityId`}
          value={cityId}
          onChange={(event) => setCityId(event.target.value)}
          aria-invalid={error("cityId") ? true : undefined}
          aria-describedby={error("cityId") ? `${id}-cityId-error` : undefined}
          disabled={!ciudades}
        >
          <option value="">{ciudades ? "Elegí una ciudad" : "Cargando ciudades…"}</option>
          {(ciudades || []).map((ciudad) => (
            <option key={ciudad.id} value={ciudad.id}>
              {ciudad.name}
            </option>
          ))}
        </select>
        {ciudades && !ciudades.length && (
          <small className="partner-error">Flash todavía no abrió ninguna ciudad.</small>
        )}
        {error("cityId") && (
          <small id={`${id}-cityId-error`} className="partner-error">
            {error("cityId")}
          </small>
        )}
      </div>

      <fieldset
        className="partner-rubros"
        aria-describedby={error("kind") ? `${id}-kind-error` : undefined}
      >
        <legend>Vehículo</legend>
        <div className="partner-rubro-grid">
          {(Object.keys(VEHICULOS) as DriverApplicationVehicleKind[]).map((opcion, indice) => {
            const { label, detalle, Icon } = VEHICULOS[opcion];
            return (
              <label key={opcion} className="partner-rubro">
                <input
                  type="radio"
                  name={`${id}-vehiculo`}
                  id={indice === 0 ? `${id}-kind` : undefined}
                  value={opcion}
                  checked={kind === opcion}
                  onChange={() => {
                    setKind(opcion);
                    if (opcion !== "car") setViajes(false);
                  }}
                />
                <span className="partner-rubro-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <strong>{label}</strong>
                <small>{detalle}</small>
              </label>
            );
          })}
        </div>
        {error("kind") && (
          <small id={`${id}-kind-error`} className="partner-error">
            {error("kind")}
          </small>
        )}
      </fieldset>

      {kind && (
        <>
          <Campo id={`${id}-model`} etiqueta="Marca y modelo" error={error("model")}>
            <input
              id={`${id}-model`}
              value={model}
              maxLength={80}
              placeholder={kind === "bicycle" ? "Por ejemplo, Venzo Rodado 29" : undefined}
              onChange={(event) => setModel(event.target.value)}
            />
          </Campo>
          {kind !== "bicycle" && (
            <Campo id={`${id}-plate`} etiqueta="Patente" error={error("plate")}>
              <input
                id={`${id}-plate`}
                value={plate}
                maxLength={16}
                autoCapitalize="characters"
                onChange={(event) => setPlate(event.target.value)}
              />
            </Campo>
          )}
          <Campo id={`${id}-color`} etiqueta="Color (opcional)">
            <input
              id={`${id}-color`}
              value={color}
              maxLength={40}
              onChange={(event) => setColor(event.target.value)}
            />
          </Campo>
          {kind === "car" && (
            <div className="partner-field">
              <label className="partner-check">
                <input
                  type="checkbox"
                  checked={viajes}
                  onChange={(event) => setViajes(event.target.checked)}
                />
                También quiero llevar pasajeros
              </label>
            </div>
          )}
          {kind === "car" && viajes && (
            <Campo id={`${id}-seats`} etiqueta="Asientos para pasajeros" error={error("seats")}>
              <input
                id={`${id}-seats`}
                type="number"
                inputMode="numeric"
                min={1}
                max={8}
                value={seats}
                onChange={(event) => setSeats(event.target.value)}
              />
            </Campo>
          )}
        </>
      )}

      {errorEnvio && (
        <p className="partner-error" role="alert">
          {errorEnvio}
        </p>
      )}
      <div className="partner-actions">
        <button type="submit" className="partner-primary" disabled={enviando}>
          {enviando ? "Enviando…" : "Postularme"} <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

/** El teléfono se verifica con un código antes de postularse, como en Uber. */
function VerificarTelefono({ user, onVerificado }: { user: User; onVerificado: () => void }) {
  const id = useId();
  const [telefono, setTelefono] = useState(user.phone || "+54");
  const [codigo, setCodigo] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [codigoPrueba, setCodigoPrueba] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const normalizado = telefono.replace(/[\s\-().]/g, "");
  const valido = /^\+54\d{10,11}$/.test(normalizado);

  const pedir = async (event: FormEvent) => {
    event.preventDefault();
    if (!valido) return setError("El teléfono va con +54 y el código de área, sin 0 ni 15.");
    setOcupado(true);
    setError("");
    try {
      const respuesta = await api.requestPhoneVerification(normalizado);
      // Sólo en un entorno de prueba sin SMS el servidor devuelve el código.
      setCodigoPrueba(respuesta.developmentCode || "");
      setEnviado(true);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No pudimos mandar el código.");
    } finally {
      setOcupado(false);
    }
  };
  const confirmar = async (event: FormEvent) => {
    event.preventDefault();
    setOcupado(true);
    setError("");
    try {
      await api.confirmPhoneVerification(codigo.trim());
      onVerificado();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "El código no es correcto.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form className="partner-card partner-form" onSubmit={enviado ? confirmar : pedir} noValidate>
      <header className="partner-form-header">
        <small>Antes de empezar</small>
        <h2>Verificá tu teléfono</h2>
        <p>Es por donde te van a contactar los clientes y operaciones mientras repartís.</p>
      </header>
      <Campo
        id={`${id}-telefono`}
        etiqueta="Teléfono"
        ayuda="Con +54 y el código de área, sin 0 ni 15."
      >
        <input
          id={`${id}-telefono`}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={telefono}
          disabled={enviado}
          onChange={(event) => setTelefono(event.target.value)}
        />
      </Campo>
      {enviado && (
        <Campo id={`${id}-codigo`} etiqueta="Código que te mandamos por SMS">
          <input
            id={`${id}-codigo`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            value={codigo}
            onChange={(event) => setCodigo(event.target.value)}
          />
        </Campo>
      )}
      {codigoPrueba && (
        <p className="partner-note">
          Entorno de prueba sin SMS: el código es <strong>{codigoPrueba}</strong>.
        </p>
      )}
      {error && (
        <p className="partner-error" role="alert">
          {error}
        </p>
      )}
      <div className="partner-actions">
        {enviado && (
          <button
            type="button"
            className="partner-ghost"
            onClick={() => {
              setEnviado(false);
              setCodigo("");
            }}
          >
            Cambiar el teléfono
          </button>
        )}
        <button type="submit" className="partner-primary" disabled={ocupado}>
          {enviado ? "Verificar" : "Mandarme el código"} <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

/** Los requisitos: cada fila es su acción, como en la app de Uber. */
function Requisitos({
  postulacion,
  recienEnviada,
}: {
  postulacion: DriverApplication;
  recienEnviada: boolean;
}) {
  const [legajo, setLegajo] = useState<DriverCompliance | null>(null);
  const [vehiculos, setVehiculos] = useState<DriverVehicle[]>([]);
  const [error, setError] = useState("");
  const titulo = useRef<HTMLHeadingElement>(null);

  const releer = useCallback(async () => {
    try {
      const [respuesta, flota] = await Promise.all([
        api.getDriverCompliance(postulacion.driverId),
        api.getDriverVehicles(postulacion.driverId),
      ]);
      setLegajo(respuesta.compliance);
      setVehiculos(flota.vehicles);
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No pudimos leer tus requisitos.");
    }
  }, [postulacion.driverId]);
  useEffect(() => {
    void releer();
  }, [releer]);
  useEffect(() => {
    if (recienEnviada) titulo.current?.focus();
  }, [recienEnviada]);

  const vehiculo = vehiculos.find((entrada) => entrada.active) || vehiculos[0] || null;
  const actual = (tipo: Tipo) =>
    legajo?.documents.find((doc) => doc.type === tipo && doc.status !== "superseded") || null;
  const aprobado = legajo?.status === "approved" && vehiculo?.status === "approved";
  // Mientras haya algo en revisión, la pantalla se actualiza sola: cada 30 s y al volver.
  const enRevision =
    !aprobado &&
    Boolean(
      legajo?.documents.some((doc) => doc.status === "pending") || vehiculo?.status === "pending",
    );
  useEffect(() => {
    if (!enRevision) return;
    const intervalo = window.setInterval(() => void releer(), 30_000);
    const alVolver = () => document.visibilityState === "visible" && void releer();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [enRevision, releer]);

  if (error && !legajo)
    return (
      <div className="partner-card partner-state" role="alert">
        <CircleAlert size={22} aria-hidden="true" />
        <p>{error}</p>
        <button type="button" className="partner-primary" onClick={() => void releer()}>
          <RefreshCw size={17} aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  if (!legajo)
    return (
      <div className="partner-card partner-state" role="status">
        <RefreshCw className="spin" size={22} aria-hidden="true" />
        <p>Cargando tus requisitos…</p>
      </div>
    );

  const faltan = legajo.requiredTypes.filter((tipo) => actual(tipo)?.status !== "approved").length;
  return (
    <div
      className={`partner-card partner-status ${aprobado ? "partner-status-approved" : "partner-status-pending"}`}
    >
      <span className="partner-status-icon" aria-hidden="true">
        {aprobado ? <Check size={24} /> : <Clock3 size={24} />}
      </span>
      <span className="partner-badge">
        {aprobado
          ? "Aprobado"
          : faltan
            ? `${legajo.requiredTypes.length - faltan} de ${legajo.requiredTypes.length} documentos aprobados`
            : "Documentos aprobados"}
      </span>
      <h2 ref={titulo} tabIndex={-1} className="partner-focus-title">
        {aprobado
          ? "¡Listo! Ya podés conectarte"
          : recienEnviada
            ? "Ya estás registrado. Ahora subí tus documentos"
            : "Tus requisitos para repartir"}
      </h2>
      <p>
        {aprobado
          ? "Abrí la app de Flash, conectate y empezá a recibir pedidos."
          : "Operaciones revisa cada documento y te avisa si hay que cambiar alguno. Cuando estén todos aprobados, te podés conectar."}
      </p>

      <ul className="driver-requisitos">
        {legajo.requiredTypes.map((tipo) => (
          <Requisito
            key={tipo}
            tipo={tipo}
            documento={actual(tipo)}
            driverId={postulacion.driverId}
            onSubido={() => void releer()}
          />
        ))}
        {vehiculo && (
          <li className={`driver-requisito driver-requisito-${vehiculo.status}`}>
            <span className="driver-requisito-icono" aria-hidden="true">
              {vehiculo.kind === "car" ? <Car size={18} /> : <Bike size={18} />}
            </span>
            <div>
              <strong>
                {VEHICULOS[vehiculo.kind as DriverApplicationVehicleKind]?.label ?? "Vehículo"} ·{" "}
                {vehiculo.model}
                {vehiculo.plate ? ` · ${vehiculo.plate}` : ""}
              </strong>
              <small>
                {vehiculo.status === "approved"
                  ? "Aprobado"
                  : vehiculo.status === "rejected"
                    ? `Rechazado: ${vehiculo.rejectionReason || "sin motivo"}`
                    : "En revisión"}
              </small>
            </div>
          </li>
        )}
      </ul>
      {error && (
        <p className="partner-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Requisito({
  tipo,
  documento,
  driverId,
  onSubido,
}: {
  tipo: Tipo;
  documento: DriverDocument | null;
  driverId: string;
  onSubido: () => void;
}) {
  const id = useId();
  const info = DOCUMENTOS[tipo];
  const [vence, setVence] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const archivo = useRef<HTMLInputElement>(null);
  const hoy = new Date().toISOString().slice(0, 10);

  const subir = async (seleccionado: File) => {
    setError("");
    if (info.vence && (!vence || vence < hoy))
      return setError("Indicá la fecha de vencimiento: tiene que estar vigente.");
    setSubiendo(true);
    try {
      const esPdf = seleccionado.type === "application/pdf";
      if (esPdf && seleccionado.size > LIMITE_PDF)
        throw new Error("El PDF pesa más de 750 KB. Sacale una foto o comprimilo.");
      const contentBase64 = esPdf
        ? await leerBase64(seleccionado)
        : await achicarFoto(seleccionado);
      await api.submitDriverDocument(driverId, {
        type: tipo,
        mimeType: esPdf ? "application/pdf" : "image/jpeg",
        contentBase64,
        expiresAt: info.vence ? vence : null,
      });
      onSubido();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No pudimos subir el documento.");
    } finally {
      setSubiendo(false);
      if (archivo.current) archivo.current.value = "";
    }
  };

  const estado = documento?.status ?? "missing";
  const detalle =
    estado === "approved"
      ? `Aprobado${documento?.expiresAt ? ` · vence el ${fechaDe(documento.expiresAt)}` : ""}`
      : estado === "pending"
        ? "En revisión"
        : estado === "rejected"
          ? `Rechazado: ${documento?.rejectionReason || "sin motivo"}`
          : estado === "expired"
            ? "Vencido: subí uno nuevo"
            : "Falta subir";
  const puedeSubir = estado !== "pending";
  return (
    <li className={`driver-requisito driver-requisito-${estado}`}>
      <span className="driver-requisito-icono" aria-hidden="true">
        {estado === "approved" ? (
          <ShieldCheck size={18} />
        ) : estado === "rejected" ? (
          <XCircle size={18} />
        ) : estado === "pending" ? (
          <Clock3 size={18} />
        ) : (
          <FileUp size={18} />
        )}
      </span>
      <div>
        <strong>{info.label}</strong>
        <small id={`${id}-estado`}>{detalle}</small>
        {puedeSubir && <small className="driver-requisito-ayuda">{info.ayuda}</small>}
        {puedeSubir && info.vence && (
          <label className="driver-requisito-vence">
            Vence el
            <input
              type="date"
              min={hoy}
              value={vence}
              onChange={(event) => setVence(event.target.value)}
            />
          </label>
        )}
        {error && (
          <small className="partner-error" role="alert">
            {error}
          </small>
        )}
      </div>
      {puedeSubir && (
        <label className="partner-primary driver-requisito-subir" aria-describedby={`${id}-estado`}>
          <input
            ref={archivo}
            type="file"
            accept="image/*,application/pdf"
            className="partner-visually-hidden"
            disabled={subiendo}
            onChange={(event) => {
              const elegido = event.target.files?.[0];
              if (elegido) void subir(elegido);
            }}
          />
          {subiendo ? "Subiendo…" : estado === "missing" ? "Subir" : "Reemplazar"}
          <span className="partner-visually-hidden"> {info.label}</span>
        </label>
      )}
    </li>
  );
}

function Campo({
  id,
  etiqueta,
  ayuda,
  error,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error?: string;
  children: ReactElement;
}) {
  return (
    <div className={error ? "partner-field invalid" : "partner-field"}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {(error || ayuda) && (
        <small className={error ? "partner-error" : undefined} role={error ? "alert" : undefined}>
          {error || ayuda}
        </small>
      )}
    </div>
  );
}
