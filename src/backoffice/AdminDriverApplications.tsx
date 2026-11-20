// Cola de legajos de repartidores y conductores (FE-06, OPS-W02 y OPS-W21).
//
// Antes los documentos se revisaban conductor por conductor, con un panel incrustado
// por fila que pedía el legajo de cada uno. Acá hay una sola cola paginada que trae, de
// una vez, a cada conductor con sus documentos vigentes y sus vehículos; el contenido de
// un documento (un DNI, una licencia) se pide recién al abrirlo y se muestra embebido.
//
// **El más viejo primero**, como en Altas de comercios: es el que más espera.
// **Rechazar pide motivo**: es lo que lee quien se postuló para saber qué reemplazar.
// **Pasa solo al siguiente**: cuando un conductor ya no tiene nada para revisar, la
// selección salta al próximo de la cola.
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { api } from "../api";
import { DOCUMENTOS } from "../partners/driverDocuments";
import type { AdminDriverApplication } from "../types";
import "../styles/merchant-onboarding.css";

type Estado = "pending" | "approved" | "rejected";
const PESTANAS: Array<{ status: Estado; label: string; vacio: string }> = [
  {
    status: "pending",
    label: "Para revisar",
    vacio:
      "No hay documentos ni vehículos esperando revisión. Cuando alguien se postule desde /repartir, aparece acá.",
  },
  { status: "approved", label: "Aprobados", vacio: "Todavía no se aprobó ningún legajo." },
  { status: "rejected", label: "Con rechazos", vacio: "No hay legajos con documentos rechazados." },
];

// Motivos frecuentes, editables: el mismo criterio que en Altas de comercios.
const MOTIVOS = [
  "Foto borrosa: no se leen los datos",
  "Documento vencido",
  "No coincide con el nombre de la cuenta",
  "Falta el dorso del documento",
  "No es el documento pedido",
];

const VEHICULO: Record<string, string> = {
  bicycle: "Bicicleta",
  motorcycle: "Moto",
  car: "Auto",
  van: "Van",
};

const fechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fechaDia = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const fecha = (valor: string | null) => (valor ? fechaHora.format(new Date(valor)) : "—");

const pendientes = (item: AdminDriverApplication) =>
  item.documents.filter((doc) => doc.status === "pending").length +
  item.vehicles.filter((vehiculo) => vehiculo.status === "pending").length;

