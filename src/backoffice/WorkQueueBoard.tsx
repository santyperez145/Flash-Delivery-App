// Tablero de colas de trabajo (ticket OPS-001).
//
// El backoffice tenía un panel por dominio y ninguna respuesta a **«qué se está
// acumulando y hace cuánto»**. Para saberlo había que entrar a ocho secciones y
// contar a ojo.
//
// **Se ordena por antigüedad, no por cantidad.** Una cola con trescientos
// elementos de este minuto está sana; una con tres de hace cuatro días no.
// Ordenar por cantidad pondría arriba la que más ruido hace y abajo la que más
// importa.
//
// **La distinción entre cola de máquina y cola de persona es la que acciona.**
// Si una cola que vacía un trabajo programado se llena, falta cron. Si se llena
// una que atiende una persona, falta gente o falta prioridad. Sin separarlas,
// las doce se leen igual y ninguna dice qué hacer.
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";

type Cola = {
  key: string;
  label: string;
  owner: "job" | "human";
  pending: number;
  oldestMinutes: number;
  oldestAt: string | null;
  severity: "ok" | "atencion" | "alarma";
};

/** Antigüedad legible. Los minutos sueltos dejan de servir pasada la hora: «487
 *  minutos» obliga a dividir para entender que son ocho horas. */
function antiguedad(minutos: number) {
  if (minutos < 1) return "recién";
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 60 * 24) return `${Math.floor(minutos / 60)} h`;
  return `${Math.floor(minutos / (60 * 24))} d`;
}

const ETIQUETA_DUENO: Record<Cola["owner"], string> = {
  job: "trabajo programado",
  human: "persona",
};

export function WorkQueueBoard() {
  const [datos, setDatos] = useState<{
    queues: Cola[];
    alerting: number;
    stalledJobs: number;
    generatedAt: string;
  } | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.getWorkQueues());
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo leer el estado de las colas");
    }
  }, []);

  useEffect(() => {
    void cargar();
    // Se refresca solo cada treinta segundos. Un tablero de colas que hay que
    // recargar a mano deja de mirarse, y el valor de esto es justamente que
    // alguien lo tenga abierto.
    const temporizador = window.setInterval(() => void cargar(), 30_000);
    return () => window.clearInterval(temporizador);
  }, [cargar]);

  if (error) return <p className="admin-empty">{error}</p>;
  if (!datos) return null;

  const ordenadas = [...datos.queues].sort((a, b) => b.oldestMinutes - a.oldestMinutes);

  return (
    <section className="colas-tablero">
      <header>
        <div>
          <h3>Colas de trabajo</h3>
          <small>
            {datos.alerting === 0
              ? "Ninguna cola en alarma."
              : `${datos.alerting} cola(s) en alarma.`}
          </small>
        </div>
        {/* Si una cola de trabajo programado está en alarma, el diagnóstico no es
            «hay mucho trabajo» sino «nadie lo está procesando». Se dice por su
            nombre en vez de dejar que alguien lo deduzca de doce filas. */}
        {datos.stalledJobs > 0 && (
          <p className="colas-cron">
            {datos.stalledJobs} cola(s) automáticas atrasadas. Revisá que el planificador esté
            ejecutando <code>job:operational-queues</code>.
          </p>
        )}
      </header>

      <ul className="colas-lista">
        {ordenadas.map((cola) => (
          <li key={cola.key} className={`cola-fila cola-${cola.severity}`}>
            <div>
              <strong>{cola.label}</strong>
              <small>{ETIQUETA_DUENO[cola.owner]}</small>
            </div>
            <span className="cola-cantidad">{cola.pending}</span>
            {/* La antigüedad se muestra vacía cuando no hay nada esperando, en
                lugar de «0 min»: un cero ahí se lee como «recién llegó algo». */}
            <span className="cola-antiguedad">
              {cola.pending === 0 ? "—" : antiguedad(cola.oldestMinutes)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
