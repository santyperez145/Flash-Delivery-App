# Investigacion competitiva

Fecha de investigacion: 14 de agosto de 2026.

Objetivo: definir el alcance funcional minimo para que Flash Delivery Mobility no sea una maqueta, sino una plataforma operable tipo Uber, Uber Eats, PedidosYa y DoorDash, con cliente, comercio, conductor/repartidor y operaciones.

## Fuentes consultadas

- Uber Driver App: https://www.uber.com/us/en/drive/driver-app/
- Uber Price Estimate: https://www.uber.com/global/en/price-estimate/
- Uber Platform: https://www.uber.com/
- Uber Eats Google Play: https://play.google.com/store/apps/details?id=com.ubercab.eats
- PedidosYa App Store: https://apps.apple.com/us/app/pedidosya-food-delivery/id490099807
- DoorDash merchant real-time features: https://about.doordash.com/en-us/news/doordash-empowers-merchants-with-new-real-time-features
- Uber delivery work guide 2026: https://www.uber.com/us/en/blog/best-delivery-app-to-work-with/

## Lectura del mercado

Uber ya no compite solo como app de viajes. Su posicionamiento combina movilidad, delivery y casos empresariales. La propuesta para conductores tambien cruza viajes y entregas: el conductor puede ganar con deliveries o rides, elegir horarios, ver oportunidades y usar herramientas de navegacion y seguridad.

Uber Eats y PedidosYa compiten por frecuencia. La app debe permitir descubrir restaurantes y tiendas, buscar por plato/local/categoria, personalizar productos, pagar con varios metodos, programar pedidos, hacer pickup, seguir el estado en vivo, recibir notificaciones y resolver problemas desde soporte.

DoorDash muestra que el comercio no puede ser un panel secundario. Los locales necesitan manejo de pedidos en tiempo real, ajuste de tiempos de preparacion, stock, tickets claros, chat con clientes/repartidores y acciones rapidas desde celular o tablet.

La documentacion oficial de DoorDash Merchant confirma una expectativa mas alta para la operacion: live orders, ajustes de prep time, disponibilidad del local, productos agotados, refunds/substitutions, reportes, campanas y conexiones POS. Esto define la brecha de Flash para el siguiente sprint, no como una lista cosmetica sino como capacidades que reducen cancelaciones y trabajo manual.

Para repartidores y conductores, la utilidad real depende de tres cosas: ver ganancia estimada antes de aceptar, conocer origen/destino/distancia, y poder avanzar el trabajo con estados claros. Uber tambien empuja oportunidades, promociones, recompensas, tasas de aceptacion/cancelacion y modos como Destination Mode.

## Requisitos derivados

Cliente:
- Alternar entre comida y taxi sin salir de la app.
- Buscar restaurantes, categorias y platos.
- Crear carrito por comercio, elegir extras, notas y checkout.
- Cotizar viajes por origen, destino y tipo de servicio.
- Confirmar viaje con conductor asignado cuando exista disponibilidad.
- Ver tracking de pedidos y viajes.
- Cancelar solicitudes activas.
- Wallet, promociones, metodos de pago y direcciones guardadas.

Comercio:
- Abrir o pausar local.
- Ver pedidos por estado.
- Avanzar cocina: aceptado, preparando, listo para retirar.
- Gestionar stock.
- Crear nuevos productos.
- Ajustar tiempos de preparacion.
- Base preparada para chat y tickets.

Conductor/repartidor:
- Online/offline.
- Elegir modo delivery o taxi.
- Ver ofertas con monto, distancia, origen/destino.
- Aceptar delivery o viaje.
- Avanzar estados: asignado, retirado, en camino, entregado; o asignado, llegando, en viaje, completado.
- Ver ganancias, vehiculo, patente, rating y zona.

Operaciones:
- Ver demanda por zona.
- Medir pedidos activos, viajes activos, drivers online, locales abiertos y tickets.
- Avanzar o corregir estados.
- Reiniciar demo, auditar eventos y observar soporte.

## Diferenciadores propuestos

- Un solo driver puede trabajar como conductor o repartidor, con cambio de modo.
- Un mismo cliente pide comida o taxi desde la misma experiencia.
- La base de datos modela wallet, pagos, roles, vehiculos, zonas, ratings y auditoria desde el inicio.
- El panel operativo no es decorativo: lee pedidos/viajes reales y puede intervenir.
- El comercio puede actuar desde mobile, siguiendo el patron de live order management.

## Lo que falta para competir en produccion

Este repo ya tiene MVP funcional fullstack, pero para competir comercialmente faltan integraciones reales:
- Mapas y geocoding: Google Maps, Mapbox o HERE.
- Calculo real de rutas, ETA y distancia.
- Pagos: Mercado Pago, Stripe o proveedor local.
- Push notifications: Firebase Cloud Messaging o similar.
- WebSockets para tracking en vivo sin polling.
- Autenticacion con refresh tokens, sesiones y permisos por rol.
- Backoffice antifraude, soporte multiagente y conciliacion financiera.
- Apps nativas o PWA instalable con permisos de ubicacion.
- Observabilidad: logs estructurados, metricas y alertas.

## Matriz de paridad para los siguientes sprints

