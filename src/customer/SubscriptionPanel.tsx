// Suscripción de Flash, del lado del cliente (ticket GTM-001).
//
// Uber One, DashPass y PedidosYa Plus tienen todos la misma forma: se ve el
// precio antes de decidir, se ve qué devuelve, y la baja está a un toque. La
// baja escondida es lo que hace que la gente cancele la tarjeta en vez del plan.
//
// **Los beneficios se muestran como los devuelve el servidor.** Escribir «envío
// gratis desde $15.000» en el JSX duplicaría el umbral que aplica la tarifa, y
// el día que el plan cambie la pantalla prometería una cosa y el checkout
// cobraría otra.
import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { money } from "../format";
import type { Subscription, SubscriptionPlan } from "../types";

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" });

/**
 * Lista de beneficios de un plan, escrita desde sus valores.
 *
 * Cada beneficio se omite cuando el plan no lo da, en vez de mostrarse en cero:
 * «0% de descuento en viajes» es peor que no decir nada.
 */
export function Beneficios({ plan }: { plan: SubscriptionPlan | Subscription }) {
  const lineas = [
    plan.freeDeliveryMinSubtotalCents !== null &&
      `Envío sin cargo en pedidos desde ${money.format(plan.freeDeliveryMinSubtotalCents / 100)}`,
    plan.rideDiscountBps > 0 && `${plan.rideDiscountBps / 100}% menos en viajes`,
    plan.dispatchPriorityBoost > 0 && "Prioridad al asignar conductor",
  ].filter(Boolean) as string[];
  return (
    <ul className="suscripcion-beneficios">
      {lineas.map((linea) => (
        <li key={linea}>{linea}</li>
      ))}
    </ul>
  );
}

/**
 * Estado de suscripción, compartido por el panel y el anuncio de la portada.
 *
 * Un solo lugar que sabe leerlo. La alternativa —que cada componente hiciera su
 * par de llamadas— dejaría a la portada ofreciendo suscribirse justo después de
 * que el panel confirmara el alta, porque cada uno tendría su propia idea de
 * cuándo mirar.
 */
export function useSubscription() {
  const [planes, setPlanes] = useState<SubscriptionPlan[]>([]);
  const [suscripcion, setSuscripcion] = useState<Subscription | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [catalogo, propia] = await Promise.all([
        api.getSubscriptionPlans(),
        api.getSubscription(),
      ]);
      setPlanes(catalogo.plans);
      setSuscripcion(propia.subscription);
      setError("");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo cargar la suscripción");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return { planes, suscripcion, cargando, error, setError, cargar };
}

export function SubscriptionPanel() {
  const { planes, suscripcion, cargando, error, setError, cargar } = useSubscription();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");

  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    setOcupado(true);
    setError("");
    setAviso("");
    try {
      await accion();
      await cargar();
      setAviso(exito);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo completar la operación");
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return null;
  // Sin planes cargados no hay nada que ofrecer. Mostrar una tarjeta vacía
  // sugeriría que algo se rompió cuando lo que pasa es que no hay oferta.
  if (!suscripcion && planes.length === 0) return null;

  return (
    <section className="suscripcion-card">
      <header>
        <h3>Flash Más</h3>
        {suscripcion && (
          <span className={suscripcion.renews ? "suscripcion-activa" : "suscripcion-vence"}>
            {suscripcion.renews ? "Activa" : `Hasta el ${fecha(suscripcion.currentPeriodEnd)}`}
          </span>
        )}
      </header>

      {suscripcion ? (
        <>
          <Beneficios plan={suscripcion} />
          <p className="suscripcion-periodo">
            {suscripcion.renews
              ? `Se renueva el ${fecha(suscripcion.currentPeriodEnd)} por ${money.format(
                  suscripcion.priceCents / 100,
                )}`
              : "Cancelada. Los beneficios siguen hasta que termine el período que ya pagaste."}
          </p>
          {/* El cobro recurrente depende de PAY-001. Se dice acá en vez de dejar
              que la persona lo descubra cuando el cargo aparezca —o cuando no
              aparezca— porque un cobro sorpresa es la peor forma de enterarse. */}
          {!suscripcion.billed && (
            <p className="suscripcion-aviso">
              Período bonificado: todavía no hay cobro configurado.
            </p>
          )}
          {suscripcion.renews ? (
            <button
              type="button"
              className="suscripcion-baja"
              disabled={ocupado}
              onClick={() =>
                ejecutar(
                  () => api.cancelSubscription(),
                  "Tu suscripción no se renovará al terminar el período",
                )
              }
            >
              Cancelar renovación
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              disabled={ocupado}
              onClick={() =>
                ejecutar(
                  () => api.subscribe(suscripcion.planKey),
                  "Tu suscripción vuelve a renovar",
                )
              }
            >
              Reactivar
            </button>
          )}
        </>
      ) : (
        planes.map((plan) => (
          <article key={plan.id} className="suscripcion-plan">
            <p className="suscripcion-precio">
              {money.format(plan.priceCents / 100)}
              <small> cada {plan.billingPeriodDays} días</small>
            </p>
            <Beneficios plan={plan} />
            <button
              type="button"
              className="primary-button"
              disabled={ocupado}
              onClick={() =>
                ejecutar(() => api.subscribe(plan.planKey), `${plan.planName} activado`)
              }
            >
              Suscribirme
            </button>
          </article>
        ))
      )}

      {aviso && <p className="suscripcion-ok">{aviso}</p>}
      {error && <p className="suscripcion-error">{error}</p>}
    </section>
  );
}
