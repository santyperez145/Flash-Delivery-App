// Suscripción de Flash y sus beneficios (ticket GTM-001).
//
// El hueco comercial más grande medido contra la competencia. Uber One,
// DashPass y PedidosYa Plus cambian la frecuencia de compra y el costo de
// adquisición de todo lo demás, y Flash no tenía tabla, ruta ni concepto.
//
// **Los beneficios viven en el plan, no en el código.** Cambiar el umbral de
// envío sin cargo o el porcentaje de descuento es una fila, no un despliegue:
// una oferta comercial se ajusta con la demanda, y meterla en constantes obliga
// a un release cada vez que marketing quiere probar algo.
//
// **Esta capa no cobra.** El cobro recurrente depende de PAY-001, que espera
// credenciales del proveedor. `billed` distingue un período cobrado de uno
// otorgado mientras eso no exista, para que el día que el cobro llegue se sepa
// quién pagó y quién entró antes.
import crypto from "node:crypto";

import { postgresPool } from "./postgres.js";

const publicId = () => `SUB-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

const mapearBeneficios = (fila) => ({
  planKey: fila.key,
  planName: fila.name,
  // `null` significa que el plan no da envío sin cargo. No es lo mismo que un
  // umbral de cero, que lo daría siempre: distinguirlos evita regalar el envío
  // por un plan mal cargado.
  freeDeliveryMinSubtotalCents:
    fila.free_delivery_min_subtotal_cents === null
      ? null
      : Number(fila.free_delivery_min_subtotal_cents),
  rideDiscountBps: Number(fila.ride_discount_bps),
  dispatchPriorityBoost: Number(fila.dispatch_priority_boost),
});

/**
 * Suscripción vigente de una persona, con los beneficios de su plan.
 *
 * Devuelve `null` cuando no hay ninguna activa, y **también** cuando el período
 * venció sin renovarse: una fila `active` con `current_period_end` en el pasado
 * no es una suscripción vigente, y tratarla como tal regalaría beneficios hasta
 * que alguien corriera la expiración.
 *
 * `ejecutor` permite leerla dentro de una transacción en curso. La creación del
 * pedido tiene que ver exactamente la misma suscripción que vio la cotización;
 * pedir una conexión aparte la haría leer fuera del snapshot de la transacción,
 * y una cancelación entre ambos momentos aparecería como un cambio de precio.
 */
export async function getActiveSubscription(userPublicId, ejecutor = postgresPool) {
  if (!ejecutor || !userPublicId) return null;
  const fila = (
    await ejecutor.query(
      `SELECT s.public_id, s.status, s.current_period_start, s.current_period_end, s.billed,
              s.cancelled_at,
              p.key, p.name, p.price_cents, p.billing_period_days,
              p.free_delivery_min_subtotal_cents, p.ride_discount_bps, p.dispatch_priority_boost
       FROM user_subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN subscription_plans p ON p.id = s.plan_id
       WHERE u.public_id = $1 AND s.status = 'active' AND s.current_period_end > now()`,
      [userPublicId],
    )
  ).rows[0];
  if (!fila) return null;
  return {
    id: fila.public_id,
    status: fila.status,
    currentPeriodStart: new Date(fila.current_period_start).toISOString(),
    currentPeriodEnd: new Date(fila.current_period_end).toISOString(),
    // Quien canceló sigue teniendo beneficios hasta que el período termine. La
    // pantalla necesita poder decir «vence el X» en lugar de «activa», o la
    // persona descubre el corte el día que deja de funcionar.
    renews: fila.cancelled_at === null,
    billed: fila.billed,
    priceCents: Number(fila.price_cents),
    ...mapearBeneficios(fila),
  };
}

/** Planes ofrecidos, para que la pantalla no invente precios ni beneficios. */
export async function getSubscriptionPlans() {
  if (!postgresPool) return [];
  return (
    await postgresPool.query(
      `SELECT public_id, key, name, description, price_cents, currency, billing_period_days,
              free_delivery_min_subtotal_cents, ride_discount_bps, dispatch_priority_boost
       FROM subscription_plans WHERE active ORDER BY price_cents`,
    )
  ).rows.map((fila) => ({
    id: fila.public_id,
    description: fila.description,
    priceCents: Number(fila.price_cents),
    currency: fila.currency,
    billingPeriodDays: Number(fila.billing_period_days),
    ...mapearBeneficios(fila),
  }));
}

/**
 * Da de alta —o reactiva— la suscripción de una persona.
 *
 * Tres caminos, y ninguno cobra dos veces el mismo tramo:
 *
 * 1. Hay un período vigente que estaba marcado para no renovar: se reactiva
 *    limpiando `cancelled_at`. Cobrar un alta nueva encima de días que la
 *    persona ya pagó sería cobrar dos veces por lo mismo.
 * 2. Hay un período vigente sin cancelar: 409, ya está suscripta.
 * 3. No hay ninguno vigente: alta nueva.
 *
 * El paso previo vence las filas cuyo período terminó. Sin eso, el índice
 * parcial de la migración 125 bloquearía para siempre a quien se suscribió una
 * vez, porque su fila seguiría siendo la única `active` que admite la tabla.
 */
export async function subscribe({ userPublicId, planKey }) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const usuario = (
      await client.query("SELECT id FROM users WHERE public_id=$1 AND status='active'", [
        userPublicId,
      ])
    ).rows[0];
    if (!usuario) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const plan = (
      await client.query(
        "SELECT id, billing_period_days FROM subscription_plans WHERE key=$1 AND active",
        [planKey],
      )
    ).rows[0];
    if (!plan) throw Object.assign(new Error("Plan no disponible"), { status: 404 });

    // Vencer lo que ya terminó. `FOR UPDATE` en el mismo paso serializa dos
    // altas simultáneas: sin él, ambas verían la fila vieja y una chocaría
    // contra el índice con un error de restricción en vez de un 409.
    await client.query(
      `UPDATE user_subscriptions SET status='expired', updated_at=now()
       WHERE user_id=$1 AND status='active' AND current_period_end <= now()`,
      [usuario.id],
    );
    const vigente = (
      await client.query(
        `SELECT id, cancelled_at FROM user_subscriptions
         WHERE user_id=$1 AND status='active' FOR UPDATE`,
        [usuario.id],
      )
    ).rows[0];

    if (vigente) {
      if (!vigente.cancelled_at) {
        throw Object.assign(new Error("Ya tenés una suscripción activa"), { status: 409 });
      }
      await client.query(
        "UPDATE user_subscriptions SET cancelled_at=NULL, updated_at=now() WHERE id=$1",
        [vigente.id],
      );
    } else {
      await client.query(
        `INSERT INTO user_subscriptions(public_id, user_id, plan_id, current_period_end)
         VALUES($1, $2, $3, now() + ($4 * interval '1 day'))`,
        [publicId(), usuario.id, plan.id, plan.billing_period_days],
      );
    }
    const suscripcion = await getActiveSubscription(userPublicId, client);
    await client.query("COMMIT");
    return suscripcion;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Marca la suscripción para que no renueve.
 *
 * **El período pagado se respeta**: `current_period_end` no se mueve y el estado
 * sigue siendo `active`, así que los beneficios corren hasta que el período
 * termine. Cortarlos el día de la cancelación sería cobrar un mes y entregar
 * menos, y es la clase de detalle por el que alguien no vuelve a suscribirse.
 */
export async function cancelSubscription(userPublicId) {
  const fila = (
    await postgresPool.query(
      `UPDATE user_subscriptions s
       SET cancelled_at = now(), updated_at = now()
       FROM users u
       WHERE u.id = s.user_id AND u.public_id = $1
         AND s.status = 'active' AND s.current_period_end > now() AND s.cancelled_at IS NULL
       RETURNING s.public_id, s.current_period_end`,
      [userPublicId],
    )
  ).rows[0];
  if (!fila) throw Object.assign(new Error("No tenés una suscripción activa"), { status: 409 });
  return {
    id: fila.public_id,
    cancelled: true,
    benefitsUntil: new Date(fila.current_period_end).toISOString(),
  };
}

/**
 * Reparte el alivio de precio entre la promoción y la suscripción.
 *
 * **Una sola copia de esta regla, a propósito.** La cotización y la creación del
 * pedido la calculan por separado y el control de precio compara los dos
 * resultados: si divergieran, cada compra de un suscriptor terminaría en «el
 * precio cambió, aceptá una cotización nueva» sin que nada haya cambiado.
 *
 * Devuelve los dos montos por separado y no uno solo sumado, porque **no
 * significan lo mismo**: la comisión del comercio se calcula sobre el subtotal
 * menos la promoción, y el envío que regala Flash por la suscripción no puede
 * bajarle la comisión a un comercio que no financió el beneficio.
 */
export function splitOrderDiscounts({
  subscription,
  subtotalCents,
  deliveryFeeCents,
  promotionKind = null,
  promotionDiscountCents = 0,
}) {
  const umbral = subscription?.freeDeliveryMinSubtotalCents ?? null;
  const subscriptionDiscountCents =
    // Sin suscripción, con un plan que no da envío sin cargo, o por debajo del
    // umbral, no hay beneficio.
    umbral === null || subtotalCents < umbral
      ? 0
      : // **No se acumula con un cupón que ya regala el envío.** Sin este corte
        // el envío se descontaría dos veces y el pedido devolvería plata que
        // nadie cobró.
        promotionKind === "free_delivery"
        ? 0
        : deliveryFeeCents;
  return {
    subscriptionDiscountCents,
    // El alivio total no puede superar lo que se cobra. La promoción cede
    // primero porque el beneficio de la suscripción ya está pago.
    discountCents: Math.min(
      promotionDiscountCents,
      subtotalCents + deliveryFeeCents - subscriptionDiscountCents,
    ),
  };
}
