// Cola de devoluciones de envío (ARC-001, cableado de la API).
//
// `GET /api/shipment-returns` ya lo llamaba el móvil: un cliente podía pedir la
// devolución de un envío y verla listada. `PATCH /api/shipment-returns/:id`
// estaba construido, auditado, y **ninguna pantalla lo llamaba**.
//
// Es decir: la cola se miraba y no se tocaba. Un cliente pedía una devolución y
// no había forma de aprobarla — ni de rechazarla, que es peor, porque queda
// abierta para siempre esperando a alguien que no tiene botón.
//
// El panel espeja al de siniestros, que resuelve el mismo tipo de excepción con
// la misma forma: leer, decidir, dejar la nota.
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { ShipmentReturn } from "../types";
import { AdminSectionHeader } from "../ui/panels";

// Los estados a los que se puede llevar una devolución, en el orden en que
// ocurren. `requested` no está: es de donde se viene, no a donde se va.
const TRANSICIONES: Array<{ estado: ShipmentReturn["status"]; etiqueta: string }> = [
  { estado: "approved", etiqueta: "Aprobar" },
  { estado: "rejected", etiqueta: "Rechazar" },
  { estado: "in_transit", etiqueta: "En tránsito" },
  { estado: "completed", etiqueta: "Completar" },
];

const ETIQUETA_ESTADO: Record<ShipmentReturn["status"], string> = {
  requested: "Solicitada",
  approved: "Aprobada",
  rejected: "Rechazada",
  in_transit: "En tránsito",
  completed: "Completada",
};

const ABIERTAS: ShipmentReturn["status"][] = ["requested", "approved", "in_transit"];

export function ShipmentReturnsPanel({
  runAction,
  busy,
}: {
  runAction: (accion: () => Promise<unknown>, exito: string) => void;
  busy: boolean;
}) {
  const [devoluciones, setDevoluciones] = useState<ShipmentReturn[]>([]);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      setDevoluciones((await api.getShipmentReturns()).returns);
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudieron cargar las devoluciones");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const resolver = (devolucion: ShipmentReturn, estado: ShipmentReturn["status"]) =>
    runAction(async () => {
      const resultado = await api.updateShipmentReturn(devolucion.id, {
        status: estado,
        // El servidor exige al menos tres caracteres. Si quien resuelve no
        // escribió nada, se deja constancia de la transición en lugar de mandar
        // una nota vacía que el esquema rechazaría.
        resolutionNote: notas[devolucion.id]?.trim() || `Transición operativa a ${estado}`,
      });
      await cargar();
      return resultado;
    }, `Devolución ${ETIQUETA_ESTADO[estado].toLowerCase()}`);

  const abiertas = devoluciones.filter((devolucion) => ABIERTAS.includes(devolucion.status));

  return (
    <section className="admin-card">
      <AdminSectionHeader title="Devoluciones de envío" action={`${abiertas.length} abiertas`} />
      {error && <p className="admin-empty">{error}</p>}
      {devoluciones.length === 0 ? (
        <p className="admin-empty">No hay devoluciones registradas.</p>
      ) : (
        <ul className="devoluciones">
          {devoluciones.map((devolucion) => (
            <li key={devolucion.id}>
              <div className="devolucion-encabezado">
                <strong>{devolucion.shipmentId}</strong>
                <span className={`devolucion-estado estado-${devolucion.status}`}>
                  {ETIQUETA_ESTADO[devolucion.status]}
                </span>
              </div>
              <p>{devolucion.reason}</p>
              {devolucion.resolutionNote && (
                <small className="devolucion-nota">{devolucion.resolutionNote}</small>
              )}
              {ABIERTAS.includes(devolucion.status) && (
                <>
                  <input
                    type="text"
                    placeholder="Nota de resolución"
                    value={notas[devolucion.id] ?? ""}
                    onChange={(evento) =>
                      setNotas((previo) => ({ ...previo, [devolucion.id]: evento.target.value }))
                    }
                  />
                  <div className="devolucion-acciones">
                    {TRANSICIONES.filter(({ estado }) => estado !== devolucion.status).map(
                      ({ estado, etiqueta }) => (
                        <button
                          key={estado}
                          type="button"
                          disabled={busy}
                          onClick={() => resolver(devolucion, estado)}
                        >
                          {etiqueta}
                        </button>
                      ),
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
