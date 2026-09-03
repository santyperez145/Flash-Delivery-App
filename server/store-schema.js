export function execSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      phone TEXT,
      wallet INTEGER NOT NULL DEFAULT 0,
      default_address TEXT,
      restaurant_id TEXT,
      driver_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, role),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      is_default INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      last4 TEXT,
      balance INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cuisine TEXT NOT NULL,
      rating REAL NOT NULL,
      distance_km REAL NOT NULL,
      eta_min INTEGER NOT NULL,
      delivery_fee INTEGER NOT NULL,
      open INTEGER NOT NULL,
      image TEXT NOT NULL,
      cover TEXT NOT NULL,
      badge TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS restaurant_hours (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      opens_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS restaurant_extras (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      rating REAL NOT NULL,
      time_min INTEGER NOT NULL,
      kcal INTEGER NOT NULL,
      stock INTEGER NOT NULL,
      image TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS menu_item_tags (
      menu_item_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (menu_item_id, tag),
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      online INTEGER NOT NULL,
      service_modes TEXT NOT NULL,
      active_service TEXT NOT NULL,
      rating REAL NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      location_label TEXT NOT NULL,
      location_updated_at TEXT,
      earnings_today INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      driver_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      plate TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL,
      FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      courier_id TEXT,
      status TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      delivery_fee INTEGER NOT NULL,
      service_fee INTEGER NOT NULL,
      total INTEGER NOT NULL,
      eta_min INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
      FOREIGN KEY (courier_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      menu_item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      note TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_item_extras (
      order_item_id TEXT NOT NULL,
      extra_name TEXT NOT NULL,
      PRIMARY KEY (order_item_id, extra_name),
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_timeline (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      driver_id TEXT,
      status TEXT NOT NULL,
      service TEXT NOT NULL,
      pickup TEXT NOT NULL,
      destination TEXT NOT NULL,
      pickup_lat REAL,
      pickup_lng REAL,
      destination_lat REAL,
      destination_lng REAL,
      distance_km REAL NOT NULL,
      eta_min INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      fare INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS ride_timeline (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL UNIQUE,
      device_name TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      template TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      push_enabled INTEGER NOT NULL DEFAULT 1,
      email_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (user_id, category),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dietary_preferences (
      user_id TEXT PRIMARY KEY,
      dietary_labels_json TEXT NOT NULL DEFAULT '[]',
      avoided_allergens_json TEXT NOT NULL DEFAULT '[]',
      hide_incompatible INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      driver_id TEXT,
      status TEXT NOT NULL,
      pickup TEXT NOT NULL,
      destination TEXT NOT NULL,
      pickup_lat REAL,
      pickup_lng REAL,
      destination_lat REAL,
      destination_lng REAL,
      recipient_name TEXT NOT NULL,
      recipient_phone TEXT NOT NULL,
      package_size TEXT NOT NULL,
      description TEXT NOT NULL,
      weight_kg REAL NOT NULL,
      delivery_notes TEXT,
      distance_km REAL NOT NULL,
      eta_min INTEGER NOT NULL,
      fare INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      delivery_pin TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (driver_id) REFERENCES drivers(id)
    );

    CREATE TABLE IF NOT EXISTS shipment_timeline (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      service TEXT NOT NULL,
      discount_percent INTEGER NOT NULL,
      active INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      priority TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      demand_level TEXT NOT NULL,
      delivery_multiplier REAL NOT NULL,
      ride_multiplier REAL NOT NULL,
      active_orders INTEGER NOT NULL,
      active_rides INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_events (
      public_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      surface TEXT NOT NULL,
      session_id TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS product_events_occurred_idx
      ON product_events(occurred_at, name);
  `);
}

export function ensureSchemaColumns(database) {
  const migrations = [
    ["drivers", "location_updated_at", "TEXT"],
    ["rides", "pickup_lat", "REAL"],
    ["rides", "pickup_lng", "REAL"],
    ["rides", "destination_lat", "REAL"],
    ["rides", "destination_lng", "REAL"],
  ];
  for (const [table, column, type] of migrations) {
    const exists = database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((entry) => entry.name === column);
    if (!exists) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
