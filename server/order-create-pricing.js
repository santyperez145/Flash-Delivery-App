// Precio autoritativo al alta del pedido (ARC-001).
//
// Snapshots de ítems, promoción, suscripción y contraste con la cotización
// firmada. Separado del orquestador — misma frontera pricing≠checkout que
// usan Uber Eats / DoorDash antes de persistir el job.
import { getActiveSubscription, splitOrderDiscounts } from "./subscription-repository.js";
import { CHECKOUT_TIP_MIN_CENTS, checkoutTipMaxCents } from "./tip-repository.js";
import { resolveModifierSelection } from "./order-selection.js";

export async function buildCheckoutLineSnapshots(client, { items, merchantId, branchId }) {
  const snapshots = [];
  for (const entry of items) {
    const item = await client.query(
      `SELECT c.*
         FROM catalog_items c
         JOIN catalog_branch_inventory i ON i.catalog_item_id = c.id AND i.branch_id = $3
         WHERE c.public_id = $1 AND c.merchant_id = $2
           AND c.available AND i.available AND COALESCE(i.stock_quantity, 1) > 0
         FOR SHARE OF c, i`,
      [entry.menuItemId, merchantId, branchId],
    );
    if (!item.rows[0]) throw Object.assign(new Error("Producto no disponible"), { status: 409 });
    const selection = await resolveModifierSelection(client, {
      catalogItemId: item.rows[0].id,
      selectedIds: entry.extras || [],
    });
    snapshots.push({
      entry,
      item: item.rows[0],
      selection,
      unitPriceCents: Number(item.rows[0].unit_price_cents) + selection.priceCents,
    });
  }
  return snapshots;
}

export async function resolveCheckoutTotals(
  client,
  {
    snapshots,
    lockedQuote,
    serviceFee,
    promotionCode,
    paymentMethod,
    customerId,
    customerPublicId,
    tipCents,
  },
) {
  const subtotalCents = snapshots.reduce(
    (sum, { entry, unitPriceCents }) => sum + unitPriceCents * entry.quantity,
    0,
  );
  const deliveryFeeCents = Math.round(Number(lockedQuote.deliveryFee) * 100);
  const serviceFeeCents = Math.round(serviceFee * 100);
  let promotion = null,
    discountCents = 0,
    subscriptionDiscountCents = 0;
  if (promotionCode) {
    promotion = (
      await client.query(
        `SELECT * FROM promotions WHERE code=$1 AND active AND now() BETWEEN starts_at AND ends_at FOR UPDATE`,
        [promotionCode],
      )
    ).rows[0];
    if (!promotion) throw Object.assign(new Error("Promoción inválida o vencida"), { status: 409 });
    if (promotion.rules?.service && promotion.rules.service !== "food")
      throw Object.assign(new Error("La promoción no aplica a comida"), { status: 409 });
    if (subtotalCents < Number(promotion.min_subtotal_cents))
      throw Object.assign(new Error("No alcanzas el subtotal mínimo de la promoción"), {
        status: 409,
      });
    if (
      promotion.rules?.paymentMethod === "flash_wallet" &&
      !String(paymentMethod).toLowerCase().includes("wallet")
    )
      throw Object.assign(new Error("La promoción requiere Flash Wallet"), { status: 409 });
    const usage = (
      await client.query(
        `SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$2)::int user_total FROM promotion_redemptions WHERE promotion_id=$1`,
        [promotion.id, customerId],
      )
    ).rows[0];
    if (promotion.usage_limit !== null && usage.total >= promotion.usage_limit)
      throw Object.assign(new Error("La promoción agotó su cupo"), { status: 409 });
    if (usage.user_total >= promotion.per_user_limit)
      throw Object.assign(new Error("Ya utilizaste esta promoción"), { status: 409 });
    if (promotion.kind === "percentage")
      discountCents = Math.round((subtotalCents * promotion.value) / 100);
    else if (promotion.kind === "fixed") discountCents = promotion.value;
    else if (promotion.kind === "free_delivery") discountCents = deliveryFeeCents;
    else if (promotion.kind === "wallet_credit") discountCents = 0;
    if (promotion.max_discount_cents !== null)
      discountCents = Math.min(discountCents, Number(promotion.max_discount_cents));
    discountCents = Math.min(discountCents, subtotalCents + deliveryFeeCents);
  }
  // Se relee dentro de la transaccion, no se toma del token: el token dice lo
  // que se prometio y esto dice lo que corresponde ahora. Si alguien firmara
  // un token con un beneficio que no le toca, la comparacion de abajo lo
  // rechaza en vez de aplicarlo.
  const subscription = await getActiveSubscription(customerPublicId, client);
  ({ discountCents, subscriptionDiscountCents } = splitOrderDiscounts({
    subscription,
    subtotalCents,
    deliveryFeeCents,
    promotionKind: promotion?.kind || null,
    promotionDiscountCents: discountCents,
  }));
  const totalCents =
    subtotalCents + deliveryFeeCents + serviceFeeCents - discountCents - subscriptionDiscountCents;
  if (
    lockedQuote.total !== undefined &&
    (Math.round(Number(lockedQuote.subtotal) * 100) !== subtotalCents ||
      Math.round(Number(lockedQuote.discount || 0) * 100) !== discountCents ||
      // Se compara aparte y no solo por el total. Dos errores que se cancelan
      // —una promocion que crece justo lo que el beneficio deja de aplicar—
      // darian el mismo total y pasarian el control cobrando mal el desglose.
      Math.round(Number(lockedQuote.subscriptionDiscount || 0) * 100) !==
        subscriptionDiscountCents ||
      Math.round(Number(lockedQuote.total) * 100) !== totalCents ||
      String(lockedQuote.paymentMethod) !== String(paymentMethod) ||
      String(lockedQuote.promotionCode || "") !== String(promotion?.code || ""))
  )
    throw Object.assign(new Error("El precio final cambió; revisa y acepta una nueva cotización"), {
      status: 409,
    });
  // La propina no viaja en la cotizacion firmada a proposito: cambiarla no
  // deberia obligar a recotizar el pedido entero, y no hay nada que proteger
  // firmandola — es plata del cliente hacia el repartidor, no un precio que el
  // cliente pueda bajar. Lo que si se valida es que este dentro de los topes,
  // que es lo que atrapa un error de tipeo de tres ceros de mas.
  if (tipCents) {
    const topeDePropina = checkoutTipMaxCents(totalCents);
    if (tipCents < CHECKOUT_TIP_MIN_CENTS)
      throw Object.assign(
        new Error(`La propina mínima es $${(CHECKOUT_TIP_MIN_CENTS / 100).toFixed(0)}`),
        { status: 409 },
      );
    if (tipCents > topeDePropina)
      throw Object.assign(
        new Error(`La propina máxima para este pedido es $${(topeDePropina / 100).toFixed(0)}`),
        { status: 409 },
      );
  }
  // **Un solo cargo, no dos.** La propina se cobra junto con el pedido; lo que
  // se reparte sigue siendo `totalCents`, porque la propina no es del comercio
  // ni de la plataforma.
  return {
    snapshots,
    promotion,
    subscription,
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    discountCents,
    subscriptionDiscountCents,
    totalCents,
    chargedCents: totalCents + tipCents,
  };
}
