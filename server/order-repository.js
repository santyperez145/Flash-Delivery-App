// El ciclo del pedido: cotizar, armar el carrito, crear, cobrar y avanzar
// (ticket ARC-001).
//
// Segunda parte de `commerce-repository.js`. Acá el dueño del dato es el
// cliente y su transacción: cotización con plan tarifario versionado, carrito,
// creación con validación de agregados, pago de marketplace con Mercado Pago,
// asignación de conductor y máquina de estados.
//
// Importa `mapCatalogItem` de `catalog-repository.js` y ésa es la única
// dirección permitida: un pedido está hecho de ítems de catálogo. La dependencia
// inversa no existe y no debe aparecer.
//
// `apiStatus`/`databaseStatus` traducen entre los estados que guarda la base
// (`driver_assigned`, `completed`) y los que expone la API (`courier_assigned`,
// `delivered`). Son un par: cada entrada de una es la inversa de la otra, y por
// eso viven juntas al principio del archivo.
import crypto from "node:crypto";
import {
  normalizarPreferencias,
  paraElComercio,
  preferenciasDesdeMetadata,
} from "./delivery-preferences.js";
import { postgresPool } from "./postgres.js";
import { getActiveSubscription, splitOrderDiscounts } from "./subscription-repository.js";
import { CHECKOUT_TIP_MIN_CENTS, checkoutTipMaxCents, holdCheckoutTip } from "./tip-repository.js";
import { getPostgresPricingPlan } from "./configuration-repository.js";
import { enqueueNotificationForInternalUser } from "./notification-repository.js";
import {
  FAMILY_LABEL,
  getFamilyPaymentOption,
  notifyFamilyCharge,
  resolveFamilyPayer,
} from "./family-profile-repository.js";

/**
 * Si la persona puede pagar en efectivo en esta sucursal (PAG-01). Lo decide el
 * comercio, y como en PedidosYa y Rappi hay un control antifraude: un pedido en
 * efectivo que nadie recibe deja comida hecha y un viaje sin cobrar.
 *
 * - teléfono verificado: el repartidor tiene que poder llamar;
 * - menos de dos pedidos en efectivo cancelados **después de empezar a prepararse**
 *   en 90 días, quien sea que cancele y con el motivo que sea (contar sólo un motivo
 *   se esquivaba eligiendo otro);
 * - un solo pedido en efectivo en curso a la vez;
 * - el comercio no debe más del tope en comisiones de retiros en efectivo.
 */
async function controlarEfectivo(client, { userId, cashEnabled, phoneVerifiedAt, merchantId }) {
  if (!cashEnabled)
    throw Object.assign(new Error("Este comercio no acepta efectivo"), { status: 409 });
  if (!phoneVerifiedAt)
    throw Object.assign(new Error("Para pagar en efectivo, verificá tu teléfono desde tu cuenta"), {
      status: 409,
    });
  const historial = (
    await client.query(
      `SELECT
         count(*) FILTER (WHERE j.status='cancelled' AND c.created_at > now() - interval '90 days'
           AND EXISTS (SELECT 1 FROM job_events e WHERE e.job_id=j.id
             AND e.status IN ('preparing','ready_for_pickup','driver_assigned','picked_up','delivering')))::int rechazos,
         count(*) FILTER (WHERE j.status NOT IN ('completed','cancelled'))::int en_curso
       FROM jobs j LEFT JOIN job_cancellations c ON c.job_id=j.id
       WHERE j.customer_id=$1 AND j.payment_method_label=$2 AND j.metadata->>'subtype'='food_order'`,
      [userId, CASH_LABEL],
    )
  ).rows[0];
  if (Number(historial.rechazos) >= 2)
    throw Object.assign(
      new Error("Tenés pedidos en efectivo sin recibir: pagá con Wallet o tarjeta"),
      { status: 409 },
    );
  if (Number(historial.en_curso) >= 1)
    throw Object.assign(
      new Error("Ya tenés un pedido en efectivo en curso: pagá este con Wallet o tarjeta"),
      { status: 409 },
    );
  const deudaComercio = Number(
    (
      await client.query(
        `SELECT COALESCE(sum(CASE WHEN e.direction='credit' THEN e.amount_cents ELSE -e.amount_cents END),0)::bigint b
         FROM ledger_accounts a JOIN ledger_entries e ON e.account_id=a.id
         WHERE a.owner_type='merchant' AND a.owner_id=$1 AND a.account_type='payable'`,
        [merchantId],
      )
    ).rows[0].b,
  );
  if (deudaComercio < -config.cashMerchantDebtLimitCents)
    throw Object.assign(new Error("Este comercio no puede recibir efectivo por ahora"), {
      status: 409,
    });
}

/**
 * Un pedido en efectivo se puede cobrar: hay algo que cobrar, y lo que va a deber quien
 * reparte (todo menos su envío) entra en el tope de un repartidor sin deuda. Si no,
 * ningún repartidor podría tomarlo y el comercio cocinaría un pedido que nadie lleva.
 */
function controlarMontoEfectivo({ totalCents, deliveryFeeCents, esRetiro }) {
  if (totalCents <= 0)
    throw Object.assign(new Error("No hay nada que cobrar en efectivo"), { status: 409 });
  if (!esRetiro && totalCents - deliveryFeeCents > config.cashDriverDebtLimitCents)
    throw Object.assign(new Error("Para pedidos de este monto, pagá con Wallet o tarjeta"), {
      status: 409,
    });
}

/** El efectivo de un pedido para quien lo mira: cuánto cobrar, con cuánto paga y el vuelto. */
const vistaEfectivo = (cashPayment, totalCents) =>
  cashPayment
    ? {
        toCollect: pesos(totalCents),
        tendered: cashPayment.tenderedCents == null ? null : pesos(cashPayment.tenderedCents),
        change: pesos(cashPayment.changeCents || 0),
        collector: cashPayment.collector === "merchant" ? "merchant" : "courier",
      }
    : null;

const formatoPesos = (cents) => `$${pesos(cents).toLocaleString("es-AR")}`;

// Se paga desde una Flash Wallet: la propia, o la de quien organiza el perfil
// familiar (PAG-05). Las promociones «con Flash Wallet» aplican a las dos.
const pagaConWallet = (label) =>
  label === FAMILY_LABEL || String(label).toLowerCase().includes("wallet");
import { acceptDispatchOffer, createDispatchOffers } from "./dispatch-repository.js";
import {
  recordMarketplaceCapture,
  settleCapturedFoodOrder,
} from "./merchant-finance-repository.js";
import { decryptPaymentOAuthToken } from "./secret-envelope.js";
import {
  createMercadoPagoPayment,
  mercadoPagoFulfillmentDecision,
} from "./payment-marketplace-provider.js";
import { requireOrderDeliveryCodeIfNeeded } from "./order-delivery-code-repository.js";
import { pesos } from "./money.js";
import { CASH_LABEL } from "./wallet-repository.js";
import { mapCatalogItem } from "./catalog-repository.js";
import { config } from "./config.js";

const marketplacePaymentKey = (value) =>
  `mp-${crypto.createHash("sha256").update(String(value)).digest("hex")}`;

async function resolveModifierSelection(client, { catalogItemId, selectedIds = [] }) {
  const unique = [...new Set(selectedIds)];
  if (unique.length !== selectedIds.length)
    throw Object.assign(new Error("No puedes repetir un agregado"), { status: 409 });
  const groups = (
    await client.query(
      `SELECT g.id,g.public_id,g.name,g.minimum_selections,g.maximum_selections,COALESCE(jsonb_agg(jsonb_build_object('id',m.public_id,'name',m.name,'priceCents',m.price_cents,'available',m.available) ORDER BY m.sort_order,m.created_at) FILTER(WHERE m.id IS NOT NULL),'[]') modifiers FROM catalog_modifier_groups g LEFT JOIN catalog_modifiers m ON m.group_id=g.id WHERE g.catalog_item_id=$1 AND g.active GROUP BY g.id ORDER BY g.sort_order,g.created_at`,
      [catalogItemId],
    )
  ).rows;
  const known = new Map();
  for (const group of groups)
    for (const modifier of group.modifiers)
      known.set(modifier.id, { ...modifier, groupId: group.public_id, groupName: group.name });
  for (const id of unique) {
    const modifier = known.get(id);
    if (!modifier || !modifier.available)
      throw Object.assign(new Error("Un agregado no está disponible para este producto"), {
        status: 409,
      });
  }
  for (const group of groups) {
    const count = unique.filter((id) => known.get(id)?.groupId === group.public_id).length;
    if (count < group.minimum_selections || count > group.maximum_selections)
      throw Object.assign(
        new Error(
          `${group.name}: elegí entre ${group.minimum_selections} y ${group.maximum_selections}`,
        ),
        { status: 409 },
      );
  }
  const modifiers = unique.map((id) => known.get(id));
  return {
    priceCents: modifiers.reduce((sum, modifier) => sum + Number(modifier.priceCents), 0),
    modifiers: modifiers.map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      price: pesos(modifier.priceCents),
      groupId: modifier.groupId,
      groupName: modifier.groupName,
    })),
  };
}

