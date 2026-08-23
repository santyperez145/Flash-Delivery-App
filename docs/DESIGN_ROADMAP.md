# Flash Design Roadmap

Fecha de adopción: 22 de agosto de 2026. Este documento es el contrato visual
obligatorio de Flash para Customer, Driver, Merchant, Operaciones, tracking
público y marketing. Complementa, y no reemplaza,
[`ui-layout-guidelines.md`](ui-layout-guidelines.md): este archivo define el
sistema y la cobertura; el contrato de layout define cómo debe adaptarse.

## Decisión rectora

Flash usa **Foodu** como referencia estructural principal para Comidas. Su preview
público declara más de 180 pantallas y expone un sistema amplio de navegación,
descubrimiento, catálogo, compra, actividad y cuenta. La referencia no es una
licencia para copiar: sólo se adoptan cobertura, jerarquía y patrones generales.
Colores, iconos, imágenes, textos, componentes y código son propios de Flash.

La revisión visual de los seis archivos entregados deja este reparto:

| Referencia | Cobertura observada | Uso permitido en Flash |
|---|---|---|
| [Foodu — UI Kit](https://www.figma.com/community/file/1217650860899075419/foodu-food-delivery-app-ui-kit) | preview de 180+ pantallas y múltiples familias de flujo | arquitectura principal de Customer Comidas |
| [Foodu — Preview](https://www.figma.com/design/eIhAHy1w5rFld5O6EkZxKA/Foodu---Food-Delivery-App-UI-Kit--Preview-) | mapa de pantallas, navegación, estados y componentes | auditoría de cobertura, no extracción de activos |
| [Foodie](https://www.figma.com/design/RoI15nb6aumbPqXQUJRSn1/Foodie-Food-Delivery-app-design--Community-) | 30+ pantallas, mobile simple y aireado | onboarding, búsqueda y detalle como referencia secundaria |
| [FreshGo](https://www.figma.com/design/oal5k7JncSMJ845vYlGidk/FreshGo---Food-Apps--Food-Delivery-App-UI-KIT--Community-) | home, catálogo, pedido y tracking con foco retail | kioscos, mercado y compras rápidas |
| [Foodeck](https://www.figma.com/design/C4qnks9qd7dEDmJEN9g8W6/Foodeck---Food-Delivery-iOS-Kit--Community-) | estética iOS y presentación de portfolio | ritmo visual y microcomposición, nunca cobertura rectora |
| [FoodWagon](https://www.figma.com/design/jdTkISuPcTcTjfCy3KVPvw/FoodWagon-Food-Delivery-Landing-Template-by-ThemeWagon--Community-) | landing desktop de descubrimiento | web pública y adquisición, no interfaz operacional |

No se mezclan seis lenguajes visuales en una misma pantalla. Cada entrega elige
Foodu como esqueleto, un máximo de una referencia secundaria por problema y el
sistema Flash como apariencia final.

## Contraste con producto real

Las referencias Figma aportan completitud visual; la prioridad de producto se
contrasta con fuentes oficiales vigentes:

- [DoorDash Design](https://about.doordash.com/en-us/design) confirma que un
  marketplace de tres lados necesita un sistema común para consumidores,
  comercios y repartidores, más investigación y QA de diseño.
- [DoorDash, búsqueda y compra conversacional](https://about.doordash.com/en-us/news/ask-doordash)
  prioriza llegar antes al resultado y construir el carrito con preferencias,
  presupuesto y contexto; Flash mantiene búsqueda convencional real antes de
  presentar IA como disponible.
- [DoorDash, descubrimiento personalizado](https://about.doordash.com/en-us/news/smarter-ways-for-consumers-to-explore)
  usa etiquetas, filtros, tiempos, precios y complementos de carrito. Flash adopta
  esos datos sólo cuando provienen de catálogo, inventario y pricing reales.
- [Uber Eats, estado de pedido](https://help.uber.com/ubereats/stores/article/check-the-status-of-my-order)
  ubica seguimiento en Actividad y distingue confirmación, preparación y viaje
  del courier. Flash conserva la misma claridad con su máquina de estados propia.
- [DoorDash, seguimiento](https://help.doordash.com/en-us/consumers/article/customer-where-is-my-order)
  muestra ETA, progreso, mapa y contacto sólo cuando existe un repartidor
  asignado. Flash nunca interpola una ubicación inexistente.
- [DoorDash Dasher, nuevo home](https://about.doordash.com/en-us/news/delivering-a-better-experience-for-dashers)
  prioriza mapa, disponibilidad, demanda y ganancias en Driver. La guía vial
  continúa exclusivamente en Flash Driver.

## Sistema visual Flash

### Identidad y tokens

| Token | Valor rector | Uso |
|---|---|---|
| Brand | `#7C3CFF` | identidad, foco, cuenta y acciones transversales |
| Food | `#FF6A21` | comida, restaurantes, carrito y cocina |
| Ride | `#6D35E0` | movilidad y seguridad de viaje |
| Shipment | `#087A50` | envíos, evidencia y trazabilidad |
| Ink | `#17131C` | texto dominante y CTA oscuro |
| Canvas | `#F7F5F8` | fondo de contenido |
| Surface | `#FFFFFF` | tarjetas, sheets y navegación |
| Muted | `#746E78` | texto secundario con contraste suficiente |
| Line | `#E9E5EC` | separación, nunca como única señal de estado |
| Danger | `#B42318` | riesgo, error y acciones destructivas |

- Escala espacial: `4, 8, 12, 16, 20, 24, 32, 40`.
- Radios: `12` controles; `16` cards compactas; `24` superficies; `30` sheets.
- Objetivo táctil mínimo: `44 × 44`; CTA primario: mínimo `50` de alto.
- Medios: restaurante `16:9`, producto `1:1`, avatar `1:1`; nunca deformar.
- Tipografía: stack nativo de cada plataforma hasta contar con una familia
  licenciada y empaquetada. Títulos 28/32, sección 18/24, cuerpo 14/20,
  metadata 12/16. No descargar fuentes en runtime.
- Elevación: primero contraste de superficie y borde; sombra suave sólo para
  navegación flotante, sheet, mapa o card accionable.

Cada vertical usa su acento para estado activo, pero navegación, tipografía,
espaciado, radios, sheets y feedback pertenecen a un único sistema Flash.

### Componentes obligatorios

Antes de crear una variante local, reutilizar o extender estas familias:

1. `AppShell`: safe area, viewport, fondo, scroll y navegación persistente.
2. `ServiceSwitcher`: Comidas/Viajes/Envíos; conserva estado por vertical.
3. `TopAppBar`: ubicación o contexto, título variable y acciones 44 × 44.
4. `SearchField`: valor, limpiar, loading, error, filtros y teclado correcto.
5. `CategoryRail` y `FilterChips`: scroll explícito, selección accesible y datos
   provenientes del catálogo.
6. `PromotionBanner`: sólo campañas activas y aplicables; nunca un cupón de
   demostración ni modal forzado al iniciar.
7. `MerchantCard` / `ProductCard`: media sin deformar, nombre, categoría,
   disponibilidad, precio/fee y ETA verificables.
8. `StatusCard`: loading, empty, error, offline, stale y retry conservando el
   mismo esqueleto.
9. `BottomNavigation` / `DesktopSidebar`: destinos superiores estables.
10. `BottomSheet`: una tarea, handle/cierre, scroll interno y CTA seguro.
11. `QuoteSummary` / `CheckoutSummary`: desglose autoritativo, vencimiento,
    método de pago y condición que bloquea confirmar.
12. `MapContext`: mapa interactivo más alternativa textual; cockpit únicamente
    para Driver.

## Roadmap de pantallas

Leyenda: `[x]` cubierta y verificada; `[~]` funcional con rediseño pendiente;
`[ ]` pendiente. Un check de pantalla exige datos reales, loading, empty, error,
offline, texto largo, compact/medium/expanded y accesibilidad; un proveedor o
prueba física pendiente conserva `[~]`.

### Customer — Comidas y compras

- [~] Inicio: ubicación, búsqueda, campaña aplicable, categorías de catálogo,
  favoritos, comercios abiertos, cerrado/vacío y carga.
- [x] Buscar: categorías reales, resultados, paginación, skeleton, sin
  coincidencias y fallo recuperable; historial todavía no se presenta sin persistencia.
- [~] Restaurante: hero 16:9, información, disponibilidad por sucursal,
  categorías de menú, producto, favoritos y carrito persistente.
- [~] Producto: detalle, modificadores, alérgenos, nota, stock y límites.
- [~] Carrito/checkout: líneas, edición, dirección geocodificada, pago tokenizado,
  cupón real, quote firmada, caducidad, total y confirmación.
- [~] Actividad/tracking: lista unificada, timeline, mapa, courier real, chat,
  soporte, recibo y volver a pedir.
- [~] Cuenta: perfil, direcciones, pagos, preferencias, notificaciones, soporte,
  seguridad, referidos y sesiones.
- [ ] Grocery/kiosco: sustituciones, peso variable, lista extensa y ventanas de
  entrega; no adaptar visualmente hasta cerrar contratos funcionales.

### Customer — Viajes y Envíos

- [~] Viajes: origen/destino, búsqueda, opciones, quote, confirmación, matching,
  viaje activo, seguridad, cancelación, recibo y estados de proveedor.
- [~] Envíos: pickup/destino, destinatario, categoría, tamaño/peso, protección,
  quote, confirmación, tracking, PIN, evidencia, devolución y siniestro.
- [~] Paridad visual completa con el sistema Flash y referencias Lyft previas;
  habilitación pública continúa bloqueada por safety/operación.

### Driver

- [~] Login/recuperación y compliance.
- [~] Home mapa: offline/online, demanda, oferta, trabajo activo y próxima acción.
- [~] Cockpit y guía: maniobra, ETA, etapa, chat, seguridad y handoff externo.
- [~] Ganancias: día/semana, jornada, ledger, detalle y retiro no configurado.
- [~] Inbox, cuenta, vehículo, documentos y preferencias.

### Merchant mobile y desktop

- [~] Acceso, selección de comercio y estado de apertura.
- [~] Hoy: venta, ticket, SLA, cola, stock y última lectura.
- [~] Pedidos: tickets, detalle, preparación, faltante, sustitución y chat.
- [~] Catálogo: menú, modificadores, dieta, stock, sucursal y horarios.
- [~] Finanzas, payout, conexión PSP, cuenta y soporte.
- [~] Desktop responsive con sidebar, densidad operativa y detalle contextual.

### Operaciones, tracking público y marketing

- [~] Operaciones: recursos, mapas, soporte, riesgo, conciliación, pricing,
  promociones, zonas, auditoría y configuración con permisos reales.
- [~] Tracking público: token temporal, estado, ETA y revocación.
- [ ] Marketing desktop: adoptar jerarquía FoodWagon con propuesta Flash,
  cobertura real, comercios, seguridad y CTA; no inventar ciudades o métricas.

## Secuencia de ejecución

### P0 — coherencia del producto que ya funciona

- [~] Materializar tokens compartidos: React Native ya usa el contrato versionado;
  web continúa pendiente de migrar al mismo vocabulario.
- [~] Rediseñar Home/Buscar/Restaurante/Producto/Carrito/Checkout de Comidas:
  Home ya adoptó la nueva jerarquía; el resto continúa abierto.
- [~] Eliminar promociones, categorías, recents, fees, ETA y estados visuales
  hardcodeados cuando exista contrato backend.
- [~] Consolidar cards, app bars, chips, sheets, estados y navegación: Home de
  Comidas ya consume tokens y componentes locales; falta extraer familias comunes.
- [ ] Completar la misma base en Actividad, Cuenta, Viajes y Envíos.

### P1 — apps operativas

- [ ] Aplicar el sistema a Driver, Merchant mobile y Merchant desktop sin reducir
  densidad ni ocultar hechos críticos.
- [ ] Aplicar el sistema a Operaciones y tracking público.
- [ ] Cubrir skeleton, empty, error, offline, stale, retry y permisos denegados.

### P2 — profundidad competitiva

- [ ] Grocery/kiosco y sustituciones de compra extensiva.
- [ ] Búsqueda personalizada sólo con telemetría, consentimiento y evaluación.
- [ ] Marketing desktop y onboarding ilustrado propios.
- [ ] Capturas doradas en CI reproducible luego de estabilizar componentes.

## Definición de terminado visual

Una pantalla sólo pasa a `[x]` cuando:

1. Consume contratos reales y no presenta un CTA sin efecto.
2. Cubre loading, empty, error, offline, stale y éxito sin saltos de layout.
3. Pasa 320×568, 390×844, 768×1024, 1024×768 y 1440×900 cuando aplica.
4. Tolera texto largo, teclado, orientación, safe areas y Dynamic Type.
5. Respeta 44 × 44, contraste, foco, labels y orden de lectura.
6. Una prueba automatizada protege el contrato y una revisión visual inspecciona
   los estados relevantes.
7. Las capacidades nativas críticas se prueban en build físico antes de cerrar.
8. Roadmap y deuda de proveedor/operación se actualizan en el mismo commit.

## Registro de ejecución

### 22 de agosto de 2026 — Home de Comidas P0

- La campaña visible viene de `GET /api/promotions`; si no existe una campaña
  activa de Comidas, el banner no aparece.
- Categorías, imágenes, cantidades, comercios, ETA, costo de envío, distancia y
  rating se derivan del catálogo. Se retiraron categorías/recents decorativos y
  URLs externas fijadas en el componente.
- Favoritos leen la cuenta autenticada y persisten mediante
  `PUT /api/favorites/:restaurantId`; el control expone loading y no simula éxito.
- El modal promocional forzado, su texto en inglés y el cupón ficticio fueron
  eliminados. La promoción real vive en el flujo y transfiere su código al
  checkout cuando corresponde.
- Media 16:9, cards, app bar, ubicación, búsqueda, categorías, favoritos, empty y
  navegación usan los primeros tokens React Native de Flash.
- Continúan `[~]`: restaurante, producto, carrito y checkout necesitan el mismo
  rediseño antes de cerrar el flujo completo.

### 22 de agosto de 2026 — Buscar y Restaurante P0

- Buscar usa el endpoint paginado de catálogo tanto vacío como con consulta;
  categorías e imágenes provienen de los comercios abiertos y el error permite
  reintentar la misma operación.
- Skeleton, sin coincidencias, error, resultados, coincidencias de menú, fee y
  ETA conservan una composición estable sin inventar búsquedas recientes.
- Restaurante deriva tabs de las categorías del menú, descripción, precio,
  dieta y stock del catálogo. Se retiraron `Popular/Combos/Bebidas` y la
  descripción genérica que hacían pasar contenido visual por dato real.
- El hero 16:9, disponibilidad, campaña, dirección, rating, tiempo, distancia,
  fee, favorito persistente y carrito forman una jerarquía única.
- Menú vacío/filtrado, agotado y add deshabilitado son estados explícitos. Sigue
  pendiente verificar disponibilidad horaria por sucursal en el detalle y
  rediseñar personalización, carrito y checkout.
