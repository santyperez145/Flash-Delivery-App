// Lectores de entidades del respaldo SQLite (ARC-001).
//
// Reciben la conexión ya abierta: así no importan `store.js` y no hay ciclo
// ESM con `getStoreDatabase`. El caller (readDb) pasa el proxy perezoso.
const rowBool = (value) => Boolean(value);

export function readUsers(database) {
  const roles = database.prepare("SELECT user_id, role FROM user_roles").all();
  return database
    .prepare("SELECT * FROM users ORDER BY created_at")
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      password: row.password_hash,
      roles: roles.filter((role) => role.user_id === row.id).map((role) => role.role),
      phone: row.phone || "",
      wallet: row.wallet,
      defaultAddress: row.default_address || "",
      restaurantId: row.restaurant_id || undefined,
      driverId: row.driver_id || undefined,
    }));
}

export function readRestaurants(database) {
  const extras = database.prepare("SELECT * FROM restaurant_extras ORDER BY rowid").all();
  const menuRows = database.prepare("SELECT * FROM menu_items ORDER BY created_at, rowid").all();
  const tags = database.prepare("SELECT * FROM menu_item_tags").all();
  return database
    .prepare("SELECT * FROM restaurants ORDER BY rowid")
    .all()
    .map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      cuisine: row.cuisine,
      rating: row.rating,
      distanceKm: row.distance_km,
      etaMin: row.eta_min,
      deliveryFee: row.delivery_fee,
      open: rowBool(row.open),
      image: row.image,
      cover: row.cover,
      badge: row.badge,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      menu: menuRows
        .filter((item) => item.restaurant_id === row.id)
        .map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description || "",
          category: item.category,
          price: item.price,
          rating: item.rating,
          timeMin: item.time_min,
          kcal: item.kcal,
          stock: rowBool(item.stock),
          image: item.image,
          tags: tags.filter((tag) => tag.menu_item_id === item.id).map((tag) => tag.tag),
        })),
      extras: extras
        .filter((extra) => extra.restaurant_id === row.id)
        .map((extra) => ({
          id: extra.id,
          name: extra.name,
          price: extra.price,
        })),
    }));
}

export function readDrivers(database) {
  const vehicles = database.prepare("SELECT * FROM vehicles WHERE active = 1").all();
  return database
    .prepare("SELECT * FROM drivers ORDER BY rowid")
    .all()
    .map((row) => {
      const vehicle = vehicles.find((entry) => entry.driver_id === row.id);
      return {
        id: row.id,
        userId: row.user_id,
        name: row.name,
        online: rowBool(row.online),
        serviceModes: JSON.parse(row.service_modes || "[]"),
        activeService: row.active_service,
        vehicle: vehicle?.model || "",
        plate: vehicle?.plate || "",
        rating: row.rating,
        location: {
          lat: row.lat,
          lng: row.lng,
          label: row.location_label,
          updatedAt: row.location_updated_at || null,
        },
        earningsToday: row.earnings_today,
      };
    });
}

export function readOrders(database) {
  const items = database.prepare("SELECT * FROM order_items ORDER BY rowid").all();
  const extras = database.prepare("SELECT * FROM order_item_extras").all();
  const timelines = database.prepare("SELECT * FROM order_timeline ORDER BY at, rowid").all();
  return database
    .prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC")
    .all()
    .map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      restaurantId: row.restaurant_id,
      courierId: row.courier_id,
      status: row.status,
      deliveryAddress: row.delivery_address,
      paymentMethod: row.payment_method,
      items: items
        .filter((item) => item.order_id === row.id)
        .map((item) => ({
          menuItemId: item.menu_item_id,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          extras: extras
            .filter((extra) => extra.order_item_id === item.id)
            .map((extra) => extra.extra_name),
          note: item.note || "",
        })),
      subtotal: row.subtotal,
      deliveryFee: row.delivery_fee,
      serviceFee: row.service_fee,
      total: row.total,
      etaMin: row.eta_min,
      createdAt: row.created_at,
      timeline: timelines
        .filter((entry) => entry.order_id === row.id)
        .map((entry) => ({
          status: entry.status,
          at: entry.at,
        })),
    }));
}

export function readRides(database) {
  const timelines = database.prepare("SELECT * FROM ride_timeline ORDER BY at, rowid").all();
  return database
    .prepare("SELECT * FROM rides ORDER BY created_at DESC, rowid DESC")
    .all()
    .map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      driverId: row.driver_id,
      status: row.status,
      service: row.service,
      pickup: row.pickup,
      destination: row.destination,
      pickupLocation:
        row.pickup_lat == null || row.pickup_lng == null
          ? null
          : { lat: row.pickup_lat, lng: row.pickup_lng },
      destinationLocation:
        row.destination_lat == null || row.destination_lng == null
          ? null
          : { lat: row.destination_lat, lng: row.destination_lng },
      distanceKm: row.distance_km,
      etaMin: row.eta_min,
      durationMin: row.duration_min,
      fare: row.fare,
      paymentMethod: row.payment_method,
      createdAt: row.created_at,
      timeline: timelines
        .filter((entry) => entry.ride_id === row.id)
        .map((entry) => ({
          status: entry.status,
          at: entry.at,
        })),
    }));
}

export function readShipments(database) {
  const timelines = database.prepare("SELECT * FROM shipment_timeline ORDER BY at, rowid").all();
  return database
    .prepare("SELECT * FROM shipments ORDER BY created_at DESC, rowid DESC")
    .all()
    .map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      driverId: row.driver_id,
      status: row.status,
      pickup: row.pickup,
      destination: row.destination,
      pickupLocation: row.pickup_lat == null ? null : { lat: row.pickup_lat, lng: row.pickup_lng },
      destinationLocation:
        row.destination_lat == null ? null : { lat: row.destination_lat, lng: row.destination_lng },
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      packageSize: row.package_size,
      description: row.description,
      weightKg: row.weight_kg,
      deliveryNotes: row.delivery_notes || "",
      distanceKm: row.distance_km,
      etaMin: row.eta_min,
      fare: row.fare,
      paymentMethod: row.payment_method,
      deliveryPin: row.delivery_pin,
      createdAt: row.created_at,
      timeline: timelines
        .filter((entry) => entry.shipment_id === row.id)
        .map((entry) => ({ status: entry.status, at: entry.at })),
    }));
}