const apiStatus = (status) =>
  ({ driver_assigned: "courier_assigned", completed: "delivered" })[status] || status;
const databaseStatus = (status) =>
  ({ courier_assigned: "driver_assigned", delivered: "completed" })[status] || status;

function rowsToOrders(rows) {
  const orders = new Map();
  for (const row of rows) {
    if (!orders.has(row.public_id)) {
      const metadata = row.job_metadata || {};
      orders.set(row.public_id, {
        id: row.public_id,
        customerId: row.customer_public_id,
        restaurantId: row.merchant_public_id,
        branchId: row.branch_public_id || null,
        courierId: row.driver_public_id || null,
        status: apiStatus(row.status),
        deliveryAddress: row.dropoff_address,
        pickupLocation: { lat: Number(row.pickup_lat), lng: Number(row.pickup_lng) },
        deliveryLocation: { lat: Number(row.dropoff_lat), lng: Number(row.dropoff_lng) },
        paymentMethod: row.payment_method_label || "",
        // PAG-01: en efectivo, cuánto cobrar, con cuánto paga y el vuelto, para quien
        // pidió, quien reparte y el comercio (que cobra en un retiro).
        cashPayment: vistaEfectivo(
          metadata.cashPayment,
          row.final_amount_cents ?? row.quoted_amount_cents,
        ),
        // P-03: si el pedido va en un lote, qué entrega es (1 o 2 de 2). Nada del otro
        // pedido: es de otra persona. Quien reparte ordena sus paradas con esto.
        batch: row.batch_position ? { position: Number(row.batch_position), stops: 2 } : null,
        items: [],
        subtotal: Number(metadata.subtotal || 0),
        deliveryFee: Number(metadata.deliveryFee || 0),
        serviceFee: Number(metadata.serviceFee || 0),
        discount: Number(metadata.discount || 0),
        subscriptionDiscount: Number(metadata.subscriptionDiscount || 0),
        tip: Number(metadata.tip || 0),
        promotionCode: metadata.promotionCode || null,
        // Se lee de la columna y no del metadata: reprogramar actualiza las dos,
        // pero la columna es la que manda para el despacho, y una pantalla que
        // mostrara el metadata podria prometer un horario que el despacho ignora.
        scheduledFor: row.scheduled_for ? new Date(row.scheduled_for).toISOString() : null,
        // El modo decide quién puede entregarlo, qué muestra la app y si hay
        // reparto. Sin publicarlo, la autorización no puede distinguir un pedido
        // retirado de uno sin conductor asignado todavía.
        fulfillment: metadata.fulfillment === "pickup" ? "pickup" : "delivery",
        // Completas: quién ve qué lo recorta cada camino de lectura con
        // `delivery-preferences.js` (comercio, repartidor sin asignar).
        deliveryPreferences: preferenciasDesdeMetadata(metadata),
        // P-02b: si ya tiene foto de entrega. Sólo el dato, no la imagen.
        deliveryPhoto: Boolean(row.has_delivery_photo),
        deliveryCode: row.delivery_code || null,
        total: pesos(row.final_amount_cents ?? row.quoted_amount_cents),
        etaMin: Number(metadata.etaMin ?? Math.round(row.estimated_duration_s / 60)),
        createdAt: new Date(row.created_at).toISOString(),
        version: row.version,
        timeline: row.timeline || [],
        cancellation: row.cancellation || null,
      });
    }
    if (row.item_id) {
      const metadata = row.item_metadata || {};
      orders.get(row.public_id).items.push({
        menuItemId: metadata.publicId || row.catalog_public_id || row.item_id,
        name: row.item_name,
        quantity: row.quantity,
        unitPrice: pesos(row.unit_price_cents),
        extras: metadata.extras || [],
        note: row.customer_note || "",
      });
    }
  }
  return [...orders.values()];
}

export async function getPostgresOrders({ publicIds = null } = {}) {
  const result = await postgresPool.query(
    `
    SELECT j.*, j.metadata AS job_metadata, customer.public_id AS customer_public_id,
      ST_Y(j.pickup_location::geometry) pickup_lat,ST_X(j.pickup_location::geometry) pickup_lng,
      ST_Y(j.dropoff_location::geometry) dropoff_lat,ST_X(j.dropoff_location::geometry) dropoff_lng,
      merchant.public_id AS merchant_public_id, branch.public_id AS branch_public_id,
      driver.public_id AS driver_public_id,
      EXISTS(SELECT 1 FROM shipment_delivery_evidence e WHERE e.job_id=j.id AND e.evidence_type='photo') AS has_delivery_photo,
      -- P-03: el lugar del pedido en un lote, mientras los dos siguen en curso.
      CASE
        WHEN EXISTS (SELECT 1 FROM jobs f WHERE f.batch_anchor_id=j.id AND f.status NOT IN ('completed','cancelled'))
          THEN 1
        WHEN j.batch_anchor_id IS NOT NULL AND EXISTS (SELECT 1 FROM jobs a WHERE a.id=j.batch_anchor_id
          AND a.status NOT IN ('completed','cancelled'))
          THEN 2
      END AS batch_position,
      -- SEG-03: si se entrega con código y si ya se verificó (nunca el código).
      (SELECT jsonb_build_object('required',true,'verified',dc.verified_at IS NOT NULL)
        FROM order_delivery_codes dc WHERE dc.job_id=j.id) AS delivery_code,
      ji.id AS item_id, ji.name AS item_name, ji.quantity, ji.unit_price_cents,
      ji.customer_note, ji.metadata AS item_metadata, catalog.public_id AS catalog_public_id,
      (SELECT jsonb_build_object('id',c.public_id,'reason',c.reason_code,'refundAmount',c.refund_amount_cents/100.0,'fee',c.cancellation_fee_cents/100.0,'createdAt',c.created_at) FROM job_cancellations c WHERE c.job_id=j.id) cancellation,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status',
        CASE WHEN je.status = 'driver_assigned' THEN 'courier_assigned'
             WHEN je.status = 'completed' THEN 'delivered' ELSE je.status::text END,
        'at', je.occurred_at) ORDER BY je.occurred_at) FROM job_events je WHERE je.job_id = j.id), '[]') AS timeline
    FROM jobs j
    JOIN users customer ON customer.id = j.customer_id
    JOIN merchants merchant ON merchant.id = j.merchant_id
    LEFT JOIN merchant_branches branch ON branch.id = j.branch_id
    LEFT JOIN drivers driver ON driver.id = j.driver_id
    LEFT JOIN job_items ji ON ji.job_id = j.id
    LEFT JOIN catalog_items catalog ON catalog.id = ji.catalog_item_id
    WHERE j.kind = 'delivery' AND j.metadata->>'subtype' = 'food_order'
      AND ($1::text[] IS NULL OR j.public_id=ANY($1::text[]))
    ORDER BY j.created_at DESC, ji.id
  `,
    [publicIds],
  );
  return rowsToOrders(result.rows);
}

export async function getPostgresMerchantActiveOrderPage({
  actorPublicId,
  merchantPublicId,
  admin = false,
  limit = 100,
}) {
  const selected = (
    await postgresPool.query(
      `SELECT m.id FROM merchants m JOIN users owner ON owner.id=m.owner_id WHERE m.status='active' AND m.public_id=$2 AND ($3::boolean OR owner.public_id=$1)`,
      [actorPublicId, merchantPublicId, admin],
    )
  ).rows[0];
  if (!selected)
    throw Object.assign(new Error("Comercio no encontrado o no autorizado"), { status: 404 });
  const page = await postgresPool.query(
    `SELECT j.public_id FROM jobs j WHERE j.merchant_id=$1 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order' AND j.status=ANY($2::job_status[]) ORDER BY CASE j.status WHEN 'accepted' THEN 0 WHEN 'preparing' THEN 1 WHEN 'ready_for_pickup' THEN 2 WHEN 'driver_assigned' THEN 3 WHEN 'picked_up' THEN 4 WHEN 'delivering' THEN 5 ELSE 6 END,j.merchant_ready_due_at NULLS LAST,j.created_at LIMIT $3`,
    [
      selected.id,
      ["accepted", "preparing", "ready_for_pickup", "driver_assigned", "picked_up", "delivering"],
      limit + 1,
    ],
  );
  const hasMore = page.rows.length > limit,
    publicIds = page.rows.slice(0, limit).map((row) => row.public_id),
    orders = await getPostgresOrders({ publicIds }),
    byId = new Map(orders.map((order) => [order.id, order]));
  return {
    generatedAt: new Date().toISOString(),
    source: "postgres-live-operations",
    // El comercio ve de las preferencias sólo los cubiertos: las indicaciones
    // de entrega son de la casa del cliente y para quien reparte.
    orders: publicIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(paraElComercio),
    hasMore,
  };
}