Flash ya cubre parte del nucleo operativo: pedidos y viajes persistidos, estados de cocina, stock, disponibilidad, realtime SSE, cotizacion por coordenadas, tracking foreground y asignacion inicial por cercania.

La prioridad competitiva siguiente es cerrar el circuito de excepciones y dinero:

1. Comercio: marcar agotados por producto, proponer sustituciones, ajustar preparacion y abrir un ticket trazable.
2. Cliente: aceptar sustitucion, cancelar con reglas, pedir reembolso y recibir push por cada cambio.
3. Operaciones: aprobar/refutar reembolsos, ver SLA, intervenir una orden y auditar el resultado.
4. Plataforma: conectar geocoding/routing, pagos sandbox, POS y ledger antes de escalar adquisicion.

Referencias oficiales usadas para esta comparacion:

- [DoorDash Business Manager](https://merchants.doordash.com/en-us/learning-center/business-manager-app)
- [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/merchant-portal)
- [DoorDash real-time merchant features](https://about.doordash.com/en-us/news/doordash-empowers-merchants-with-new-real-time-features)

## Benchmark visual y de experiencia aplicado

Revision adicional: 14 de agosto de 2026.

Patrones adoptados sin copiar marca ni recursos de terceros:

- Uber Eats: descubrimiento primero, atajos de categorias, filtros rapidos, recomendaciones, volver a pedir y tracking compartible.
- Uber: origen y destino como accion principal, costo/ETA antes de confirmar y seguridad accesible durante todo el viaje.
- Lyft: modalidades comparables por espera, capacidad y precio; destinos frecuentes visibles antes de escribir.
- Rappi/PedidosYa: verticales separadas, promociones de alta visibilidad, comercios por cercania y estado de entrega entendible.
- DoorDash: estados operativos, disponibilidad, stock y tiempos de preparacion accionables para el comercio.

Decisiones de interfaz para Flash:

1. Mantener Comidas, Viajes y Envios como ventanas claras dentro de una misma identidad.
2. Contener la experiencia cliente a un ancho mobile y usar carruseles horizontales para evitar grillas rotas.
3. Mostrar siempre contexto antes de la accion: direccion, ETA, tarifa, disponibilidad y restricciones.
4. Evitar datos tecnicos o estados crudos en UI; cada estado necesita etiqueta, color, proxima accion y ayuda.
5. Diseñar primero estados angostos, vacios, loading, error, offline y contenido largo.
6. Introducir progresivamente favoritos, pedir de nuevo, filtros, pedidos grupales, programacion y multi-comercio solo con soporte real de backend.

Fuentes oficiales adicionales:

- [Nuevo descubrimiento de Uber Eats](https://www.uber.com/us/en/newsroom/arriving-now-the-new-uber-eats/)
- [Pedidos grupales de Uber Eats](https://www.uber.com/us/en/business/solutions/eats/group-ordering/)
- [Pedidos multi-comercio de Uber Eats](https://www.uber.com/us/en/newsroom/multi-store-ordering/)
- [Seguridad de Uber](https://www.uber.com/us/en/safety/)
- [Modalidades de viaje de Lyft](https://help.lyft.com/hc/en-ca/all/articles/115012927427-Lyft-ride-modes-overview)
- [Live Order Tracking FAQ de Uber Eats](https://help.uber.com/en/merchants-and-restaurants/article/live-order-tracking---faq?nodeId=d006582e-113f-4423-9d33-e938de34b3a2)
- [Support de Uber Eats](https://help.uber.com/merchants-and-restaurants/article/support?nodeId=a467254f-b6b2-4e11-a88b-d96653ca1f81)

## Pricing y rutas competitivas

El cotizador de movilidad adopta el patron de precio adelantado: el servidor combina distancia y duracion previstas, modalidad, oferta/demanda, tarifa de servicio y peajes estimados. La cotizacion se firma y conserva durante cinco minutos; al solicitar, la API valida el token para impedir que el cliente modifique el precio.

La navegacion separa dos responsabilidades, como recomiendan los proveedores de mapas: matriz/estimacion para comparar alternativas y ruta detallada para polyline y maniobras. Flash usa OSRM/OpenStreetMap en desarrollo y deja los proveedores configurables para migrar a trafico predictivo, peajes y SLA comercial.

### Decisión 22 de agosto de 2026 — tracking web de pedidos

La referencia oficial de Uber Eats confirma que el cliente espera progreso y ubicación del repartidor durante la entrega, pero que esa visibilidad depende de señales reales del comercio/repartidor; también ubica la ayuda dentro de la ventana de tracking o del historial. Por eso la PWA web de Flash ahora abre un seguimiento dedicado desde Actividad, consume la ruta autenticada existente, muestra el repartidor sólo cuando el backend lo asignó y conserva timeline/ETA cuando el proveedor de mapas no responde. No se agregó una posición interpolada ni un enlace público ficticio.

- [Precio adelantado de Uber](https://www.uber.com/us/en/ride/how-it-works/upfront-pricing/)
- [Google Routes: matriz de distancia y duracion](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [Google Routes: trafico, peajes y rutas detalladas](https://developers.google.com/maps/documentation/routes/reference/rpc/google.maps.routing.v2)