export function AdminDriverApplications({
  canDecide,
  onDecided,
}: {
  /** Sólo un administrador aprueba o rechaza; soporte lee para responder consultas. */
  canDecide: boolean;
  onDecided: (mensaje: string) => void;
}) {
  const [status, setStatus] = useState<Estado>("pending");
  const [items, setItems] = useState<AdminDriverApplication[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState("");
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const pedido = useRef(0);

  // Cuántas páginas hay cargadas: al refrescar se vuelven a leer todas, así quien se
  // está revisando en la página 2 no desaparece porque no está en la primera.
  const paginas = useRef(1);
  const cargar = useCallback(async (estado: Estado, mantener: string | null = null) => {
    const numero = ++pedido.current;
    setError("");
    try {
      let todos: AdminDriverApplication[] = [];
      let cursor: string | null = null;
      for (let leidas = 0; leidas < paginas.current; leidas += 1) {
        const pagina = await api.getAdminDriverApplications({ status: estado, cursor });
        todos = [
          ...todos,
          ...pagina.drivers.filter((item) => !todos.some((t) => t.id === item.id)),
        ];
        cursor = pagina.nextCursor;
        if (!cursor) break;
      }
      if (numero !== pedido.current) return;
      setItems(todos);
      setNextCursor(cursor);
      // Se queda en el mismo conductor si sigue en la cola y le queda algo para revisar;
      // si no, pasa al primero que espera.
      const sigue = todos.find((item) => item.id === mantener);
      setSeleccionId(
        sigue && (estado !== "pending" || pendientes(sigue)) ? sigue.id : (todos[0]?.id ?? null),
      );
    } catch (fallo) {
      if (numero !== pedido.current) return;
      setError(fallo instanceof Error ? fallo.message : "No se pudo cargar la cola de legajos");
    } finally {
      if (numero === pedido.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    setCargando(true);
    setItems([]);
    paginas.current = 1;
    void cargar(status);
  }, [cargar, status]);

  // La cola se actualiza sola cada 30 s con la pestaña visible: otra persona pudo
  // revisar, y un conductor nuevo pudo subir documentos.
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === "visible") void cargar(status, seleccionId);
    }, 30_000);
    return () => window.clearInterval(intervalo);
  }, [cargar, status, seleccionId]);

  // La pestaña que se ve ahora: una página que vuelve después de cambiar de pestaña es de
  // otra cola y no se mezcla con esta.
  const pestanaVigente = useRef(status);
  useEffect(() => {
    pestanaVigente.current = status;
  }, [status]);
  const verMas = async () => {
    if (!nextCursor) return;
    const pedida = status;
    setCargandoMas(true);
    try {
      const pagina = await api.getAdminDriverApplications({ status, cursor: nextCursor });
      if (pestanaVigente.current !== pedida) return;
      setItems((actuales) => [
        ...actuales,
        ...pagina.drivers.filter((item) => !actuales.some((actual) => actual.id === item.id)),
      ]);
      setNextCursor(pagina.nextCursor);
      paginas.current += 1;
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo cargar la página siguiente");
    } finally {
      setCargandoMas(false);
    }
  };

  const seleccion = items.find((item) => item.id === seleccionId) || null;
  const pestanaActual = PESTANAS.find((pestana) => pestana.status === status)!;

  return (
    <div className="altas-conductores">
      <div className="altas-tabs" role="tablist" aria-label="Estado de los legajos">
        {PESTANAS.map((pestana) => {
          const activa = pestana.status === status;
          return (
            <button
              key={pestana.status}
              type="button"
              role="tab"
              id={`legajos-tab-${pestana.status}`}
              aria-selected={activa}
              aria-controls="legajos-panel"
              onClick={() => setStatus(pestana.status)}
            >
              {pestana.label}
              {activa && !cargando && !error && (
                <b>
                  {items.length}
                  {nextCursor ? "+" : ""}
                </b>
              )}
            </button>
          );
        })}
      </div>

      <div id="legajos-panel" role="tabpanel" aria-labelledby={`legajos-tab-${status}`}>
        {cargando ? (
          <p className="admin-empty" role="status">
            Cargando legajos…
          </p>
        ) : error && items.length === 0 ? (
          <div role="alert">
            <p className="altas-error">{error}</p>
            <button type="button" className="altas-mas" onClick={() => void cargar(status)}>
              Reintentar
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="admin-empty">{pestanaActual.vacio}</p>
        ) : (
          <div className="altas-grid">
            <div>
              <ul className="altas-lista" aria-label={`Legajos: ${pestanaActual.label}`}>
                {items.map((item) => {
                  const aprobados = item.requiredTypes.filter((tipo) =>
                    item.documents.some((doc) => doc.type === tipo && doc.status === "approved"),
                  ).length;
                  const vehiculo =
                    item.vehicles.find((entrada) => entrada.active) || item.vehicles[0];
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={item.id === seleccionId ? "true" : undefined}
                        onClick={() => setSeleccionId(item.id)}
                      >
                        <strong>{item.person.name}</strong>
                        <small>
                          {vehiculo ? VEHICULO[vehiculo.kind] || vehiculo.kind : "Sin vehículo"}
                          {item.city ? ` · ${item.city}` : ""}
                        </small>
                        <small>
                          {aprobados} de {item.requiredTypes.length} documentos aprobados
                          {pendientes(item) ? ` · ${pendientes(item)} para revisar` : ""}
                        </small>
                        <small>Se postuló el {fecha(item.createdAt)}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {error && (
                <p className="altas-error" role="alert">
                  {error}
                </p>
              )}
              {nextCursor && (
                <button
                  type="button"
                  className="altas-mas"
                  disabled={cargandoMas}
                  onClick={() => void verMas()}
                >
                  {cargandoMas ? "Cargando…" : "Ver más"}
                </button>
              )}
            </div>
            {seleccion ? (
              <DetalleLegajo
                key={seleccion.id}
                legajo={seleccion}
                canDecide={canDecide}
                onRevisado={(mensaje) => {
                  onDecided(mensaje);
                  void cargar(status, seleccion.id);
                }}
              />
            ) : (
              <p className="admin-empty">Elegí un legajo para ver los documentos.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetalleLegajo({
  legajo,
  canDecide,
  onRevisado,
}: {
  legajo: AdminDriverApplication;
  canDecide: boolean;
  onRevisado: (mensaje: string) => void;
}) {
  const documento = (tipo: string) => legajo.documents.find((doc) => doc.type === tipo) || null;
  return (
    <article className="altas-detalle" aria-labelledby="legajo-titulo">
      <h3 id="legajo-titulo">{legajo.person.name}</h3>
      <dl className="altas-datos">
        <dt>Email</dt>
        <dd>{legajo.person.email}</dd>
        <dt>Teléfono</dt>
        <dd>
          {legajo.person.phone || "—"}
          {legajo.person.phoneVerified ? " · verificado" : " · sin verificar"}
        </dd>
        <dt>Ciudad</dt>
        <dd>{legajo.city || "—"}</dd>
        <dt>Servicios</dt>
        <dd>
          {legajo.services
            .map((servicio) => (servicio === "ride" ? "Viajes" : "Entregas"))
            .join(" y ")}
        </dd>
      </dl>

      <h4 className="legajo-subtitulo">Documentos</h4>
      <ul className="legajo-documentos">
        {legajo.requiredTypes.map((tipo) => (
          <ItemDocumento
            // Por documento y no por tipo: si la persona lo reemplaza con la vista abierta, la
            // vista vieja no queda mostrando un archivo mientras se aprueba otro.
            key={`${tipo}-${documento(tipo)?.id ?? "falta"}`}
            tipo={tipo}
            documento={documento(tipo)}
            nombre={legajo.person.name}
            canDecide={canDecide}
            onRevisado={onRevisado}
          />
        ))}
      </ul>

      <h4 className="legajo-subtitulo">Vehículo</h4>
      <ul className="legajo-documentos">
        {legajo.vehicles.map((vehiculo) => (
          <li key={vehiculo.id} className={`legajo-documento legajo-${vehiculo.status}`}>
            <div className="legajo-documento-cabecera">
              <strong>
                {VEHICULO[vehiculo.kind] || vehiculo.kind} · {vehiculo.model}
              </strong>
              <small>
                {vehiculo.plate ? `Patente ${vehiculo.plate}` : "Sin patente"}
                {vehiculo.color ? ` · ${vehiculo.color}` : ""}
                {vehiculo.seats ? ` · ${vehiculo.seats} asientos` : ""}
              </small>
              <small>
                {vehiculo.status === "approved"
                  ? "Aprobado"
                  : vehiculo.status === "rejected"
                    ? `Rechazado: ${vehiculo.rejectionReason || "sin motivo"}`
                    : "Para revisar"}
              </small>
            </div>
            {canDecide && vehiculo.status === "pending" && (
              <Decision
                etiqueta={`${VEHICULO[vehiculo.kind] || vehiculo.kind} ${vehiculo.model}`}
                onDecidir={async (aprobar, motivo) => {
                  await api.reviewDriverVehicle(
                    vehiculo.id,
                    aprobar ? "approved" : "rejected",
                    motivo,
                  );
                  onRevisado(
                    aprobar
                      ? `Vehículo de ${legajo.person.name} aprobado.`
                      : `Vehículo de ${legajo.person.name} rechazado. Le avisamos con el motivo.`,
                  );
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

function ItemDocumento({
  tipo,
  documento,
  nombre,
  canDecide,
  onRevisado,
}: {
  tipo: AdminDriverApplication["requiredTypes"][number];
  documento: AdminDriverApplication["documents"][number] | null;
  nombre: string;
  canDecide: boolean;
  onRevisado: (mensaje: string) => void;
}) {
  const info = DOCUMENTOS[tipo];
  const [vista, setVista] = useState<{ url: string; pdf: boolean } | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState("");
  // La vista es un Blob en memoria: se libera al cerrar o al cambiar de documento.
  useEffect(
    () => () => {
      if (vista) URL.revokeObjectURL(vista.url);
    },
    [vista],
  );

  // Un pedido que vuelve después de desmontar (el documento se reemplazó) no se muestra.
  const montado = useRef(true);
  useEffect(() => {
    // En modo estricto React monta, desmonta y vuelve a montar: se marca de nuevo.
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);
  const abrir = async () => {
    if (!documento) return;
    setAbriendo(true);
    setError("");
    try {
      const respuesta = await api.getDriverDocumentContent(documento.id);
      if (!montado.current) return;
      const bytes = Uint8Array.from(atob(respuesta.contentBase64), (caracter) =>
        caracter.charCodeAt(0),
      );
      const blob = new Blob([bytes], { type: respuesta.document.mimeType });
      setVista({
        url: URL.createObjectURL(blob),
        pdf: respuesta.document.mimeType === "application/pdf",
      });
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo abrir el documento");
    } finally {
      setAbriendo(false);
    }
  };

  const estado = documento?.status ?? "missing";
  return (
    <li className={`legajo-documento legajo-${estado}`}>
      <div className="legajo-documento-cabecera">
        <strong>{info.label}</strong>
        <small>
          {estado === "missing"
            ? "Todavía no lo subió"
            : estado === "approved"
              ? "Aprobado"
              : estado === "rejected"
                ? `Rechazado: ${documento?.rejectionReason || "sin motivo"}`
                : `Para revisar · subido el ${fecha(documento?.createdAt ?? null)}`}
          {documento?.expiresAt
            ? ` · vence el ${fechaDia.format(new Date(documento.expiresAt))}`
            : ""}
        </small>
      </div>
      {documento && !vista && (
        <button
          type="button"
          className="altas-mas"
          disabled={abriendo}
          onClick={() => void abrir()}
        >
          {abriendo ? "Abriendo…" : "Ver documento"}
        </button>
      )}
      {vista && (
        <div className="legajo-vista">
          {vista.pdf ? (
            <iframe src={vista.url} title={`${info.label} de ${nombre}`} />
          ) : (
            <img src={vista.url} alt={`${info.label} de ${nombre}`} />
          )}
          <button type="button" className="altas-mas" onClick={() => setVista(null)}>
            Cerrar
          </button>
        </div>
      )}
      {error && (
        <p className="altas-error" role="alert">
          {error}
        </p>
      )}
      {canDecide && documento?.status === "pending" && (
        <Decision
          etiqueta={info.label}
          onDecidir={async (aprobar, motivo) => {
            await api.reviewDriverDocument(documento.id, aprobar ? "approved" : "rejected", motivo);
            onRevisado(
              aprobar
                ? `${info.label} de ${nombre} aprobado.`
                : `${info.label} de ${nombre} rechazado. Le avisamos con el motivo.`,
            );
          }}
        />
      )}
    </li>
  );
}

/** Aprobar de un clic; rechazar pide el motivo, que es lo que lee quien se postuló. */
function Decision({
  etiqueta,
  onDecidir,
}: {
  etiqueta: string;
  onDecidir: (aprobar: boolean, motivo?: string) => Promise<void>;
}) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const idMotivo = `motivo-${useId()}`;
  const valido = motivo.trim().length >= 5 && motivo.trim().length <= 500;

  const decidir = async (aprobar: boolean) => {
    setEnviando(true);
    setError("");
    try {
      await onDecidir(aprobar, aprobar ? undefined : motivo.trim());
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo registrar la revisión");
    } finally {
      setEnviando(false);
    }
  };

  if (!rechazando)
    return (
      <div className="altas-acciones">
        <button
          type="button"
          className="altas-aprobar"
          disabled={enviando}
          onClick={() => void decidir(true)}
          aria-label={`Aprobar ${etiqueta}`}
        >
          Aprobar
        </button>
        <button
          type="button"
          className="altas-rechazar"
          disabled={enviando}
          onClick={() => setRechazando(true)}
          aria-label={`Rechazar ${etiqueta}`}
        >
          Rechazar
        </button>
        {error && (
          <p className="altas-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="altas-decision">
      <fieldset>
        <legend>Motivos frecuentes</legend>
        {MOTIVOS.map((frecuente) => (
          <label key={frecuente}>
            <input
              type="radio"
              name={idMotivo}
              checked={motivo === frecuente}
              onChange={() => setMotivo(frecuente)}
            />
            {frecuente}
          </label>
        ))}
      </fieldset>
      <label htmlFor={idMotivo}>Motivo que va a leer quien se postuló</label>
      <textarea
        id={idMotivo}
        value={motivo}
        maxLength={500}
        aria-describedby={`${idMotivo}-ayuda`}
        onChange={(event) => setMotivo(event.target.value)}
      />
      <small id={`${idMotivo}-ayuda`}>Entre 5 y 500 caracteres.</small>
      {error && (
        <p className="altas-error" role="alert">
          {error}
        </p>
      )}
      <div className="altas-acciones">
        <button
          type="button"
          className="altas-rechazar"
          disabled={!valido || enviando}
          onClick={() => void decidir(false)}
        >
          {enviando ? "Enviando…" : "Rechazar con este motivo"}
        </button>
        <button type="button" disabled={enviando} onClick={() => setRechazando(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
