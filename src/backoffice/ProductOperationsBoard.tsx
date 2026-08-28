// Tableros de producto y operación (ticket ARC-001, cableado de la API).
//
// Cinco rutas estaban construidas, con suite propia, y sin ninguna pantalla que
// las llamara: el embudo de producto, los flags por audiencia y el go/no-go de
// zona. `test:api-wiring` las encontró como huérfanas.
//
// Es la forma más cara de deuda: la capacidad existe, sus pruebas pasan, y el
// producto no la ofrece. Nadie se entera porque nada falla.
//
// Viven en su propio archivo y no dentro de `AdminConsole.tsx` porque ese
// archivo es lo que ARC-001 viene achicando. Agregar 300 líneas ahí habría
// cerrado un criterio empujando otro para atrás.
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, TriangleAlert } from "lucide-react";

import { api } from "../api";
import type { FeatureFlag, ProductMetrics, ZoneReadiness } from "../types";

const VENTANAS = [7, 14, 30] as const;

/**
 * Cada chequeo, con el hecho y el umbral que lo deciden.
 *
 * Las claves no coinciden entre `checks`, `facts` y `criteria` —`completedJobs`
 * se decide con `completedJobs7d` contra `minCompletedJobs7d`— así que hay que
 * declarar la correspondencia. Mostrar sólo el booleano sería decir «esta zona
 * no está lista» sin decir por cuánto, que es lo único accionable.
 */
const CHEQUEOS: Record<
  string,
  { etiqueta: string; hecho: string; umbral: string; sentido: string }
> = {
  freshDrivers: {
    etiqueta: "Conductores con posición fresca",
    hecho: "freshDrivers",
    umbral: "minFreshDrivers",
    sentido: "mínimo",
  },
  activeBranches: {
    etiqueta: "Sucursales activas",
    hecho: "activeBranches",
    umbral: "minActiveBranches",
    sentido: "mínimo",
  },
  completedJobs: {
    etiqueta: "Servicios completados (7 d)",
    hecho: "completedJobs7d",
    umbral: "minCompletedJobs7d",
    sentido: "mínimo",
  },
  cancellations: {
    etiqueta: "Cancelaciones",
    hecho: "cancellationPercent",
    umbral: "maxCancellationPercent",
    sentido: "máximo",
  },
  urgentSupport: {
    etiqueta: "Tickets urgentes",
    hecho: "urgentTickets",
    umbral: "maxUrgentTickets",
    sentido: "máximo",
  },
};

function Vacio({ mensaje }: { mensaje: string }) {
  return <p className="admin-empty">{mensaje}</p>;
}

