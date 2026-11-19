// Altas de comercios en operaciones (FE-05, OPS-W01 y OPS-W02).
//
// Hasta esta ola no existía ningún camino de producto para que un comercio se
// sumara: el único `INSERT INTO merchants` estaba en un seed. La postulación
// llega desde /comercios y acá operaciones la decide.
//
// **La lista va por antigüedad, la más vieja primero.** Es la que más espera y
// la que primero se reclama; ordenarla por la más nueva escondería abajo justo
// la que importa, igual que en el tablero de colas.
//
// **Aprobar pide confirmación y rechazar pide motivo.** Aprobar crea el comercio,
// su sucursal y le da el rol a una persona: no es algo que se deshace con un
// clic. Rechazar o pedir cambios le llega a quien se postuló, y un «no» sin
// explicación se convierte en un llamado a soporte de todos modos.
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api";
import type {
  AdminMerchantApplication,
  MerchantApplicationDecision,
  MerchantApplicationStatus,
} from "../types";
import "../styles/merchant-onboarding.css";

const PESTANAS: Array<{ status: MerchantApplicationStatus; label: string; vacio: string }> = [
  {
    status: "pending",
    label: "Pendientes",
    vacio:
      "No hay solicitudes esperando revisión. Cuando un comercio se postule desde /comercios, aparece acá.",
  },
  {
    status: "needs_changes",
    label: "Con cambios pedidos",
    vacio: "No hay solicitudes a las que se les hayan pedido cambios.",
  },
  { status: "approved", label: "Aprobadas", vacio: "Todavía no se aprobó ninguna solicitud." },
  { status: "rejected", label: "Rechazadas", vacio: "No hay solicitudes rechazadas." },
];

// Rubro en singular: en la ficha de una solicitud se habla de un comercio, no
// de la sección del catálogo. Un rubro que el cliente no conoce se muestra tal
// cual llegó en lugar de adivinarle un nombre.
const RUBRO: Record<string, string> = {
  restaurant: "Restaurante",
  grocery: "Supermercado",
  pharmacy: "Farmacia",
  kiosk: "Kiosco",
  retail: "Tienda",
};

// Motivos frecuentes, editables. Escribir el mismo texto veinte veces por día
// termina en motivos de dos palabras; una base que se ajusta mantiene el
// mensaje claro para quien lo recibe sin quitarle al operador la última palabra.
const MOTIVOS = [
  "CUIT inválido o no coincide con la razón social",
  "Dirección fuera de zona de cobertura",
  "Faltan datos de contacto",
  "La dirección no se pudo ubicar en el mapa",
  "El nombre comercial no coincide con el local",
];

const fechaHora = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const fecha = (valor: string | null) => (valor ? fechaHora.format(new Date(valor)) : "—");

/** CUIT con guiones (20-12345678-9). Se muestra así porque es como figura en la
 *  constancia de AFIP con la que el operador lo va a comparar. */
