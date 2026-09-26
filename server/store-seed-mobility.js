// Movilidad y pedidos demo del seed SQLite (ARC-001).
//
// Conductores, pedidos y viajes: separados del catálogo y de la cuenta demo.
export function buildSeedDrivers() {
  return [
    {
      id: "drv_lautaro",
      userId: "usr_driver",
      name: "Lautaro Mendez",
      online: true,
      serviceModes: ["delivery", "ride"],
      activeService: "delivery",
      vehicle: "Moto Honda Wave",
      plate: "A123BCD",
      rating: 4.96,
      location: { lat: -34.5886, lng: -58.4301, label: "Palermo" },
      earningsToday: 38200,
    },
    {
      id: "drv_mica",
      userId: "usr_driver",
      name: "Mica Alvarez",
      online: true,
      serviceModes: ["ride"],
      activeService: "ride",
      vehicle: "Toyota Etios",
      plate: "AD456EF",
      rating: 4.91,
      location: { lat: -34.6037, lng: -58.3816, label: "Centro" },
      earningsToday: 51700,
    },
    {
      id: "drv_nico",
      userId: "usr_driver",
      name: "Nico Pereyra",
      online: false,
      serviceModes: ["delivery"],
      activeService: "delivery",
      vehicle: "Bicicleta electrica",
      plate: "BIKE-19",
      rating: 4.82,
      location: { lat: -34.6177, lng: -58.3621, label: "San Telmo" },
      earningsToday: 18400,
    },
  ];
}

export function buildSeedOrders(createdAt) {
  return [
    {
      id: "ORD-7301",
      customerId: "usr_customer",
      restaurantId: "rest_nori",
      courierId: null,
      status: "ready_for_pickup",
      deliveryAddress: "Defensa 982, San Telmo",
      paymentMethod: "Flash Wallet",
      items: [
        {
          menuItemId: "item_salmon_furai",
          name: "Roll salmon furai",
          quantity: 1,
          unitPrice: 8200,
          extras: ["Wasabi"],
          note: "Salsa aparte",
        },
        {
          menuItemId: "item_poke_verde",
          name: "Poke verde",
          quantity: 1,
          unitPrice: 7200,
          extras: [],
          note: "",
        },
      ],
      subtotal: 15400,
      deliveryFee: 890,
      serviceFee: 520,
      total: 16810,
      etaMin: 14,
      createdAt,
      timeline: [
        { status: "accepted", at: createdAt },
        { status: "preparing", at: createdAt },
        { status: "ready_for_pickup", at: createdAt },
      ],
    },
    {
      id: "ORD-7302",
      customerId: "usr_customer",
      restaurantId: "rest_roja",
      courierId: "drv_lautaro",
      status: "delivering",
      deliveryAddress: "Defensa 982, San Telmo",
      paymentMethod: "Mastercard 7234",
      items: [
        {
          menuItemId: "item_burger_brava",
          name: "Burger Brava",
          quantity: 2,
          unitPrice: 6500,
          extras: ["Cheddar extra"],
          note: "",
        },
      ],
      subtotal: 13550,
      deliveryFee: 790,
      serviceFee: 520,
      total: 14860,
      etaMin: 11,
      createdAt,
      timeline: [
        { status: "accepted", at: createdAt },
        { status: "preparing", at: createdAt },
        { status: "ready_for_pickup", at: createdAt },
        { status: "courier_assigned", at: createdAt },
        { status: "picked_up", at: createdAt },
        { status: "delivering", at: createdAt },
      ],
    },
  ];
}

export function buildSeedRides(createdAt) {
  return [
    {
      id: "RIDE-2201",
      customerId: "usr_customer",
      driverId: "drv_mica",
      status: "arriving",
      service: "comfort",
      pickup: "Defensa 982, San Telmo",
      destination: "Aeroparque Jorge Newbery",
      distanceKm: 9.8,
      etaMin: 7,
      durationMin: 24,
      fare: 8920,
      paymentMethod: "Flash Wallet",
      createdAt,
      timeline: [
        { status: "requested", at: createdAt },
        { status: "driver_assigned", at: createdAt },
        { status: "arriving", at: createdAt },
      ],
    },
  ];
}