export async function getPostgresFoodDeliveryQuote({
  customerPublicId,
  merchantPublicId,
  deliveryAddressId,
  branchPublicId,
}) {
  const [plan, result] = await Promise.all([
    getPostgresPricingPlan("food"),
    postgresPool.query(
      `SELECT a.id address_id,a.formatted_address,a.geocoding_provider,a.provider_place_id,a.geocoded_at,ST_Y(a.location::geometry) lat,ST_X(a.location::geometry) lng,
    m.public_id merchant_id,b.public_id branch_id,ST_Distance(b.location,a.location) air_distance_m,COALESCE(z.delivery_multiplier,1) zone_multiplier,z.public_id zone_id
    FROM users u JOIN addresses a ON a.user_id=u.id JOIN merchants m ON m.public_id=$2 AND m.status='active'
    JOIN merchant_branches b ON b.merchant_id=m.id AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) AND (($4::text IS NULL AND b.is_primary) OR b.public_id=$4)
    LEFT JOIN LATERAL(SELECT public_id,delivery_multiplier FROM service_zones WHERE active AND ST_Covers(boundary::geometry,b.location::geometry) ORDER BY ST_Area(boundary) LIMIT 1) z ON true
    WHERE u.public_id=$1 AND u.status='active' AND a.id=$3 AND a.geocoded_at IS NOT NULL
      AND (NOT $5::boolean OR (a.geocoding_provider=$6 AND a.provider_place_id IS NOT NULL))`,
      [
        customerPublicId,
        merchantPublicId,
        deliveryAddressId,
        branchPublicId || null,
        config.requireCommercialGeocoding,
        config.maps.provider,
      ],
    ),
  ]);
  const row = result.rows[0];
  if (!row)
    throw Object.assign(
      new Error("La dirección o el comercio no están disponibles para este cliente"),
      { status: 404 },
    );
  const planConfig = plan.config;
  const distanceKm = (Number(row.air_distance_m) / 1000) * Number(planConfig.roadFactor);
  if (distanceKm > Number(planConfig.maximumDistanceKm))
    throw Object.assign(new Error("La dirección está fuera del radio máximo de entrega"), {
      status: 409,
    });
  const raw = Math.max(
    Number(planConfig.minimumDeliveryFee),
    Number(planConfig.baseDeliveryFee) + distanceKm * Number(planConfig.distancePerKm),
  );
  const deliveryFee = Math.round(
    Math.min(Number(planConfig.maximumDeliveryFee), raw * Number(row.zone_multiplier)),
  );
  return {
    customerId: customerPublicId,
    restaurantId: merchantPublicId,
    branchId: row.branch_id,
    deliveryAddressId: String(row.address_id),
    deliveryAddress: row.formatted_address,
    addressValidation: {
      provider: row.geocoding_provider,
      providerPlaceId: row.provider_place_id || null,
      validatedAt: row.geocoded_at.toISOString(),
    },
    destinationCoords: { lat: Number(row.lat), lng: Number(row.lng) },
    distanceKm: Number(distanceKm.toFixed(2)),
    deliveryFee,
    serviceFee: Number(planConfig.serviceFee),
    roadFactor: Number(planConfig.roadFactor),
    zoneId: row.zone_id || null,
    zoneMultiplier: Number(row.zone_multiplier),
    pricingVersion: plan.version,
    currency: plan.currency,
  };
}

/**
 * Cotización de un pedido para retirar en el local (GTM-002).
 *
 * Es una función aparte y no un parámetro opcional de la cotización de entrega
 * porque **el trabajo de esa función es el precio por distancia**: toma la
 * dirección del cliente, mide contra la sucursal, aplica el multiplicador de
 * zona y el plan. En retiro no hay dirección del cliente, no hay distancia y no
 * hay tarifa de envío. Hacerle opcional la dirección volvería condicional cada
 * campo que devuelve.
 *
 * **Retiro no cobra envío ni tarifa de servicio.** El envío es obvio: Flash no
 * mueve nada. La tarifa de servicio es una decisión comercial, y la razón está
 * escrita para que se pueda discutir: cobrarla en un modo donde la plataforma no
 * presta logística es difícil de justificarle al cliente y es lo que hace que el
 * retiro no se use. La plataforma sigue ganando la comisión del comercio, y ahí
 * está la economía del retiro — sin costo de reparto, la contribución por pedido
 * es estructuralmente mejor que la de una entrega.
 *
 * **La sucursal tiene que haberlo habilitado.** `pickup_enabled` está apagado
 * por omisión: entregar en mano exige mostrador, alguien que atienda y lugar
 * para esperar, y darlo por supuesto manda clientes a locales que no pueden
 * recibirlos.
 */
export async function getPostgresFoodPickupQuote({
  customerPublicId,
  merchantPublicId,
  branchPublicId,
}) {
  const [plan, result] = await Promise.all([
    getPostgresPricingPlan("food"),
    postgresPool.query(
      `SELECT m.public_id merchant_id, m.name merchant_name,
              b.public_id branch_id, b.address branch_address, b.eta_min,
              ST_Y(b.location::geometry) lat, ST_X(b.location::geometry) lng
       FROM users u, merchants m
       JOIN merchant_branches b ON b.merchant_id=m.id AND b.status='active' AND b.open
         AND b.pickup_enabled AND app.branch_is_scheduled_open(b.id,now())
         AND (($3::text IS NULL AND b.is_primary) OR b.public_id=$3)
       WHERE u.public_id=$1 AND u.status='active'
         AND m.public_id=$2 AND m.status='active'`,
      [customerPublicId, merchantPublicId, branchPublicId || null],
    ),
  ]);
  const row = result.rows[0];
  if (!row)
    throw Object.assign(new Error("El comercio no ofrece retiro en el local"), { status: 409 });
  return {
    customerId: customerPublicId,
    restaurantId: merchantPublicId,
    branchId: row.branch_id,
    fulfillment: "pickup",
    // **El domicilio del pedido es el del local.** El cliente va ahí, así que es
    // la dirección que tiene que ver en la app y la que queda en el comprobante.
    // Dejarlo vacío obligaría a cada pantalla a decidir qué mostrar.
    pickupAddress: row.branch_address,
    merchantName: row.merchant_name,
    pickupCoords: { lat: Number(row.lat), lng: Number(row.lng) },
    deliveryFee: 0,
    serviceFee: 0,
    // Sin reparto, el tiempo es sólo la cocina. Un ETA que sumara viaje
    // prometería una demora que no existe.
    etaMin: Number(row.eta_min),
    pricingVersion: plan.version,
    currency: plan.currency,
  };
}