function formatoCuit(cuit: string) {
  const digitos = cuit.replace(/\D/g, "");
  if (digitos.length !== 11) return cuit;
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

type Modo = "aprobar" | "reject" | "needs_changes" | null;

export function AdminApplications({
  canDecide,
  onDecided,
}: {
  /** Sólo un administrador decide; soporte ve la cola para poder responder consultas. */
  canDecide: boolean;
  /** Avisa a la consola para que recargue comercios y muestre el aviso. */
  onDecided: (mensaje: string) => void;
}) {
  const [status, setStatus] = useState<MerchantApplicationStatus>("pending");
  const [items, setItems] = useState<AdminMerchantApplication[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState("");
  const [seleccionId, setSeleccionId] = useState<string | null>(null);
  const [resultado, setResultado] = useState("");
  // Cada pedido lleva su número: si alguien cambia de pestaña antes de que
  // vuelva el anterior, la respuesta vieja no pisa la lista nueva.
  const pedido = useRef(0);

  const cargar = useCallback(async (estado: MerchantApplicationStatus) => {
    const numero = ++pedido.current;
    setCargando(true);
    setError("");
    try {
      const pagina = await api.getAdminMerchantApplications({ status: estado });
      if (numero !== pedido.current) return;
      setItems(pagina.applications);
      setNextCursor(pagina.nextCursor);
      setSeleccionId(pagina.applications[0]?.id ?? null);
    } catch (fallo) {
      if (numero !== pedido.current) return;
      setItems([]);
      setNextCursor(null);
      setSeleccionId(null);
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar las solicitudes");
    } finally {
      if (numero === pedido.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar(status);
  }, [cargar, status]);

  const verMas = async () => {
    if (!nextCursor) return;
    const numero = pedido.current;
    setCargandoMas(true);
    try {
      const pagina = await api.getAdminMerchantApplications({ status, cursor: nextCursor });
      if (numero !== pedido.current) return;
      // Se deduplica por id: una solicitud decidida entre página y página no
      // tiene que aparecer dos veces.
      setItems((previas) => {
        const vistas = new Set(previas.map((item) => item.id));
        return [...previas, ...pagina.applications.filter((item) => !vistas.has(item.id))];
      });
      setNextCursor(pagina.nextCursor);
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar más solicitudes");
    } finally {
      setCargandoMas(false);
    }
  };

  const seleccion = items.find((item) => item.id === seleccionId) || null;
  const pestanaActual = PESTANAS.find((pestana) => pestana.status === status)!;

  const alDecidir = (decidida: AdminMerchantApplication, mensaje: string) => {
    setResultado(mensaje);
    onDecided(mensaje);
    // Volver a pedir cambios sobre una observada no la cambia de pestaña: se
    // actualiza en su lugar con el motivo nuevo en vez de desaparecer de la lista.
    if (decidida.status === status) {
      setItems((previas) => previas.map((item) => (item.id === decidida.id ? decidida : item)));
      return;
    }
    // La solicitud decidida sale de esta pestaña (ya pertenece a otra) y se
    // pasa a la siguiente, que es lo que el operador iba a hacer igual.
    const restantes = items.filter((item) => item.id !== decidida.id);
    const indice = items.findIndex((item) => item.id === decidida.id);
    setItems(restantes);
    setSeleccionId(restantes[Math.min(indice, restantes.length - 1)]?.id ?? null);
  };

  return (
    <section className="admin-card" aria-labelledby="altas-titulo">
      <div className="admin-section-header">
        <h2 id="altas-titulo">Altas de comercios</h2>
        {/* Es el orden en que responde el servidor: las abiertas por antigüedad, porque
            son las que esperan; las resueltas, la última decisión arriba. */}
        <span>
          {status === "pending" || status === "needs_changes"
            ? "La más antigua primero"
            : "La más reciente primero"}
        </span>
      </div>

      <div className="altas-tabs" role="tablist" aria-label="Estado de las solicitudes">
        {PESTANAS.map((pestana) => {
          const activa = pestana.status === status;
          return (
            <button
              key={pestana.status}
              type="button"
              role="tab"
              id={`altas-tab-${pestana.status}`}
              aria-selected={activa}
              aria-controls="altas-panel"
              onClick={() => {
                setResultado("");
                setStatus(pestana.status);
              }}
            >
              {pestana.label}
              {/* El servidor no devuelve totales por estado: sólo se cuenta lo
                  que ya se cargó, con «+» si hay más páginas. Un total inventado
                  sería peor que no tenerlo. */}
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

      <div id="altas-panel" role="tabpanel" aria-labelledby={`altas-tab-${status}`}>
        {resultado && (
          <p className="altas-ok" role="status">
            {resultado}
          </p>
        )}
        {cargando ? (
          <p className="admin-empty" role="status">
            Cargando solicitudes…
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
              <ul className="altas-lista" aria-label={`Solicitudes: ${pestanaActual.label}`}>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={item.id === seleccionId ? "true" : undefined}
                      onClick={() => setSeleccionId(item.id)}
                    >
                      <strong>{item.businessName}</strong>
                      <small>
                        {RUBRO[item.vertical] || item.vertical} · CUIT {formatoCuit(item.taxId)}
                      </small>
                      <small>{item.address}</small>
                      <small>
                        {item.applicant.name} · {fecha(item.createdAt)}
                      </small>
                    </button>
                  </li>
                ))}
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
              <DetalleSolicitud
                key={seleccion.id}
                solicitud={seleccion}
                canDecide={canDecide}
                onDecidida={alDecidir}
              />
            ) : (
              <p className="admin-empty">Elegí una solicitud para ver el detalle.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DetalleSolicitud({
  solicitud,
  canDecide,
  onDecidida,
}: {
  solicitud: AdminMerchantApplication;
  canDecide: boolean;
  onDecidida: (solicitud: AdminMerchantApplication, mensaje: string) => void;
}) {
  const [modo, setModo] = useState<Modo>(null);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  // «Pedir cambios» deja la solicitud abierta: operaciones la sigue pudiendo aprobar o
  // rechazar cuando la persona le acerque lo que faltaba (todavía no hay una ruta para
  // que ella misma la edite). Por eso las dos abiertas se pueden decidir, y las cerradas no.
  const abierta = solicitud.status === "pending" || solicitud.status === "needs_changes";
  const motivoValido = motivo.trim().length >= 5 && motivo.trim().length <= 500;

  const decidir = async (decision: MerchantApplicationDecision) => {
    setEnviando(true);
    setError("");
    try {
      const respuesta = await api.decideMerchantApplication(solicitud.id, {
        decision,
        ...(decision === "approve" ? {} : { reason: motivo.trim() }),
      });
      onDecidida(
        respuesta.application,
        decision === "approve"
          ? `${solicitud.businessName} aprobado: ya tiene su comercio y su sucursal principal, cerrados y sin horarios hasta que el local los cargue.`
          : decision === "reject"
            ? `Solicitud de ${solicitud.businessName} rechazada. Le avisamos con el motivo.`
            : `Le pedimos cambios a ${solicitud.businessName}. Le avisamos con el motivo.`,
      );
      // Si la solicitud sigue en esta pestaña (otra vez «pedir cambios»), el formulario
      // se cierra: la decisión ya se registró y el motivo nuevo se ve en la ficha.
      setModo(null);
      setMotivo("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo registrar la decisión");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <article className="altas-detalle" aria-labelledby="altas-detalle-titulo">
      <h3 id="altas-detalle-titulo">{solicitud.businessName}</h3>
      <dl className="altas-datos">
        <dt>Razón social</dt>
        <dd>{solicitud.legalName}</dd>
        <dt>CUIT</dt>
        <dd>{formatoCuit(solicitud.taxId)}</dd>
        <dt>Rubro</dt>
        <dd>{RUBRO[solicitud.vertical] || solicitud.vertical}</dd>
        <dt>Dirección</dt>
        <dd>
          {solicitud.address}
          <br />
          <small>
            {solicitud.lat.toFixed(5)}, {solicitud.lng.toFixed(5)}
          </small>
        </dd>
        <dt>Teléfono</dt>
        <dd>
          <a href={`tel:${solicitud.contactPhone}`}>{solicitud.contactPhone}</a>
        </dd>
        <dt>Se postuló</dt>
        <dd>
          {solicitud.applicant.name} · {solicitud.applicant.email}
        </dd>
        <dt>Recibida</dt>
        <dd>{fecha(solicitud.createdAt)}</dd>
        {solicitud.notes && (
          <>
            <dt>Notas</dt>
            <dd>{solicitud.notes}</dd>
          </>
        )}
        {solicitud.decidedAt && (
          <>
            <dt>Decidida</dt>
            <dd>{fecha(solicitud.decidedAt)}</dd>
          </>
        )}
        {solicitud.decisionReason && (
          <>
            <dt>Motivo</dt>
            <dd>{solicitud.decisionReason}</dd>
          </>
        )}
        {solicitud.merchantId && (
          <>
            <dt>Comercio</dt>
            <dd>{solicitud.merchantId}</dd>
          </>
        )}
      </dl>

      {abierta && !canDecide && (
        <p className="altas-aviso">
          Las decisiones de alta las toma un administrador. Desde soporte podés ver el estado para
          responder consultas.
        </p>
      )}

      {abierta && canDecide && modo === null && (
        <div className="altas-acciones">
          <button
            type="button"
            className="altas-aprobar"
            disabled={enviando}
            onClick={() => setModo("aprobar")}
          >
            Aprobar
          </button>
          <button type="button" disabled={enviando} onClick={() => setModo("needs_changes")}>
            Pedir cambios
          </button>
          <button
            type="button"
            className="altas-rechazar"
            disabled={enviando}
            onClick={() => setModo("reject")}
          >
            Rechazar
          </button>
        </div>
      )}

      {abierta && canDecide && modo === "aprobar" && (
        <div className="altas-decision" role="group" aria-labelledby="altas-confirmar-titulo">
          <strong id="altas-confirmar-titulo">¿Aprobás el alta?</strong>
          <p className="altas-aviso">
            Se crea el comercio «{solicitud.businessName}» con su sucursal principal en{" "}
            {solicitud.address}, cerrada y sin horarios, y {solicitud.applicant.name} pasa a
            administrarlo. Le avisamos por la app.
          </p>
          <div className="altas-acciones">
            <button
              type="button"
              className="altas-aprobar"
              disabled={enviando}
              onClick={() => void decidir("approve")}
            >
              {enviando ? "Aprobando…" : "Sí, aprobar"}
            </button>
            <button type="button" disabled={enviando} onClick={() => setModo(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {abierta && canDecide && (modo === "reject" || modo === "needs_changes") && (
        <form
          className="altas-decision"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (motivoValido && modo) void decidir(modo);
          }}
        >
          <fieldset>
            <legend>{modo === "reject" ? "Motivo del rechazo" : "Qué tiene que cambiar"}</legend>
            {MOTIVOS.map((base) => (
              <label key={base}>
                <input
                  type="radio"
                  name="altas-motivo-base"
                  checked={motivo === base}
                  onChange={() => setMotivo(base)}
                />
                {base}
              </label>
            ))}
          </fieldset>
          <label>
            <span>Mensaje para {solicitud.applicant.name}</span>
            <textarea
              value={motivo}
              maxLength={500}
              aria-describedby="altas-motivo-ayuda"
              onChange={(evento) => setMotivo(evento.target.value)}
            />
            <small id="altas-motivo-ayuda">
              Entre 5 y 500 caracteres ({motivo.trim().length}). Lo lee quien se postuló: podés
              ajustarlo.
            </small>
          </label>
          <div className="altas-acciones">
            <button
              type="submit"
              className={modo === "reject" ? "altas-rechazar" : ""}
              // El servidor exige el motivo; habilitar antes sería ofrecer un 400.
              disabled={enviando || !motivoValido}
            >
              {enviando
                ? "Enviando…"
                : modo === "reject"
                  ? "Rechazar solicitud"
                  : "Enviar pedido de cambios"}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => {
                setModo(null);
                setMotivo("");
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="altas-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
