# Matriz de pantallas Figma, dominio y API

Fecha de control: 15 de agosto de 2026.

Esta matriz evita dos errores: implementar solamente los homes o duplicar pantallas que representan el mismo estado. El Figma manda sobre composición visual; el dominio manda sobre datos, permisos y transiciones.

Estados: `[x]` funcional y visible, `[~]` base funcional con paridad visual pendiente, `[ ]` pendiente.

## Navegacion compartida

- [x] Selector Comidas / Viajes / Envios.
- [x] Barra fija Inicio / Buscar / Actividad / Cuenta.
- [x] Actividad agrega las tres verticales.
- [~] Cuenta: identidad, libreta de direcciones CRUD con GPS, wallet, métodos tokenizados, notificaciones y soporte conversacional con SLA; faltan centralizar seguridad y favoritos en la misma vista.
- [x] Centro de notificaciones mobile, lectura persistente y preferencias push por categoría con fallback in-app.
- [x] Flash Admin: sección Envíos para configuración visual y auditable de categorías y SLA que alimentan las pantallas mobile.
- [x] Chat operacional común para comida, viajes y envíos, visible a cliente/conductor/comercio y cifrado en PostgreSQL.
- [x] Respuestas rápidas contextuales administrables por vertical y rol desde Flash Admin.

## Food Delivery App

| Estado | Pantalla/estado Figma | Dominio/API requerido |
|---|---|---|
| [~] | Splash y bienvenida | configuracion remota, sesion persistente |
| [x] | Login | auth, refresh rotativo, revocacion |
| [~] | Registro, OTP y recuperacion | registro bloqueado hasta OTP email, recuperación de un uso, SMTP y payloads cifrados listos; falta deep link universal de recuperación |
| [x] | Home con ubicacion, busqueda, categorias y abiertos | catalogo, ubicacion, disponibilidad |
| [x] | Oferta modal | promociones validadas y redimidas atómicamente en servidor |
| [x] | Busqueda y recientes | búsqueda PostgreSQL indexada, ranking difuso, debounce, paginación y filtros alimentarios propios |
| [~] | Filtros y listado por categoria | rating, ETA, delivery fee, dieta |
| [x] | Detalle del restaurante | comercio, catalogo, disponibilidad |
| [x] | Detalle de producto | hoja visual con grupos, mínimos/máximos, extras con precio, nota de cocina, dietas y advertencias de alérgenos estructuradas |
| [x] | Carrito y cantidades | carrito persistente PostgreSQL por cliente |
| [x] | Checkout completo | mobile y web seleccionan dirección PostGIS propia y pago disponible, recotizan ante cambios, muestran ETA/desglose/expiración firmados y confirman el mismo token; PSP externo pendiente de producción |
| [x] | Pedido confirmado | creación y cobro reales; confirmación visual con ID, ETA, total y seguimiento |
| [x] | Tracking del pedido | modal dedicado, mapa web MapLibre interactivo, ruta vial OSM, ETA, timeline real, conductor y posición cuando está asignado |
| [x] | Actividad/pedidos activos | API autenticada |
| [~] | Historial, recibo y pedir de nuevo | actividad, comprobante no fiscal y recompra revalidada listos; factura fiscal externa pendiente |
| [x] | Favoritos | tabla, endpoints, ownership y RLS PostgreSQL |
| [x] | Rating y soporte | ratings vinculados a jobs, tickets conversacionales y refunds |

## Lyft / Taxi Booking App

| Estado | Pantalla/estado Figma | Dominio/API requerido |
|---|---|---|
| [~] | Onboarding y permiso de ubicacion | permisos reales; paridad visual pendiente |
| [x] | Mapa y origen GPS | mobile y web usan GPS/dirección propia, OSM y estado vacío; web permite pan/zoom/reencuadre MapLibre y no precarga una ruta ficticia |
| [x] | Buscar destino y lugares frecuentes | direcciones guardadas y recientes reales por usuario, coordenadas PostGIS, geocoding, deduplicación y borrado privado |
| [x] | Ruta previa | OSRM, GeoJSON MapLibre web, renderer mobile temporal, ETA y fallback explícito sin línea inventada |
| [x] | Selector de modalidad | disponibilidad, capacidad, pickup ETA |
| [x] | Precio adelantado | breakdown, demanda, token firmado, vencimiento |
| [x] | Solicitar y asignar conductor | jobs/rides, dispatch por cercania |
| [x] | Buscando conductor | pantalla dedicada y estado PostgreSQL actualizado mientras permanece abierta |
| [x] | Conductor asignado | identidad, vehículo, rating y posición del conductor asignado |
| [x] | Conductor llegando | mapa OSM, ruta OSRM, posición vigente y progreso dedicado |
| [x] | Viaje en curso | PIN de retiro obligatorio, ruta, guía, progreso, compartir, contactos, SOS y cancelación en hoja dedicada |
| [x] | Guia paso a paso | maniobras y recálculo GPS |
| [x] | Compartir viaje/SOS/contacto | enlace temporal/revocable, SOS geolocalizado y hasta cinco contactos privados cifrados con selector mobile |
| [x] | Final, recibo, propina y rating | captura, rating, propina ledger y comprobante no fiscal persistente |
| [x] | Reserva/programacion | PostgreSQL, tarifa firmada, recordatorio, ventana dispatch y cancelación |

## Envios

- [x] Origen, destino, tipo, peso, contenido y destinatario.
- [x] Cotizacion y solicitud reales.
- [x] Asignacion, tracking, estados y PIN.
- [x] Cancelación con motivo normalizado, reintegro Wallet atómico e historial visible.
- [x] Mapa/ruta real del cliente y guía del repartidor reutilizando Routes, cache PostgreSQL y GPS.
- [x] Prueba de entrega configurable exige PIN + foto y, cuando fue contratada, firma manuscrita cifrada con identidad, consentimiento, hash, GPS, ownership, bloqueo y auditoría.
- [x] Valor declarado, protección cotizada por servidor y devolución con seguimiento de estado.
- [x] Categorías Documentos/Estándar/Frágil/Electrónica y SLA Economy/Standard/Priority/Express con límites, instrucciones, ETA y pricing PostgreSQL firmado.
- [~] Siniestros: apertura, elegibilidad contractual, evidencia cifrada, workflow, seguimiento y consola operativa reales; liquidación regulada requiere proveedor habilitado.

## Apps operativas

- [x] Portal desktop del comercio: cocina, catálogo, stock por sucursal, pausa manual, horarios semanales, excepciones, zona horaria y ETA.
- [~] App conductor: disponibilidad, GPS foreground/background, ofertas, activos, ganancias, avance y registro/revisión/activación real de vehículos; falta paridad visual fina y ensayo prolongado en dispositivos físicos.
- [x] Navegación OSRM con recálculo GPS y destino por etapa para comidas, viajes y envíos.
- [x] Documentos/KYC cifrados, vencimientos, revisión manual y bloqueo operativo del conductor.
- [x] Superadmin: metricas, actividad, zonas y auditoria base.
- [~] Consola de pagos, conciliación y riesgo transaccional explicable con excepciones, bloqueos, refunds y soporte reales; falta PSP y señales antifraude externas productivas.