export async function getPostgresFoodCheckoutQuote({
  customerPublicId,
  merchantPublicId,
  deliveryAddressId,
  branchPublicId,
  items,
  paymentMethod,
  paymentMethodId,
  promotionCode,
  fulfillment = "delivery",
}) {
  const esRetiro = fulfillment === "pickup";
  const delivery = esRetiro
    ? await getPostgresFoodPickupQuote({ customerPublicId, merchantPublicId, branchPublicId })
    : await getPostgresFoodDeliveryQuote({
        customerPublicId,
        merchantPublicId,
        deliveryAddressId,
        branchPublicId,
      });
  const client = await postgresPool.connect();
  try {
    const context = (
      await client.query(
        `SELECT u.id user_id,u.phone_verified_at,m.id merchant_id,b.id branch_id,b.eta_min,b.cash_enabled FROM users u JOIN merchants m ON m.public_id=$2 JOIN merchant_branches b ON b.merchant_id=m.id AND b.public_id=$3 WHERE u.public_id=$1`,
        [customerPublicId, merchantPublicId, delivery.branchId],
      )
    ).rows[0];
    if (!context)
      throw Object.assign(new Error("No se pudo cotizar este comercio"), { status: 404 });
    if (paymentMethodId) {
      const method = (
        await client.query(
          `SELECT pm.kind,pm.brand,pm.last4 FROM payment_methods pm WHERE pm.id=$1 AND pm.user_id=$2 AND pm.revoked_at IS NULL`,
          [paymentMethodId, context.user_id],
        )
      ).rows[0];
      if (!method) throw Object.assign(new Error("Método de pago no disponible"), { status: 404 });
      paymentMethod =
        method.kind === "wallet"
          ? "Flash Wallet"
          : `${method.brand || method.kind} •••• ${method.last4 || ""}`.trim();
    }
    // PAG-05: el perfil familiar no es una fila de `payment_methods`; la cotización
    // sólo confirma que la persona puede usarlo. El tope se controla al cobrar.
    // PAG-01: efectivo sólo si la sucursal lo acepta, sin método guardado.
    if (paymentMethod === CASH_LABEL) {
      if (paymentMethodId)
        throw Object.assign(new Error("El efectivo no lleva un método de pago guardado"), {
          status: 400,
        });
      await controlarEfectivo(client, {
        userId: context.user_id,
        cashEnabled: context.cash_enabled,
        phoneVerifiedAt: context.phone_verified_at,
        merchantId: context.merchant_id,
      });
    }
    const opcionFamiliar =
      paymentMethod === FAMILY_LABEL
        ? await getFamilyPaymentOption(customerPublicId, client)
        : null;
    if (paymentMethod === FAMILY_LABEL && !opcionFamiliar)
      throw Object.assign(
        new Error("No tenés un perfil familiar activo: elegí otro medio de pago"),
        { status: 409 },
      );
    let subtotalCents = 0;
    const snapshot = [];
    for (const entry of items) {
      const item = (
        await client.query(
          `SELECT c.id,c.public_id,c.name,c.unit_price_cents FROM catalog_items c JOIN catalog_branch_inventory i ON i.catalog_item_id=c.id AND i.branch_id=$3 WHERE c.public_id=$1 AND c.merchant_id=$2 AND c.available AND i.available AND COALESCE(i.stock_quantity,1)>0`,
          [entry.menuItemId, context.merchant_id, context.branch_id],
        )
      ).rows[0];
      if (!item)
        throw Object.assign(new Error("Un producto ya no está disponible"), { status: 409 });
      const selection = await resolveModifierSelection(client, {
          catalogItemId: item.id,
          selectedIds: entry.extras || [],
        }),
        unitPriceCents = Number(item.unit_price_cents) + selection.priceCents;
      subtotalCents += unitPriceCents * entry.quantity;
      snapshot.push({
        menuItemId: item.public_id,
        name: item.name,
        quantity: entry.quantity,
        baseUnitPrice: pesos(item.unit_price_cents),
        unitPrice: pesos(unitPriceCents),
        modifiers: selection.modifiers,
        note: entry.note || "",
      });
    }
    const deliveryFeeCents = Math.round(Number(delivery.deliveryFee) * 100),
      serviceFeeCents = Math.round(Number(delivery.serviceFee) * 100);
    let promotion = null,
      discountCents = 0,
      subscriptionDiscountCents = 0;
    if (promotionCode) {
      promotion = (
        await client.query(
          `SELECT * FROM promotions WHERE code=$1 AND active AND now() BETWEEN starts_at AND ends_at`,
          [promotionCode.trim().toUpperCase()],
        )
      ).rows[0];
      if (!promotion)
        throw Object.assign(new Error("Promoción inválida o vencida"), { status: 409 });
      if (promotion.rules?.service && promotion.rules.service !== "food")
        throw Object.assign(new Error("La promoción no aplica a comida"), { status: 409 });
      if (subtotalCents < Number(promotion.min_subtotal_cents))
        throw Object.assign(new Error("No alcanzas el subtotal mínimo de la promoción"), {
          status: 409,
        });
      if (promotion.rules?.paymentMethod === "flash_wallet" && !pagaConWallet(paymentMethod))
        throw Object.assign(new Error("La promoción requiere Flash Wallet"), { status: 409 });
      const usage = (
        await client.query(
          `SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$2)::int user_total FROM promotion_redemptions WHERE promotion_id=$1`,
          [promotion.id, context.user_id],
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
      if (promotion.max_discount_cents !== null)
        discountCents = Math.min(discountCents, Number(promotion.max_discount_cents));
      discountCents = Math.min(discountCents, subtotalCents + deliveryFeeCents);
    }
    // El beneficio de la suscripcion se aplica ACA, antes de que la ruta firme
    // el token: `/api/orders/quote` firma lo calculado y la creacion del pedido
    // solo acepta ese precio. Un descuento aplicado despues no sobrevive.
    //
    // Va aparte de `discountCents` a proposito. La comision del comercio se
    // calcula sobre `subtotalCents - discountCents`: meter aca un envio que
    // regala Flash le bajaria la comision al comercio por un beneficio que no
    // financio, y ademas quedaria registrado como canje de promocion.
    const subscription = await getActiveSubscription(customerPublicId, client);
    ({ discountCents, subscriptionDiscountCents } = splitOrderDiscounts({
      subscription,
      subtotalCents,
      deliveryFeeCents,
      promotionKind: promotion?.kind || null,
      promotionDiscountCents: discountCents,
    }));
    const totalCents =
      subtotalCents +
      deliveryFeeCents +
      serviceFeeCents -
      discountCents -
      subscriptionDiscountCents;
    if (paymentMethod === CASH_LABEL)
      controlarMontoEfectivo({ totalCents, deliveryFeeCents, esRetiro });
    // PAG-05: avisar en la cotización, no recién al confirmar, si el pedido supera lo
    // que queda del tope del mes. Al cobrar se vuelve a controlar, con la propina.
    if (
      opcionFamiliar?.remaining != null &&
      totalCents > Math.round(opcionFamiliar.remaining * 100)
    )
      throw Object.assign(
        new Error(
          `Superás el tope de tu perfil familiar: te quedan $${opcionFamiliar.remaining.toLocaleString("es-AR")} este mes`,
        ),
        { status: 402 },
      );
    return {
      ...delivery,
      items: snapshot,
      subtotal: pesos(subtotalCents),
      discount: pesos(discountCents),
      subscriptionDiscount: pesos(subscriptionDiscountCents),
      subscriptionPlan: subscriptionDiscountCents > 0 ? subscription.planKey : null,
      promotionCode: promotion?.code || null,
      total: pesos(totalCents),
      // Sin reparto el tiempo es solo la cocina. Sumarle viaje prometeria una
      // demora que no existe — y `distanceKm` no existe en retiro, asi que la
      // suma daria NaN y el token se firmaria con un ETA invalido.
      etaMin: esRetiro
        ? Number(context.eta_min)
        : Number(context.eta_min) +
          Math.max(8, Math.ceil((Number(delivery.distanceKm) * 1000) / 350)),
      fulfillment,
      paymentMethod,
      paymentMethodId: paymentMethodId || null,
    };
  } finally {
    client.release();
  }
}

export async function createPostgresOrder({
  publicId,
  customerPublicId,
  merchantPublicId,
  deliveryAddressId,
  deliveryAddress,
  paymentMethod,
  paymentMethodId,
  providerPayment,
  promotionCode,
  items,
  serviceFee,
  lockedQuote,
  tipCents = 0,
  scheduledFor = null,
  fulfillment = "delivery",
  deliveryPreferences: preferenciasPedidas = null,
  // PAG-01: «¿Con cuánto pagás?», en centavos; `null` si paga justo.
  cashTenderedCents = null,
  idempotencyKey,
}) {
  const esRetiro = fulfillment === "pickup";
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query(
      "SELECT id,phone_verified_at FROM users WHERE public_id = $1 AND status = 'active'",
      [customerPublicId],
    );
    const merchant = await client.query(
      `SELECT m.*,b.id branch_id,b.public_id branch_public_id,b.address branch_address,b.location branch_location,b.eta_min branch_eta_min,b.pickup_enabled,b.cash_enabled FROM merchants m JOIN merchant_branches b ON b.merchant_id=m.id AND b.public_id=$2 AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) WHERE m.public_id=$1 AND m.status='active'`,
      [merchantPublicId, lockedQuote?.branchId],
    );
    if (!customer.rows[0]) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!merchant.rows[0])
      throw Object.assign(new Error("Restaurante no disponible"), { status: 404 });
    if (paymentMethodId) {
      const method = (
        await client.query(
          "SELECT kind,brand,last4 FROM payment_methods WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL",
          [paymentMethodId, customer.rows[0].id],
        )
      ).rows[0];
      if (!method) throw Object.assign(new Error("Método de pago no disponible"), { status: 404 });
      const authoritativeLabel =
        method.kind === "wallet"
          ? "Flash Wallet"
          : `${method.brand || method.kind} •••• ${method.last4 || ""}`.trim();
      if (authoritativeLabel !== paymentMethod || lockedQuote.paymentMethodId !== paymentMethodId)
        throw Object.assign(new Error("El método de pago no coincide con la cotización"), {
          status: 409,
        });
    }
    // **El destino de un pedido retirado es el propio local**, así que nada de la
    // validación de dirección aplica: no hay dirección del cliente que verificar,
    // ni firma de geocodificación que comparar, ni distancia que pueda cambiar.
    // Las dos ramas producen la misma forma para que el resto de la función lea
    // un solo objeto y no tenga que preguntar el modo en cada línea.
    let address;
    if (esRetiro) {
      if (!merchant.rows[0].pickup_enabled)
        throw Object.assign(new Error("El comercio no ofrece retiro en el local"), {
          status: 409,
        });
      deliveryAddress = merchant.rows[0].branch_address;
      address = {
        id: null,
        formatted_address: merchant.rows[0].branch_address,
        location: merchant.rows[0].branch_location,
        distance_m: 0,
      };
    } else {
      if (!deliveryAddressId)
        throw Object.assign(new Error("Selecciona una dirección guardada con coordenadas reales"), {
          status: 400,
        });
      address = (
        await client.query(
          `SELECT a.id,a.formatted_address,a.location,a.geocoding_provider,a.provider_place_id,a.geocoded_at,ST_Distance(a.location,$3::geography) distance_m
      FROM addresses a JOIN users u ON u.id=a.user_id WHERE a.id=$1 AND u.id=$2 AND a.geocoded_at IS NOT NULL
        AND (NOT $4::boolean OR (a.geocoding_provider=$5 AND a.provider_place_id IS NOT NULL))`,
          [
            deliveryAddressId,
            customer.rows[0].id,
            merchant.rows[0].branch_location,
            config.requireCommercialGeocoding,
            config.maps.provider,
          ],
        )
      ).rows[0];
      if (!address)
        throw Object.assign(
          new Error("La dirección no pertenece al cliente o necesita volver a validarse"),
          { status: 404 },
        );
      deliveryAddress = address.formatted_address;
      if (
        lockedQuote?.addressValidation?.provider !== address.geocoding_provider ||
        lockedQuote?.addressValidation?.providerPlaceId !== (address.provider_place_id || null) ||
        lockedQuote?.addressValidation?.validatedAt !== address.geocoded_at.toISOString()
      )
        throw Object.assign(new Error("La dirección cambió; actualiza la cotización"), {
          status: 409,
        });
      if (
        !lockedQuote ||
        Math.abs(
          (Number(address.distance_m) / 1000) * Number(lockedQuote.roadFactor) -
            Number(lockedQuote.distanceKm),
        ) > 0.1
      )
        throw Object.assign(new Error("La ruta cambió; actualiza la cotización"), { status: 409 });
    }
    // **Una propina en retiro no tiene a quién ir.** No hay repartidor, así que
    // quedaría retenida hasta que la liquidación la devuelva. Se rechaza al
    // confirmar en vez de cobrarla y reintegrarla: un cargo que aparece y
    // desaparece en el resumen es peor que no haberlo aceptado.
    if (esRetiro && tipCents > 0)
      throw Object.assign(new Error("Un pedido para retirar no lleva propina de reparto"), {
        status: 409,
      });
    // Preferencias de entrega (P-02): las reglas dependen del modo y del rubro
    // del comercio, que recién acá se conocen con certeza.
    const deliveryPreferences = normalizarPreferencias(preferenciasPedidas, {
      fulfillment,
      vertical: merchant.rows[0].vertical,
    });
    // PAG-05: el rail se elige explícitamente. «Perfil familiar» no contiene «wallet»:
    // con la prueba por subcadena caía en Mercado Pago.
    const familyPayment = paymentMethod === FAMILY_LABEL;
    if (familyPayment && paymentMethodId)
      throw Object.assign(new Error("El perfil familiar no lleva un método de pago guardado"), {
        status: 400,
      });
    const walletPayment = pagaConWallet(paymentMethod);
    // PAG-01: en efectivo no se cobra nada ahora. Se liquida al completar el pedido.
    const cashPayment = paymentMethod === CASH_LABEL;
    if (cashPayment) {
      if (paymentMethodId || providerPayment)
        throw Object.assign(new Error("El efectivo no lleva un método de pago guardado"), {
          status: 400,
        });
      // La propina del checkout viaja dentro de un cobro: en efectivo no hay cobro, y
      // liquidarla le pagaría al repartidor plata que Flash nunca recibió.
      if (tipCents > 0)
        throw Object.assign(new Error("En efectivo, la propina se la das en mano al repartidor"), {
          status: 409,
        });
      // Alguien tiene que recibir la plata: no se deja en la puerta.
      if (deliveryPreferences.dropoff === "leave_at_door")
        throw Object.assign(new Error("Un pedido en efectivo se entrega en mano"), {
          status: 409,
        });
    } else if (cashTenderedCents !== null)
      throw Object.assign(new Error("«Con cuánto pagás» es sólo para efectivo"), { status: 400 });
    if (!walletPayment && !cashPayment && !providerPayment)
      throw Object.assign(
        new Error("El pago debe tokenizarse con Mercado Pago antes de confirmar"),
        { status: 402 },
      );
    const requestHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          customerPublicId,
          merchantPublicId,
          deliveryAddressId,
          deliveryAddress,
          paymentMethod,
          paymentMethodId: paymentMethodId || null,
          providerPayment: providerPayment
            ? {
                paymentMethodId: providerPayment.paymentMethodId,
                installments: providerPayment.installments,
              }
            : null,
          promotionCode: promotionCode || null,
          items,
          quoteId: lockedQuote.quoteId,
          // **Todo lo que cambia el pedido guardado entra al hash.** Antes no
          // entraban propina, horario, modo ni sucursal: el mismo
          // Idempotency-Key con otra propina devolvía el pedido anterior como si
          // fuera la respuesta a éste, sin 409. Con dinero de por medio, un
          // reintento distinto tiene que ser un conflicto, no un eco.
          tipCents,
          scheduledFor: scheduledFor || null,
          fulfillment,
          branchId: lockedQuote.branchId || null,
          deliveryPreferences,
          cashTenderedCents,
        }),
      )
      .digest("hex");
    const claimed = await client.query(
      `INSERT INTO idempotency_keys(key, user_id, request_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [idempotencyKey, customer.rows[0].id, requestHash],
    );
    if (!claimed.rows[0]) {
      const existing = await client.query(
        "SELECT request_hash, response_body FROM idempotency_keys WHERE key = $1",
        [idempotencyKey],
      );
      if (existing.rows[0]?.request_hash !== requestHash) {
        throw Object.assign(new Error("La clave de idempotencia ya fue usada con otra solicitud"), {
          status: 409,
        });
      }
      if (existing.rows[0]?.response_body?.order) {
        await client.query("ROLLBACK");
        return existing.rows[0].response_body.order;
      }
      throw Object.assign(new Error("La solicitud con esta clave todavía está procesándose"), {
        status: 409,
      });
    }
    // PAG-01: la elegibilidad del efectivo se controla **después** de resolver un
    // reintento: el pedido que ya creó esta misma solicitud cuenta como «en curso», y
    // controlarla antes le respondía 409 al reintento en vez del pedido. Un bloqueo por
    // persona ordena dos altas simultáneas con claves distintas: la segunda espera a que
    // la primera confirme y la ve en curso.
    if (cashPayment) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('cash-order:' || $1::text, 0))",
        [customer.rows[0].id],
      );
      await controlarEfectivo(client, {
        userId: customer.rows[0].id,
        cashEnabled: merchant.rows[0].cash_enabled,
        phoneVerifiedAt: customer.rows[0].phone_verified_at,
        merchantId: merchant.rows[0].id,
      });
    }
    const snapshots = [];
    for (const entry of items) {
      const item = await client.query(
        `SELECT c.* FROM catalog_items c JOIN catalog_branch_inventory i ON i.catalog_item_id=c.id AND i.branch_id=$3 WHERE c.public_id=$1 AND c.merchant_id=$2 AND c.available AND i.available AND COALESCE(i.stock_quantity,1)>0 FOR SHARE OF c,i`,
        [entry.menuItemId, merchant.rows[0].id, merchant.rows[0].branch_id],
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
      if (!promotion)
        throw Object.assign(new Error("Promoción inválida o vencida"), { status: 409 });
      if (promotion.rules?.service && promotion.rules.service !== "food")
        throw Object.assign(new Error("La promoción no aplica a comida"), { status: 409 });
      if (subtotalCents < Number(promotion.min_subtotal_cents))
        throw Object.assign(new Error("No alcanzas el subtotal mínimo de la promoción"), {
          status: 409,
        });
      if (promotion.rules?.paymentMethod === "flash_wallet" && !pagaConWallet(paymentMethod))
        throw Object.assign(new Error("La promoción requiere Flash Wallet"), { status: 409 });
      const usage = (
        await client.query(
          `SELECT count(*)::int total,count(*) FILTER(WHERE user_id=$2)::int user_total FROM promotion_redemptions WHERE promotion_id=$1`,
          [promotion.id, customer.rows[0].id],
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
      subtotalCents +
      deliveryFeeCents +
      serviceFeeCents -
      discountCents -
      subscriptionDiscountCents;
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
      throw Object.assign(
        new Error("El precio final cambió; revisa y acepta una nueva cotización"),
        { status: 409 },
      );
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
    const chargedCents = totalCents + tipCents;
    // En retiro no hay viaje que sumar al tiempo de cocina.
    const travelMinutes = esRetiro ? 0 : Math.max(8, Math.ceil(Number(address.distance_m) / 350));
    const metadata = {
      subtype: "food_order",
      subtotal: pesos(subtotalCents),
      deliveryFee: pesos(deliveryFeeCents),
      serviceFee,
      discount: pesos(discountCents),
      subscriptionDiscount: pesos(subscriptionDiscountCents),
      subscriptionPlan: subscriptionDiscountCents > 0 ? subscription.planKey : null,
      // Lo cobrado al cliente es `total + tip`. Guardar la propina aca es lo que
      // despues le permite a la liquidacion repartir sobre el total sin ella.
      tip: pesos(tipCents),
      scheduledFor: scheduledFor || null,
      promotionCode: promotion?.code || null,
      etaMin: merchant.rows[0].branch_eta_min + travelMinutes,
      locationEstimated: false,
      fulfillment,
      deliveryPreferences,
      // `null` y no la cadena "null": en retiro no hay dirección de cliente, y
      // una cadena con esa palabra se lee después como un identificador roto.
      deliveryAddressId: address.id === null ? null : String(address.id),
      quoteId: lockedQuote.quoteId,
      pricingVersion: lockedQuote.pricingVersion,
      quotedDistanceKm: lockedQuote.distanceKm,
      zoneId: lockedQuote.zoneId,
      zoneMultiplier: lockedQuote.zoneMultiplier,
    };
    if (cashPayment) {
      controlarMontoEfectivo({ totalCents, deliveryFeeCents, esRetiro });
      if (cashTenderedCents !== null && cashTenderedCents < totalCents)
        throw Object.assign(
          new Error(`Con lo que pagás no alcanza: el total es ${formatoPesos(totalCents)}`),
          { status: 400 },
        );
      // Quién cobra: el repartidor, o el comercio si se retira en el local.
      metadata.cashPayment = {
        tenderedCents: cashTenderedCents,
        changeCents: cashTenderedCents === null ? 0 : cashTenderedCents - totalCents,
        collector: esRetiro ? "merchant" : "courier",
      };
    }
    // El efectivo no espera un cobro: el comercio lo ve como un pedido aceptado. En
    // `requested` no aparece en su lista, que es para los pagos con tarjeta pendientes.
    const initialStatus = walletPayment || cashPayment ? "accepted" : "requested";
    const job = await client.query(
      // `merchant_ready_due_at` cuenta desde el horario reservado, no desde
      // ahora: un pedido para mañana con vencimiento de cocina para dentro de 20
      // minutos aparece atrasado apenas se crea, y ensucia la métrica de
      // demoras del comercio con trabajo que todavía no le toca hacer.
      `INSERT INTO jobs(public_id, kind, customer_id, merchant_id, branch_id, status, pickup_address, pickup_location,
        dropoff_address, dropoff_location, service_level, quoted_amount_cents, final_amount_cents,
        distance_m, estimated_duration_s, payment_method_label, metadata, merchant_prep_minutes,
        scheduled_for, merchant_ready_due_at)
       VALUES ($1, 'delivery', $2, $3, $4, $14, $5, $6, $7, $8, 'food', $9, $9, $10, $11, $12, $13, $15::smallint,
         $16::timestamptz,
         CASE WHEN $14::job_status='accepted'
           THEN COALESCE($16::timestamptz, now()) + make_interval(mins=>$15::integer)
           ELSE NULL END)
       RETURNING id,
         ST_Y(pickup_location::geometry) AS pickup_lat,
         ST_X(pickup_location::geometry) AS pickup_lng,
         ST_Y(dropoff_location::geometry) AS dropoff_lat,
         ST_X(dropoff_location::geometry) AS dropoff_lng`,
      [
        publicId,
        customer.rows[0].id,
        merchant.rows[0].id,
        merchant.rows[0].branch_id,
        merchant.rows[0].branch_address,
        merchant.rows[0].branch_location,
        deliveryAddress,
        address.location,
        totalCents,
        Math.round(Number(address.distance_m)),
        metadata.etaMin * 60,
        paymentMethod,
        metadata,
        initialStatus,
        Number(merchant.rows[0].branch_eta_min),
        scheduledFor,
      ],
    );
    // SEG-03: un pedido de valor alto, o de quien tuvo un reclamo aprobado, se
    // entrega con código. Se decide acá, en la misma transacción.
    await requireOrderDeliveryCodeIfNeeded(client, {
      jobId: job.rows[0].id,
      publicId,
      customerId: customer.rows[0].id,
      totalCents,
      pickup: esRetiro,
    });
    for (const { entry, item, selection, unitPriceCents } of snapshots) {
      await client.query(
        `INSERT INTO job_items(job_id, catalog_item_id, name, quantity, unit_price_cents, customer_note, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          job.rows[0].id,
          item.id,
          item.name,
          entry.quantity,
          unitPriceCents,
          entry.note || null,
          {
            publicId: item.public_id,
            extras: selection.modifiers.map((modifier) => modifier.name),
            modifiers: selection.modifiers,
            baseUnitPrice: pesos(item.unit_price_cents),
          },
        ],
      );
    }
    if (promotion)
      await client.query(
        `INSERT INTO promotion_redemptions(promotion_id,user_id,job_id,discount_cents) VALUES($1,$2,$3,$4)`,
        [promotion.id, customer.rows[0].id, job.rows[0].id, discountCents],
      );
    let paymentStatus = "pending";
    // PAG-05: con el perfil familiar paga quien organiza. La membresía se bloquea y el
    // tope del mes se controla acá, en la transacción del cobro.
    const familia = familyPayment
      ? await resolveFamilyPayer(client, {
          customerId: customer.rows[0].id,
          amountCents: chargedCents,
        })
      : null;
    const payerId = familia?.organizerId ?? customer.rows[0].id;
    if (walletPayment) {
      const walletAccount = await client.query(
        `SELECT id FROM ledger_accounts WHERE owner_type='user' AND owner_id=$1 AND currency='ARS' AND account_type='wallet' FOR UPDATE`,
        [payerId],
      );
      const walletBalance = walletAccount.rows[0]
        ? await client.query(
            `SELECT COALESCE(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::bigint AS balance FROM ledger_entries WHERE account_id=$1`,
            [walletAccount.rows[0].id],
          )
        : { rows: [] };
      // Contra `chargedCents` y no contra el total: si el saldo alcanza para el
      // pedido pero no para la propina, el cobro fallaria a mitad de camino.
      if (!walletAccount.rows[0] || Number(walletBalance.rows[0]?.balance || 0) < chargedCents) {
        throw Object.assign(new Error("Saldo insuficiente en Flash Wallet"), { status: 402 });
      }
      const clearing =
        await client.query(`INSERT INTO ledger_accounts(owner_type,owner_id,currency,account_type)
        VALUES('platform',NULL,'ARS','cash_clearing') ON CONFLICT(owner_type,currency,account_type) WHERE owner_id IS NULL
        DO UPDATE SET owner_type=EXCLUDED.owner_type RETURNING id`);
      const paymentTransaction = await client.query(
        `INSERT INTO ledger_transactions(idempotency_key,kind,actor_id,description,metadata)
         VALUES($1,'payment',$2,$3,$4) RETURNING id`,
        [
          `payment-${idempotencyKey}`,
          customer.rows[0].id,
          `Pago pedido ${publicId}`,
          familia
            ? { jobPublicId: publicId, familyMemberId: familia.familyMemberId }
            : { jobPublicId: publicId },
        ],
      );
      await client.query(
        `INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_cents,reference_type,reference_id,metadata) VALUES
        ($1,$2,'debit',$4,'food_order',$3,$5),($1,$6,'credit',$4,'food_order',$3,$5)`,
        [
          paymentTransaction.rows[0].id,
          walletAccount.rows[0].id,
          job.rows[0].id,
          chargedCents,
          { jobPublicId: publicId },
          clearing.rows[0].id,
        ],
      );
      await client.query(
        `INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload,family_member_id)
        VALUES($1,$2,'flash_wallet','captured',$3,$3,'ARS',$4,$5,$6)`,
        [
          job.rows[0].id,
          // Quien pagó: los reintegros vuelven acá (PAG-05).
          payerId,
          chargedCents,
          `payment-${idempotencyKey}`,
          { ledgerTransactionId: paymentTransaction.rows[0].id },
          familia?.familyMemberId ?? null,
        ],
      );
      if (familia)
        await notifyFamilyCharge(client, {
          organizerId: familia.organizerId,
          memberId: customer.rows[0].id,
          familyMemberId: familia.familyMemberId,
          amountCents: chargedCents,
          description: "Un pedido",
          jobPublicId: publicId,
        });
      paymentStatus = "captured";
    } else if (cashPayment) {
      // Sin `payment_intents`: no hay nada cobrado ni por confirmar, y una intención
      // pendiente abriría casos de conciliación. Se asienta al completar el pedido.
      paymentStatus = "cash_on_delivery";
    } else {
      const merchantCommissionCents = Math.round(
          (Math.max(0, subtotalCents - discountCents) * Number(merchant.rows[0].commission_bps)) /
            10000,
        ),
        // El envio que regala la suscripcion sale del margen de Flash, no del
        // comercio: se descuenta de la comision de aplicacion y no de lo que se
        // le liquida. Sumarlo entero aca le cobraria al comercio un beneficio
        // que no vendio ni financio.
        // `+ tipCents`: con split de marketplace el comercio recibe lo cobrado
        // menos la comision de aplicacion. Sin sumar la propina ahi, la propina
        // del repartidor terminaria en la cuenta del comercio.
        applicationFeeCents =
          deliveryFeeCents -
          subscriptionDiscountCents +
          serviceFeeCents +
          merchantCommissionCents +
          tipCents;
      if (applicationFeeCents >= chargedCents)
        throw Object.assign(new Error("La comisión configurada no permite procesar este pedido"), {
          status: 409,
        });
      await client.query(
        `INSERT INTO payment_intents(job_id,customer_id,provider,status,amount_cents,captured_amount_cents,currency,idempotency_key,provider_payload) VALUES($1,$2,'mercadopago','requires_confirmation',$3,0,'ARS',$4,$5)`,
        [
          job.rows[0].id,
          customer.rows[0].id,
          chargedCents,
          marketplacePaymentKey(idempotencyKey),
          {
            applicationFeeCents,
            paymentMethodId: providerPayment.paymentMethodId,
            installments: providerPayment.installments,
          },
        ],
      );
      paymentStatus = "requires_confirmation";
    }
    // Retenida, no pagada: en el checkout todavia no hay conductor asignado. Se
    // libera al liquidar el pedido completado, y si el pedido nunca llega a
    // completarse vuelve con el reintegro.
    await holdCheckoutTip(client, {
      jobId: job.rows[0].id,
      // Quien pagó la propina: un ajuste se la devuelve a él (PAG-05).
      customerId: payerId,
      amountCents: tipCents,
      idempotencyKey,
    });
    await client.query("INSERT INTO job_events(job_id, actor_id, status) VALUES ($1, $2, $3)", [
      job.rows[0].id,
      customer.rows[0].id,
      initialStatus,
    ]);
    if (walletPayment || cashPayment)
      await enqueueNotificationForInternalUser(client, {
        userId: customer.rows[0].id,
        template: "order_status",
        payload: { kind: "food_order", jobId: publicId, status: "accepted" },
        deduplicationKey: `food_order:${publicId}:accepted`,
      });
    const responseOrder = {
      id: publicId,
      customerId: customerPublicId,
      restaurantId: merchantPublicId,
      courierId: null,
      status: initialStatus,
      deliveryAddress,
      paymentMethod,
      pickupLocation: { lat: Number(job.rows[0].pickup_lat), lng: Number(job.rows[0].pickup_lng) },
      deliveryLocation: {
        lat: Number(job.rows[0].dropoff_lat),
        lng: Number(job.rows[0].dropoff_lng),
      },
      items: snapshots.map(({ entry, item, selection, unitPriceCents }) => ({
        menuItemId: item.public_id,
        name: item.name,
        quantity: entry.quantity,
        unitPrice: pesos(unitPriceCents),
        extras: selection.modifiers.map((modifier) => modifier.name),
        modifiers: selection.modifiers,
        note: entry.note || "",
      })),
      subtotal: metadata.subtotal,
      deliveryFee: metadata.deliveryFee,
      serviceFee,
      discount: metadata.discount,
      // **La respuesta es también la que se repite en un reintento** (se guarda
      // en `idempotency_keys`). Omitía modo, propina, horario y beneficio: un
      // reintento devolvía un pedido de entrega sin propina aunque fuera un
      // retiro reservado. Va con los mismos campos que la lectura del pedido.
      subscriptionDiscount: metadata.subscriptionDiscount,
      tip: metadata.tip,
      scheduledFor: metadata.scheduledFor,
      fulfillment,
      deliveryPreferences,
      promotionCode: metadata.promotionCode,
      total: pesos(totalCents),
      etaMin: metadata.etaMin,
      createdAt: new Date().toISOString(),
      timeline: [{ status: initialStatus, at: new Date().toISOString() }],
      paymentStatus,
      // PAG-01: la confirmación muestra cuánto tener a mano y el vuelto, como después
      // el seguimiento. La misma forma que `rowsToOrders`.
      cashPayment: vistaEfectivo(metadata.cashPayment, totalCents),
    };
    await client.query(
      "UPDATE idempotency_keys SET response_status = 200, response_body = $2 WHERE key = $1",
      [idempotencyKey, { order: responseOrder }],
    );
    await client.query("COMMIT");
    return responseOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processPostgresOrderMarketplacePayment({
  orderPublicId,
  customerPublicId,
  idempotencyKey,
  cardToken,
  paymentMethodId,
  installments,
}) {
  const context = (
    await postgresPool.query(
      `SELECT j.id job_id,j.public_id,j.status,j.quoted_amount_cents,j.customer_id,u.email,m.public_id merchant_public_id,p.id payment_intent_id,p.status payment_status,p.amount_cents,p.provider_payload,c.access_token_ciphertext,c.revoked_at,c.token_expires_at FROM jobs j JOIN users u ON u.id=j.customer_id JOIN merchants m ON m.id=j.merchant_id JOIN payment_intents p ON p.job_id=j.id AND p.provider='mercadopago' LEFT JOIN merchant_payment_connections c ON c.merchant_id=m.id AND c.provider='mercadopago' WHERE j.public_id=$1 AND u.public_id=$2`,
      [orderPublicId, customerPublicId],
    )
  ).rows[0];
  if (!context) throw Object.assign(new Error("Intento de pago no encontrado"), { status: 404 });
  if (context.payment_status === "captured")
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  if (
    !context.access_token_ciphertext ||
    context.revoked_at ||
    (context.token_expires_at && new Date(context.token_expires_at) <= new Date())
  )
    throw Object.assign(new Error("El comercio todavía no puede cobrar con Mercado Pago"), {
      status: 409,
    });
  const payment = await createMercadoPagoPayment({
    accessToken: decryptPaymentOAuthToken(context.access_token_ciphertext),
    idempotencyKey: marketplacePaymentKey(idempotencyKey),
    cardToken,
    transactionAmount: pesos(context.amount_cents),
    applicationFee: pesos(context.provider_payload.applicationFeeCents),
    paymentMethodId,
    installments,
    payerEmail: context.email,
    externalReference: orderPublicId,
    description: `Pedido ${orderPublicId}`,
  });
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const locked = (
      await client.query("SELECT status FROM payment_intents WHERE id=$1 FOR UPDATE", [
        context.payment_intent_id,
      ])
    ).rows[0];
    if (locked.status === "captured") {
      await client.query("ROLLBACK");
      return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
    }
    const decision = mercadoPagoFulfillmentDecision(payment.status);
    await client.query(
      `UPDATE payment_intents SET provider_intent_id=$2,status=$3,captured_amount_cents=$4,failure_code=$5,provider_payload=provider_payload||$6::jsonb,updated_at=now() WHERE id=$1`,
      [
        context.payment_intent_id,
        payment.id,
        decision.intentStatus,
        decision.fulfill ? Number(context.amount_cents) : 0,
        decision.terminal && !decision.fulfill ? payment.statusDetail || payment.status : null,
        JSON.stringify({
          statusDetail: payment.statusDetail,
          applicationFee: payment.applicationFee,
          collectorId: payment.collectorId,
          dateApproved: payment.dateApproved,
        }),
      ],
    );
    if (decision.fulfill)
      await recordMarketplaceCapture(client, {
        paymentIntentId: context.payment_intent_id,
        jobId: context.job_id,
        jobPublicId: orderPublicId,
        providerPaymentId: payment.id,
        amountCents: Number(context.amount_cents),
        applicationFeeCents: Number(context.provider_payload.applicationFeeCents),
        collectorId: payment.collectorId,
      });
    if (decision.fulfill && context.status === "requested") {
      await client.query(
        // El vencimiento de cocina cuenta desde el horario reservado, no desde el
        // cobro: un pedido programado que se paga hoy no se cocina hoy.
        `UPDATE jobs SET status='accepted',
           merchant_ready_due_at=CASE WHEN merchant_prep_minutes IS NULL THEN NULL
             ELSE COALESCE(scheduled_for, now())+make_interval(mins=>merchant_prep_minutes::integer) END,
           updated_at=now() WHERE id=$1`,
        [context.job_id],
      );
      await client.query(
        "INSERT INTO job_events(job_id,actor_id,status,metadata) VALUES($1,$2,'accepted',$3)",
        [
          context.job_id,
          context.customer_id,
          { paymentProvider: "mercadopago", providerPaymentId: payment.id },
        ],
      );
      await enqueueNotificationForInternalUser(client, {
        userId: context.customer_id,
        template: "order_status",
        payload: { kind: "food_order", jobId: orderPublicId, status: "accepted" },
        deduplicationKey: `food_order:${orderPublicId}:accepted`,
      });
    } else if (decision.terminal && context.status === "requested") {
      await client.query(
        "UPDATE jobs SET status='cancelled',cancellation_reason='payment_failed',updated_at=now() WHERE id=$1",
        [context.job_id],
      );
      await client.query(
        "INSERT INTO job_events(job_id,actor_id,status,metadata) VALUES($1,$2,'cancelled',$3)",
        [
          context.job_id,
          context.customer_id,
          { reason: "payment_failed", providerStatus: payment.status },
        ],
      );
    }
    await client.query("COMMIT");
    return {
      ...(await getPostgresOrders()).find((order) => order.id === orderPublicId),
      paymentStatus: decision.intentStatus,
      paymentStatusDetail: payment.statusDetail,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function assignPostgresOrderDriver(orderPublicId, driverPublicId, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const job = await acceptDispatchOffer(client, {
      jobPublicId: orderPublicId,
      driverPublicId,
      actorUserId: actor.rows[0]?.id || null,
    });
    const customer = { customer_id: job.customer_id };
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status: "driver_assigned" },
      deduplicationKey: `food_order:${orderPublicId}:driver_assigned`,
    });
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setPostgresOrderStatus(orderPublicId, status, actorPublicId) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM users WHERE public_id = $1", [actorPublicId]);
    const databaseTarget = databaseStatus(status);
    // **Un pedido retirado salta tres estados.** No hay conductor asignado, no
    // hay retiro del repartidor y no hay reparto: de la cocina pasa a estar
    // listo, y de listo a entregado cuando el cliente lo levanta del mostrador.
    // Reusar la tabla de entrega lo dejaria trabado en `ready_for_pickup` para
    // siempre, esperando un `driver_assigned` que nunca llega.
    const pedido = (
      await client.query(
        "SELECT id, COALESCE(metadata->>'fulfillment','delivery') fulfillment FROM jobs WHERE public_id=$1",
        [orderPublicId],
      )
    ).rows[0];
    const esRetiro = pedido?.fulfillment === "pickup";
    const expectedStatus = (
      esRetiro
        ? { preparing: "accepted", ready_for_pickup: "preparing", completed: "ready_for_pickup" }
        : {
            preparing: "accepted",
            ready_for_pickup: "preparing",
            picked_up: "driver_assigned",
            delivering: "picked_up",
            completed: "delivering",
          }
    )[databaseTarget];
    if (!expectedStatus)
      throw Object.assign(new Error("Transición de pedido no permitida"), { status: 409 });
    const result = await client.query(
      `WITH changed AS (
      UPDATE jobs SET status = $1, version = version + 1, updated_at = now(),
        metadata = CASE WHEN $1::job_status = 'completed' THEN jsonb_set(metadata, '{etaMin}', '0') ELSE metadata END
      WHERE public_id = $2 AND kind = 'delivery' AND status = $4::job_status
        AND NOT (metadata ? 'refundPending')
        AND NOT EXISTS(SELECT 1 FROM order_item_substitutions s WHERE s.job_id=jobs.id AND s.status='pending') RETURNING id,customer_id
    ) INSERT INTO job_events(job_id, actor_id, status) SELECT id, $3, $1 FROM changed RETURNING job_id`,
      [databaseTarget, orderPublicId, actor.rows[0]?.id || null, expectedStatus],
    );
    if (!result.rows[0])
      throw Object.assign(new Error("El pedido no puede cambiar de estado"), { status: 409 });
    const customer = (
      await client.query("SELECT customer_id FROM jobs WHERE public_id=$1", [orderPublicId])
    ).rows[0];
    // La segunda defensa. El barrido del despacho ya filtra por `fulfillment`,
    // pero esta llamada crea ofertas directamente sin pasar por el: las dos
    // tienen que saberlo, o alcanza con que una se olvide.
    if (databaseTarget === "ready_for_pickup" && !esRetiro)
      await createDispatchOffers(client, { jobId: result.rows[0].job_id, mode: "delivery" });
    if (databaseTarget === "completed") {
      const liquidacion = await settleCapturedFoodOrder(client, {
        jobId: result.rows[0].job_id,
        actorId: actor.rows[0]?.id || null,
      });
      // PAG-01: sin cobro previo, la liquidación es el único registro de la plata. Un
      // pedido en efectivo no se cierra sin ella.
      if (liquidacion?.cashRequired && !liquidacion.settled)
        throw Object.assign(new Error("No se pudo liquidar el pedido en efectivo"), {
          status: 409,
        });
    }
    await enqueueNotificationForInternalUser(client, {
      userId: customer.customer_id,
      template: "order_status",
      payload: { kind: "food_order", jobId: orderPublicId, status },
      deduplicationKey: `food_order:${orderPublicId}:${status}`,
    });
    await client.query("COMMIT");
    return (await getPostgresOrders()).find((order) => order.id === orderPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getPostgresCart(customerPublicId) {
  const result = await postgresPool.query(
    `
    SELECT merchant.public_id AS restaurant_id, catalog.public_id AS item_public_id,
      catalog.name, catalog.description, catalog.category, catalog.unit_price_cents,
      catalog.available, catalog.metadata, item.quantity,item.unit_price_snapshot_cents selected_unit_price_cents, item.options, item.note
    FROM carts cart
    JOIN users customer ON customer.id = cart.customer_id
    JOIN merchants merchant ON merchant.id = cart.merchant_id
    JOIN cart_items item ON item.cart_id = cart.id
    JOIN catalog_items catalog ON catalog.id = item.catalog_item_id
    WHERE customer.public_id = $1 AND cart.status = 'active' AND cart.expires_at > now()
    ORDER BY item.id`,
    [customerPublicId],
  );
  return result.rows.map((row) => ({
    restaurantId: row.restaurant_id,
    item: { ...mapCatalogItem(row), price: pesos(row.selected_unit_price_cents) },
    quantity: row.quantity,
    extras: Array.isArray(row.options) ? row.options : [],
    note: row.note || "",
  }));
}

export async function replacePostgresCart(customerPublicId, merchantPublicId, lines) {
  const client = await postgresPool.connect();
  try {
    await client.query("BEGIN");
    const customer = await client.query("SELECT id FROM users WHERE public_id = $1", [
      customerPublicId,
    ]);
    if (!customer.rows[0]) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
    if (!lines.length) {
      await client.query(
        "UPDATE carts SET status = 'abandoned', updated_at = now() WHERE customer_id = $1 AND status = 'active'",
        [customer.rows[0].id],
      );
      await client.query("COMMIT");
      return [];
    }
    const merchant = await client.query(
      "SELECT id FROM merchants WHERE public_id = $1 AND status = 'active'",
      [merchantPublicId],
    );
    if (!merchant.rows[0])
      throw Object.assign(new Error("Comercio no encontrado"), { status: 404 });
    await client.query(
      "UPDATE carts SET status = 'abandoned', updated_at = now() WHERE customer_id = $1 AND status = 'active' AND merchant_id <> $2",
      [customer.rows[0].id, merchant.rows[0].id],
    );
    const cart = await client.query(
      `INSERT INTO carts(customer_id, merchant_id) VALUES ($1, $2)
       ON CONFLICT (customer_id, merchant_id) WHERE status = 'active'
       DO UPDATE SET version = carts.version + 1, expires_at = now() + interval '7 days', updated_at = now()
       RETURNING id`,
      [customer.rows[0].id, merchant.rows[0].id],
    );
    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cart.rows[0].id]);
    for (const line of lines) {
      const item = await client.query(
        `SELECT c.id,c.unit_price_cents FROM catalog_items c WHERE c.public_id=$1 AND c.merchant_id=$2 AND c.available AND EXISTS(SELECT 1 FROM merchant_branches b JOIN catalog_branch_inventory i ON i.branch_id=b.id AND i.catalog_item_id=c.id WHERE b.merchant_id=c.merchant_id AND b.is_primary AND b.status='active' AND b.open AND app.branch_is_scheduled_open(b.id,now()) AND i.available AND COALESCE(i.stock_quantity,1)>0)`,
        [line.menuItemId, merchant.rows[0].id],
      );
      if (!item.rows[0])
        throw Object.assign(new Error("Uno de los productos ya no está disponible"), {
          status: 409,
        });
      const selection = await resolveModifierSelection(client, {
        catalogItemId: item.rows[0].id,
        selectedIds: line.extras || [],
      });
      await client.query(
        `INSERT INTO cart_items(cart_id, catalog_item_id, quantity, unit_price_snapshot_cents, options, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          cart.rows[0].id,
          item.rows[0].id,
          line.quantity,
          Number(item.rows[0].unit_price_cents) + selection.priceCents,
          JSON.stringify(line.extras || []),
          line.note || null,
        ],
      );
    }
    await client.query("COMMIT");
    return getPostgresCart(customerPublicId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reorderPostgresOrder({ customerPublicId, orderPublicId }) {
  const result = await postgresPool.query(
    `SELECT m.public_id restaurant_id,ji.quantity,ji.customer_note,COALESCE(ji.metadata->>'publicId',c.public_id) menu_item_id,COALESCE(ji.metadata->'modifiers','[]') modifiers FROM jobs j JOIN users u ON u.id=j.customer_id JOIN merchants m ON m.id=j.merchant_id JOIN job_items ji ON ji.job_id=j.id LEFT JOIN catalog_items c ON c.id=ji.catalog_item_id WHERE j.public_id=$1 AND u.public_id=$2 AND j.kind='delivery' AND j.metadata->>'subtype'='food_order' ORDER BY ji.id`,
    [orderPublicId, customerPublicId],
  );
  if (!result.rowCount) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });
  const restaurantId = result.rows[0].restaurant_id,
    lines = result.rows.map((row) => ({
      menuItemId: row.menu_item_id,
      quantity: Number(row.quantity),
      extras: (Array.isArray(row.modifiers) ? row.modifiers : [])
        .map((modifier) => modifier.id)
        .filter(Boolean),
      note: row.customer_note || "",
    }));
  const cart = await replacePostgresCart(customerPublicId, restaurantId, lines);
  return { sourceOrderId: orderPublicId, restaurantId, cart };
}