export function ProductFunnelPanel() {
  const [dias, setDias] = useState<number>(7);
  const [metricas, setMetricas] = useState<ProductMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    setError(null);
    api
      .getProductMetrics(dias)
      .then((datos) => vigente && setMetricas(datos.metrics))
      .catch(() => vigente && setError("El embudo de producto requiere PostgreSQL."));
    return () => {
      vigente = false;
    };
  }, [dias]);

  if (error) return <Vacio mensaje={error} />;
  if (!metricas) return <Vacio mensaje="Cargando embudo…" />;

  const eventos = Object.entries(metricas.events)
    .sort((a, b) => b[1].events - a[1].events)
    .slice(0, 8);

  return (
    <div className="producto-embudo">
      <div className="producto-ventana" role="group" aria-label="Ventana del embudo">
        {VENTANAS.map((opcion) => (
          <button
            key={opcion}
            type="button"
            className={opcion === dias ? "activo" : ""}
            onClick={() => setDias(opcion)}
          >
            {opcion} d
          </button>
        ))}
      </div>
      <ol className="producto-pasos">
        {[
          ["Vieron el inicio", metricas.funnel.homeUsers, null],
          [
            "Llegaron al checkout",
            metricas.funnel.checkoutUsers,
            metricas.funnel.homeToCheckoutPercent,
          ],
          [
            "Crearon un pedido",
            metricas.funnel.createdUsers,
            metricas.funnel.checkoutToCreatedPercent,
          ],
        ].map(([etiqueta, valor, conversion]) => (
          <li key={String(etiqueta)}>
            <strong>{Number(valor).toLocaleString("es-AR")}</strong>
            <span>{etiqueta}</span>
            {conversion !== null && <small>{conversion}% del paso anterior</small>}
          </li>
        ))}
      </ol>
      {eventos.length === 0 ? (
        <Vacio mensaje={`Sin eventos registrados en ${metricas.windowDays} días.`} />
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Veces</th>
              <th>Usuarios</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map(([nombre, dato]) => (
              <tr key={nombre}>
                <td>
                  <code>{nombre}</code>
                </td>
                <td>{dato.events.toLocaleString("es-AR")}</td>
                <td>{dato.users.toLocaleString("es-AR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * `runAction` es el canal de feedback que la consola ya usa para toda mutación:
 * corre la acción, muestra el mensaje y maneja el estado ocupado. Inventar otro
 * habría dado dos formas de avisar lo mismo en la misma pantalla.
 */
type Accion = (accion: () => Promise<unknown>, exito: string) => void;

export function FeatureFlagsPanel({ runAction }: { runAction: Accion }) {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api
      .getFeatureFlags()
      .then((datos) => setFlags(datos.flags))
      .catch(() => setError("Los flags requieren PostgreSQL."));
  }, []);

  useEffect(cargar, [cargar]);

  const alternar = (flag: FeatureFlag) => {
    setOcupado(flag.id);
    runAction(
      async () => {
        try {
          await api.updateFeatureFlag(flag.id, { enabled: !flag.enabled });
          cargar();
        } finally {
          setOcupado(null);
        }
      },
      `${flag.key} quedó ${flag.enabled ? "apagado" : "encendido"}`,
    );
  };

  if (error) return <Vacio mensaje={error} />;
  if (!flags) return <Vacio mensaje="Cargando flags…" />;
  if (flags.length === 0) return <Vacio mensaje="No hay flags declarados." />;

  return (
    <ul className="producto-flags">
      {flags.map((flag) => (
        <li key={flag.id}>
          <div>
            <strong>{flag.key}</strong>
            <p>{flag.description}</p>
            <small>
              {flag.rolloutPercentage}% de rollout
              {flag.allowedRoles.length > 0 && ` · ${flag.allowedRoles.join(", ")}`}
              {flag.city && ` · ${flag.city}`}
            </small>
          </div>
          <button
            type="button"
            className={flag.enabled ? "flag-encendido" : "flag-apagado"}
            disabled={ocupado === flag.id}
            onClick={() => alternar(flag)}
            aria-label={`${flag.enabled ? "Apagar" : "Encender"} ${flag.key}`}
          >
            {flag.enabled ? "Encendido" : "Apagado"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ZoneReadinessPanel({
  zones,
  runAction,
}: {
  zones: Array<{ id: string; name: string }>;
  runAction: Accion;
}) {
  const [zonaId, setZonaId] = useState<string>(zones[0]?.id ?? "");
  const [lectura, setLectura] = useState<ZoneReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!zonaId) return undefined;
    let vigente = true;
    setError(null);
    setLectura(null);
    api
      .getZoneReadiness(zonaId)
      .then((datos) => vigente && setLectura(datos.readiness))
      .catch(() => vigente && setError("El go/no-go de zona requiere PostgreSQL."));
    return () => {
      vigente = false;
    };
  }, [zonaId]);

  // Se deja constancia de la decisión con su actor. La decisión la calcula el
  // servidor con los mismos umbrales que se muestran arriba: este botón no la
  // dicta, la registra.
  const registrar = () => {
    setOcupado(true);
    runAction(async () => {
      try {
        await api.recordZoneAssessment(zonaId);
      } finally {
        setOcupado(false);
      }
    }, "Evaluación de zona registrada");
  };

  if (zones.length === 0) return <Vacio mensaje="No hay zonas configuradas." />;

  return (
    <div className="producto-zona">
      <label>
        <span>Zona</span>
        <select value={zonaId} onChange={(evento) => setZonaId(evento.target.value)}>
          {zones.map((zona) => (
            <option key={zona.id} value={zona.id}>
              {zona.name}
            </option>
          ))}
        </select>
      </label>
      {error && <Vacio mensaje={error} />}
      {lectura && (
        <>
          <p className={lectura.decision === "go" ? "zona-go" : "zona-nogo"}>
            {lectura.decision === "go" ? <BadgeCheck size={16} /> : <TriangleAlert size={16} />}
            <span>
              {lectura.zone.name} · {lectura.decision === "go" ? "lista para operar" : "no lista"}
            </span>
          </p>
          <ul className="producto-chequeos">
            {Object.entries(lectura.checks).map(([clave, cumple]) => {
              const definicion = CHEQUEOS[clave];
              return (
                <li key={clave} className={cumple ? "cumple" : "falla"}>
                  <span>{definicion?.etiqueta ?? clave}</span>
                  <small>
                    {definicion
                      ? `${lectura.facts[definicion.hecho] ?? "—"} · ${definicion.sentido} ${
                          lectura.criteria[definicion.umbral] ?? "—"
                        }`
                      : cumple
                        ? "cumple"
                        : "no cumple"}
                  </small>
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={registrar} disabled={ocupado}>
            Registrar evaluación
          </button>
        </>
      )}
    </div>
  );
}
