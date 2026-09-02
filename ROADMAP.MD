# Flash Delivery App Roadmap

> Lineamiento obligatorio para cada entrega: [`docs/product-execution-guidelines.md`](docs/product-execution-guidelines.md). Define investigación competitiva, segmentación, cero hardcodeos productivos, calidad visual, arquitectura, seguridad y definición de terminado.

## Roadmap rector adoptado — 21 de agosto de 2026

Fuente de producto: `C:\Users\santiago\Desktop\FlashAPP.txt`. Se adopta su estrategia **delivery/courier primero, B2B después y movilidad pública sólo tras safety y habilitación local**. La auditoría describe una versión anterior; sus EPICs se mantienen, pero estos checks reflejan el runtime actual y sustituyen sus puntuaciones históricas.

Leyenda: `[x]` verificado localmente, `[~]` operativo con deuda concreta, `[ ]` pendiente o dependiente de proveedor/operación externa.

## Decisión 2 de septiembre de 2026 — staging cloud y base managed (bloqueo dueño)

Pedido: desplegar donde haga falta y alojar en una DB próspera/escalable.

- [x] **Stack ya decidido (28-08):** Google Cloud `southamerica-east1` — Cloud SQL PostgreSQL 17 + PostGIS, Memorystore Redis, Cloud Run (imagen del `Dockerfile`), CDN para la PWA. Detalle en [`docs/despliegue.md`](docs/despliegue.md). Es la paridad operativa con Uber/DoorDash (Postgres geoespacial managed + API en contenedor), no serverless.
- [x] **Qué NO se usa:** Vercel/Netlify para la API (SSE + `LISTEN/NOTIFY` no caben); Neon pooled / Railway sin región SA (latencia BA↔Virginia y trampas de pooler). Autenticación Vercel MCP en esta sesión: sin teams/proyectos; irrelevante para el runtime.
- [ ] **Bloqueo externo (dueño):** crear proyecto GCP, facturación, secretos en Secret Manager y ejecutar el runbook de `docs/despliegue.md`. En esta máquina no hay Docker ni `gcloud`. Sin cuenta no hay URL de staging ni columnas `PROV`/`STG`/`PROD`.
- [~] Competencia ya opera PostGIS managed. Flash tiene imagen, esquema y decisión; falta la cuenta de nube.

## Decisión 2 de septiembre de 2026 — competir como Uber/DoorDash sin romper Fase 0

Mandato del dueño: libertad total de actuar (CEO/CTO/CFO/PM/PO/inversor) y adoptar la mejor tecnología de la competencia.

- [x] **Lectura operativa:** durante Fase 0 (hasta 20/09/2026) “igual que la competencia” significa su **barra de ingeniería** —dominio compartido, consolas por responsabilidad, CI bloqueante, RLS, degradación honesta— no copiar verticales, pantallas nuevas ni providers productivos sin credenciales.
- [x] **Qué se implementa ahora:** P0 de [`docs/backlog-tecnico.md`](docs/backlog-tecnico.md), empezando por ARC-001 (modularización + contratos). Cada entrega declara contra qué se comparó y dónde Flash sigue por debajo.
- [ ] **Candidatas post-Fase 0 (no se implementan aún):** FCM/APNs directos, microservicios/Kubernetes HPA, Redis administrado, WebSockets productivos, IA de producto, dinero productivo Mercado Pago, apps EAS en stores. Bloqueo: dueño (credenciales, gasto, dispositivos, staging).
- [~] Uber/DoorDash ya operan esas capas en producción. Flash las tiene como deuda nombrada; fingirlas en Fase 0 empeora la métrica de la auditoría.

## Avance 2 de septiembre de 2026 — ARC-001, partir paneles de soporte del backoffice

- [x] `AdminSupportPanels` (~563) se parte en respuestas rápidas, dead letters y operaciones/SLA; el archivo original queda como reexport.
- [~] Zendesk / Uber Support aíslan canned replies, deliveries y mesa. Flash ahora también; sigue por debajo sin techo CI ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, partir paneles de dinero del backoffice

- [x] `AdminFinancePanels` (842) se parte en `AdminPricingGovernance`, `AdminPayoutReview`, `AdminTipAdjustment` y `AdminPaymentReconciliation`; el archivo original queda como reexport.
- [~] Stripe Atlas / Uber Finance aíslan gobernanza, retiros, propinas y conciliación. Flash ahora también; sigue por debajo sin techo CI ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, overview admin + hook de turno driver

- [x] Resumen operativo vive en `AdminOverviewHome.tsx`; `AdminConsole` queda como shell de nav (~280).
- [x] GPS/ofertas/evidencia/ruta del conductor viven en `useDriverShift.tsx`; `DriverScreen` queda como cockpit (~220). Marcador de variante sigue en `DriverScreen` (`Ubicacion GPS`).
- [~] Uber Ops / Uber Driver separan command center y turno del shell. Flash ahora también; sigue por debajo sin techo CI de archivos ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Decisión 2 de septiembre de 2026 — mandato competitivo permanente

- [x] Lineamiento del dueño formalizado en `AGENTS.md`, `docs/product-execution-guidelines.md` §0 y `.cursor/rules/competitive-mandate.mdc` (`alwaysApply`): roles CEO/CTO/CFO/PM/PO/inversor, comparar siempre, mejor tecnología medida, libertad para el bien del producto.
- [x] En Fase 0 se interpreta como paridad de ingeniería/operación (no verticales nuevas ni providers fingidos). Gasto y cuentas cloud siguen siendo del dueño.

## Avance 2 de septiembre de 2026 — ARC-001, release/pricing/infra fuera de AdminConsole

- [x] Producto, tarifas y ruta de infra viven en `AdminReleaseControls.tsx`; `AdminConsole` queda como shell de nav + overview/claims.
- [~] DoorDash/Uber aíslan launch controls y surge. Flash ahora también; sigue por debajo sin techo CI del archivo ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, finanzas e inversión fuera de AdminConsole

- [x] Snapshot de ledger/GMV vive en `AdminFinanceOverview.tsx`; readiness/unit economics/funnel en `AdminInvestorPanels.tsx`; `AdminConsole` queda como shell de navegación.
- [~] Uber Finance / dashboards seed aíslan dinero e inversión. Flash ahora también; sigue por debajo sin techo CI del archivo ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, marketplace ops fuera de AdminConsole

- [x] Dispatch, comercios y supply de drivers viven en `AdminMarketplacePanels.tsx`; `AdminConsole.tsx` baja a ~499 como shell de navegación/orquestación.
- [~] Uber Ops / DoorDash Drive aíslan asignación y oferta. Flash ahora también en módulos propios; sigue por debajo sin techo CI del archivo ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, contratos compartidos lote 2

- [x] `ServiceQuickReply`, `ShipmentClaim` y `DispatchOffer` viven en `@flash/domain-contracts` (23 tipos compartidos); web y mobile los reexportan; `MerchantOperationsDashboard` sigue local por `Restaurant` divergente.
- [~] DoorDash/Uber mantienen un SDK de dominio único. Flash avanza el lote idéntico; sigue por debajo en los 17 tipos aún divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, home operativo fuera de DriverScreen

- [x] Disponibilidad, demanda, trabajo activo, jobs y ofertas viven en `DriverHomePanel.tsx` (~652); `DriverScreen.tsx` bajó a ~569 como shell de GPS/modales/pestañas.
- [~] Uber Driver separa el mapa/home del resto del cockpit. Flash ahora también; sigue por debajo sin techo CI del archivo ni unificar tipos divergentes.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes y 251 líneas largas SQL.

## Avance 2 de septiembre de 2026 — ARC-001, inbox y tarjetas fuera de DriverScreen

- [x] Inbox (chats + novedades) vive en `DriverInboxPanel.tsx` (~148); viaje/envío en `DriverJobCards.tsx` (~96); `DriverScreen.tsx` bajó a ~1.098.
- [~] Uber Driver aísla comunicaciones y cards del cockpit. Flash ahora también; sigue por debajo sin techo CI del archivo ni el corte residual del home operativo.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y home residual de DriverScreen.

## Decisión 2 de septiembre de 2026 — no cablear “uso real absoluto” ni IA de producto en Fase 0

Pedido del dueño: cablear absolutamente todo para uso real, con automatizaciones e IA, e instalar dependencias externas si hiciera falta.

- [x] Medición previa: `test:api-wiring` marca **0 rutas huérfanas** (201 expuestas · 194 literales · 12 consumidores externos declarados). El cableado código↔API ya está cerrado.
- [x] Matriz de madurez: **`PROV` = 0, `STG` = 0, `PROD` = 0**. Lo que falta para “uso real” no es superficie nueva: son credenciales, dispositivos y un entorno desplegado.
- [x] **No se implementa** en Fase 0 (congelamiento hasta 20/09/2026): verticales nuevas, pantallas nuevas, agentes/IA de producto, “automatizaciones” que presenten mocks o sandboxes como capacidad productiva.
- [x] **Sí se mantiene** el flujo de ingeniería: PR → CI → squash-merge → borrado automático de rama (`delete_branch_on_merge=true` en GitHub desde esta fecha).
- [ ] Candidata **post-Fase 0**: automatizaciones de producto con IA (asignación, soporte, fraud assist, ops copilots) sólo tras `PROV` en pagos/push/mapas y con proveedor + presupuesto nombrados.
- [ ] Habilitación productiva — **bloqueo externo del dueño** (sin esto no hay `PROV`):
  1. `NOTIFICATION_PROVIDER=expo` + `EXPO_ACCESS_TOKEN` + EAS + Android/iOS físicos (NOT-001).
  2. `MAPS_PROVIDER=google` + `GOOGLE_MAPS_SERVER_API_KEY` (+ claves Android/iOS restringidas) (GEO-001).
  3. Mercado Pago app + sellers de prueba + webhook reachable (PAY-001; ticket Fase 1).
  4. Twilio Verify si SMS productivo (hoy sandbox).
  5. SMTP real si email productivo (hoy sandbox).
  6. Hosting/staging con secretos, dominio HTTPS y planificador de conciliación (no hay producción todavía).

## Avance 2 de septiembre de 2026 — ARC-001, tableros overview fuera de AdminConsole

- [x] Salud, investor pulse, funnel, riesgos, zonas, grillas live e infra viven en `AdminOverviewBoards.tsx` (~307); `AdminConsole.tsx` bajó a ~582 y queda como orquestador de secciones.
- [~] Paneles admin de Uber/DoorDash separan dashboard widgets del shell. Flash ahora también; sigue por debajo sin techo CI del archivo ni el corte residual de home/inbox en DriverScreen.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y home residual de DriverScreen.

## Avance 2 de septiembre de 2026 — ARC-001, paneles de confianza fuera de AdminConsole

- [x] Legajo de conductores, moderación de usuarios y MFA administrativo viven en `AdminTrustPanels.tsx` (~458); `AdminConsole.tsx` bajó de ~1.330 a ~871 sin cambiar secciones ni APIs.
- [~] Uber/DoorDash separan trust & safety del cockpit. Flash ahora tiene módulo propio; sigue por debajo sin techo CI del archivo ni el corte de tableros overview residuales.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y tableros overview residuales en AdminConsole / home residual de DriverScreen.

## Avance 2 de septiembre de 2026 — ARC-001, cuenta y ganancias fuera de DriverScreen

- [x] Preferencia de navegación, legajo/flota viven en `DriverAccountPanel.tsx` (~525); ledger/jornada en `DriverEarningsPanel.tsx` (~409); `DriverScreen.tsx` bajó de ~2.155 a ~1.320 y queda bajo el techo de 1.500.
- [~] Uber Driver y DiDi aíslan earnings/account del cockpit. Flash ahora tiene paneles propios; sigue por debajo sin techo CI del archivo ni el corte residual de home/inbox.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL, seguridad/moderación residual en AdminConsole y home residual de DriverScreen.

## Avance 2 de septiembre de 2026 — ARC-001, paneles de soporte fuera de AdminConsole

- [x] Respuestas rápidas, dead letters y operaciones de agentes/SLA viven en `AdminSupportPanels.tsx` (~553 líneas); `AdminConsole.tsx` bajó a ~1.365 y queda bajo el techo de 1.500 del criterio ARC-001.
- [~] Zendesk y PedidosYa separan cola/SLA de la consola general. Flash ahora tiene módulo propio; sigue por debajo sin techo CI del archivo ni el corte de seguridad/moderación residual.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL, seguridad/moderación residual en AdminConsole y `DriverScreen` residual.

## Avance 2 de septiembre de 2026 — ARC-001, paneles de envíos fuera de AdminConsole

- [x] Siniestros protegidos y configuración de categorías/SLA viven en `AdminShipmentPanels.tsx` (~511 líneas); `AdminConsole.tsx` bajó de ~2.381 a ~1.879 sin cambiar secciones ni APIs.
- [~] PedidosYa Courier y Uber Direct separan claims/SLA del cockpit admin. Flash ahora tiene módulo propio; sigue por debajo sin techo CI del archivo ni el corte de soporte/seguridad residual.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y concentraciones residuales (`AdminConsole`, `DriverScreen`).

## Avance 2 de septiembre de 2026 — ARC-001, modales operativos fuera de DriverScreen

- [x] Guía giro a giro y captura de firma viven en `DriverDeliveryModals.tsx` (~342 líneas); `DriverScreen.tsx` bajó de ~2.471 a ~2.155 sin cambiar APIs ni flujo del turno.
- [~] Uber Driver y DiDi aíslan navegación y evidencia de entrega del cockpit. Flash ahora tiene módulo propio; sigue por debajo sin techo CI del archivo ni el corte residual de tarjetas/estado.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y concentraciones restantes (`AdminConsole` residual, `DriverScreen` residual).

## Avance 2 de septiembre de 2026 — ARC-001, paneles de dinero fuera de AdminConsole

- [x] Tarifas, payouts, propinas y conciliación viven en `AdminFinancePanels.tsx` (~841 líneas); `AdminConsole.tsx` bajó de ~3.216 a ~2.400 sin cambiar secciones ni APIs.
- [~] Uber Eats Manager y DoorDash Merchant Portal separan dinero operativo de la consola general. Flash ahora aísla esos paneles en módulo propio, pero sigue por debajo sin techos de archivo en CI para backoffice ni el siguiente corte de `DriverScreen`.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y concentraciones restantes (`AdminConsole` residual, `DriverScreen`).

## Avance 2 de septiembre de 2026 — ARC-001, contratos compartidos idénticos

- [x] 20 tipos byte-a-byte idénticos y autocontenidos entre web y mobile viven en `packages/domain-contracts` (`@flash/domain-contracts`); `src/types.ts` y `apps/mobile/src/types.ts` los importan y reexportan sin redefinir el cuerpo.
- [x] `MerchantOperationsDashboard` permanece local: su texto era idéntico, pero referencia `Restaurant`, que diverge entre superficies.
- [x] Root y mobile declaran la dependencia `file:`; Metro observa el paquete; `test:domain-contracts` bloquea el merge junto a typecheck web/móvil.
- [~] Uber Eats y DoorDash mantienen un modelo de dominio único entre superficies. Flash comparte el núcleo idéntico, pero sigue por debajo sin unificar User/Order/Restaurant ni el resto de divergencias reales.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y concentraciones restantes (AdminConsole, DriverScreen).

## Avance 2 de septiembre de 2026 — ARC-001 pendiente y cierre de IDOR de soporte

- [x] Se integró lo que `codex/reflow-catalog-search-sql` no llegó a `main`: SQL de catálogo/búsqueda refloweado y editores de comercio extraídos a `MerchantCatalogEditors.tsx`.
- [x] Un agente `support` ya no puede editar el perfil de otro (`canManageSupportAgent`), lee la cola de tickets y un bootstrap propio, y no enumera usuarios ni el dashboard admin. `test:security` y `test:authorization` lo cubren.
- [~] PedidosYa y Zendesk separan cola de tickets de administración de agentes. Flash ahora niega el IDOR, pero sigue por debajo sin SLA visible al cliente, asignación automática medida y portal self-serve del ticket.
- [ ] ARC-001 global sigue abierto: unificar tipos divergentes, 251 líneas largas SQL y concentraciones restantes (AdminConsole, DriverScreen).

## Avance 30 de agosto de 2026 — ARC-001, Navegación cliente web con límite propio

- [x] Selector Comida/Taxi/Envíos y barra Inicio/Actividad/Wallet/Perfil viven en `CustomerNavigation.tsx` (85 líneas); `CustomerSurface.tsx` bajó de 459 a 360 líneas y quedó como coordinador de estado/composición.
- [x] Los flags reales `public_rides` y `shipment_beta` siguen gobernando la disponibilidad. Un fallo al cargar flags no se interpreta como decisión de apagar producto, y la navegación inferior conserva las cuatro tareas estables entre verticales.
- [x] Se eliminó la importación lazy muerta de `FlashMap`; los mapas permanecen en las superficies que realmente los renderizan. `test:responsive-layout` fija techos 375/95 y exige flags, Actividad y composición fuera del coordinador.
- [x] Build, contratos, 201 rutas cableadas y matriz Chromium completa permanecen verdes; cliente, comercio y operaciones se recorren desde 320 × 568 hasta 1.440 × 900.
- [~] Uber reutiliza una identidad entre Rides y Eats y expone Courier/Actividad dentro de la app. Flash comparte cuenta y actividad entre sus tres servicios, pero sigue por debajo sin elegibilidad productiva por mercado, explicación visible de indisponibilidad, telemetría de navegación ni validación física de deep links/push.
- [x] La segmentación interna del cliente web queda cerrada con responsabilidades y ratchets propios.
- [ ] ARC-001 global sigue abierto: quedan el paquete de contratos compartidos y 256 líneas largas heredadas —255 SQL— contenidas por trinquete; no se declaran resueltas por este corte.

## Avance 30 de agosto de 2026 — ARC-001, Home y descubrimiento web fuera del coordinador

- [x] Home, búsqueda, categorías, restaurantes, productos destacados, beneficios y promesas verificadas viven en `FoodDiscoveryHome.tsx` (119 líneas); `CustomerSurface.tsx` bajó de 598 a 459 líneas.
- [x] La portada usa restaurantes/productos/favoritos del estado autenticado y el plan real del backend. La imagen hero ya no es una URL promocional fija: toma `cover`/`image` del primer comercio abierto y desaparece honestamente si el catálogo está vacío.
- [x] `test:web-checkout` y `test:responsive-layout` fijan techos 470/130, exigen composición con cards reales, persistencia de favorito y ausencia de `images.unsplash.com`; `test:web-tracking-maps` adopta el nuevo techo.
- [x] Chromium y el navegador integrado vuelven a recorrer la matriz completa. A 390 × 844, el home mide 390 px, expone 4 restaurantes, 7 productos y anuncia `Promoción de Nori Club` desde el catálogo activo.
- [~] Uber Eats combina búsqueda por restaurante/cocina/plato con tiempo, distancia, precio, rating y recomendaciones; DoorDash usa etiquetas confirmadas para descubrimiento dietario. Flash cubre búsqueda, categoría y señales básicas, pero sigue por debajo sin ranking medido, personalización explicable, frescura de inventario con SLA, etiquetas confirmadas por comercio ni gobernanza de promociones pagas.
- [ ] ARC-001 continúa sobre el selector de servicio, navegación y la composición residual del coordinador; no se agrega una vertical durante Fase 0.

## Avance 30 de agosto de 2026 — ARC-001, Restaurante y personalización web segmentados

- [x] Detalle de restaurante vive en `FoodRestaurantScreen.tsx` (85 líneas), cards/filas/búsqueda/categorías en `FoodCatalogComponents.tsx` (145) y el personalizador en `FoodItemSheet.tsx` (101); `CustomerSurface.tsx` bajó de 914 a 598 líneas.
- [x] El refactor conserva catálogo/stock del backend, favorito persistido, filtro por declaraciones dietarias, extras con precio, nota para el local, cantidad y total calculado. `src/App.tsx` carga el personalizador directamente y ya no atraviesa el coordinador.
- [x] `test:web-checkout` y `test:responsive-layout` fijan techos 610/155/95/110, exigen el cableado dietario y la personalización, y `test:web-tracking-maps` adopta el techo nuevo sin leer texto fuente crudo.
- [x] Chromium y el navegador integrado abren Nori Club y Roll salmon furai a 390 × 844: detalle y hoja miden 390 px sobre un viewport de 390 px; extras, nota, cantidad y `Agregar $ 8.200` permanecen operables sin desborde.
- [~] Uber Eats y DoorDash separan modificadores/notas de solicitudes estructuradas de alergia y advierten que el comercio puede no cumplir una nota. Flash conserva modificadores y notas, pero sigue por debajo sin solicitud de alergia por ítem, confirmación/timebox del comercio, trazabilidad de contaminación cruzada, sincronización externa de menú ni validación física.
- [ ] ARC-001 continúa sobre home/descubrimiento y contratos compartidos; este corte no amplía catálogo ni resuelve los bloqueos comerciales.

## Avance 30 de agosto de 2026 — ARC-001, Carrito y checkout web fuera del coordinador

- [x] Carrito, dirección de entrega, método de pago, cotización, propina, horario, resumen y confirmación viven en `src/customer/FoodCartScreen.tsx` (680 líneas); `CustomerSurface.tsx` bajó de 1.617 a 914 líneas sin agregar superficie durante Fase 0.
- [x] El corte conserva carrito persistido, direcciones geocodificadas, Wallet, configuración pública de Mercado Pago, Card Payment Brick tokenizado, quote firmada con versión/vencimiento y creación por la API existente. `QuantityCounter.tsx` (28) y `EmptyState.tsx` (19) dejan de volver a crecer dentro del coordinador.
- [x] `test:web-checkout` prueba que cotización, pago y primitivas pertenecen a sus módulos. `test:responsive-layout` y `test:web-tracking-maps` fijan techos de 930/690/35/25 líneas sin acoplarse al espaciado.
- [x] Chromium y el navegador integrado abren un carrito real a 390 × 844: mide 390 px de documento sobre 390 px de viewport y mantiene `Volver`, cantidades e `Ir a pagar` visibles. La matriz completa pasa cliente, comercio y operaciones entre 320 × 568 y 1.440 × 900.
- [~] La tarea coincide con Uber Eats —dirección, restaurante, productos, carrito, revisión, confirmación y tracking— y con el límite recomendado por Mercado Pago: el Brick tokeniza en cliente y el backend valida y crea el pago. Flash sigue por debajo sin credenciales productivas del PSP, onboarding de vendedores, 3DS/dispositivos físicos, conciliación externa, contracargos y aprobación legal/comercial.
- [ ] ARC-001 continúa sobre restaurante, descubrimiento y contratos compartidos; este corte no habilita dinero productivo ni cierra el P0.

## Avance 30 de agosto de 2026 — ARC-001, Envíos web fuera del coordinador

- [x] Cotización, geocodificación, opciones operativas, protección, firma y solicitud persistida viven en `src/customer/ShipmentHome.tsx` (567 líneas); `CustomerSurface.tsx` bajó de 2.166 a 1.617 líneas sin sumar capacidad durante Fase 0.
- [x] La pantalla conserva selección de origen guardado, invalidación de precio al cambiar datos, categoría/SLA desde PostgreSQL, coordenadas reales, quote firmada con vencimiento y confirmación por `onCreateShipment`.
- [x] `test:responsive-layout` fija techos de 1.635/575 líneas y exige `getShipmentOptions`, geocoding, `quoteShipment`, `quoteToken` y creación fuera del coordinador. `test:web-tracking-maps` adopta el nuevo techo del coordinador.
- [x] Chromium abre Envíos web a 390 × 844, espera el formulario real y comprueba que la acción de cotizar permanece dentro del viewport sin ejecutar una cotización.
- [~] La secuencia coincide con Uber Direct: validar cobertura/costo, mostrar tarifa/ETA con vencimiento, obtener consentimiento y crear usando la identidad de la quote. Flash sigue por debajo porque la red, OAuth de proveedor, tráfico con SLA, seguro, restricciones legales y prueba física no están validados.
- [ ] ARC-001 continúa sobre restaurante, carrito y contratos compartidos; Envíos ya no justifica volver a crecer el coordinador.

## Avance 30 de agosto de 2026 — ARC-001, Actividad y tracking web segmentados

- [x] Actividad, tarjeta de estado y los seguimientos de comida, viaje y envío viven en seis módulos con una responsabilidad concreta; `CustomerSurface.tsx` bajó de 3.172 a 2.166 líneas sin agregar superficie durante Fase 0.
- [x] La extracción conserva recursos autenticados, rutas viales, ETA, conductor asignado, PIN de retiro/entrega, enlace público de viaje, incidente de seguridad, evidencia de entrega, cancelación, reprogramación y calificación contra las APIs existentes.
- [x] `test:web-tracking-maps` fija techos de 2.185/195/180/340/285 líneas y usa contratos independientes del formato. `test:responsive-layout` adopta el mismo techo del coordinador.
- [x] `test:responsive-browser` abre los tres seguimientos a 390 × 844. Si la cuenta de prueba no tiene un envío activo, lo cotiza y crea por las APIs públicas reales con precio firmado e idempotencia; no inserta SQL ni intercepta respuestas.
- [x] Un fallo al consultar prueba de entrega ya no se convierte silenciosamente en una lista vacía: la hoja conserva la ruta y muestra el error del backend.
- [~] Flash cubre el patrón competitivo de Actividad → estado/ETA → mapa y contacto operativo, además de viaje compartible y POD de envío. Sigue por debajo sin tráfico/mapas con SLA, mensajería o telefonía anonimizada, push probado en dispositivos, operación de safety 24/7, proveedores productivos y habilitación/seguro.
- [ ] ARC-001 continúa sobre restaurante, carrito y contratos compartidos; este corte no cierra el P0.

## Avance 30 de agosto de 2026 — ARC-001, Cuenta web segmentada por responsabilidad

- [x] `CustomerProfileScreen.tsx` quedó en 124 líneas y sólo coordina identidad y composición. La libreta geocodificada vive en `CustomerAddressBook.tsx` (308) y las preferencias alimentarias en `CustomerDietaryPreferences.tsx` (160).
- [x] `CustomerAddressPayload` es el contrato compartido de alta y edición; la libreta sigue invalidando coordenadas/token al cambiar texto y sólo guarda una coincidencia validada.
- [x] `test:responsive-layout` fija 130/315/165 líneas, exige composición, geocoding, alta/edición y persistencia dietaria. La matriz Chromium existente vuelve a recorrer Mis direcciones y Mi alimentación sin escribir datos.
- [x] Este corte resuelve la deuda declarada en la entrega anterior y satisface responsabilidad concreta para Cuenta web; ARC-001 continúa sobre tracking, restaurante y carrito.

## Avance 30 de agosto de 2026 — ARC-001, Cuenta web fuera del monolito cliente

- [x] Perfil, direcciones geocodificadas y preferencias alimentarias viven en `src/customer/CustomerProfileScreen.tsx`; `CustomerSurface.tsx` bajó de 3.720 a 3.172 líneas sin agregar superficie durante Fase 0.
- [x] Se conservan las APIs reales de edición, alta/cambio/baja de direcciones, selección predeterminada y preferencias. Una dirección modificada pierde su token hasta volver a elegir una coincidencia validada.
- [x] `test:responsive-layout` fija el coordinador en 3.180 líneas o menos y exige el cableado de geocoding, alta/edición y dieta. `test:responsive-browser` abre Cuenta a 390 × 844, comprueba ambas secciones y el botón final sin overflow ni escrituras.
- [~] Uber agrupa Casa, Trabajo y otros lugares guardados dentro de Cuenta, y Uber Eats separa filtros dietarios de solicitudes de alergia por producto. Flash cubre destinos reutilizables y filtros persistidos, pero sigue por debajo en notas de alergia por ítem, confirmación del comercio y evidencia física; su advertencia de contaminación cruzada permanece visible.
- [x] La segunda partición se completó en la entrega siguiente: perfil, libreta y dieta tienen límites y ratchets propios.

## Avance 30 de agosto de 2026 — ARC-001, Wallet web fuera del monolito cliente

- [x] Saldo, carga sandbox, movimientos y promociones viven en `src/customer/WalletScreen.tsx`; `CustomerSurface.tsx` bajó de 3.794 a 3.720 líneas sin agregar una capacidad nueva durante Fase 0.
- [x] `test:responsive-layout` fija un techo de 3.725 líneas, exige el límite extraído y conserva los topes de carga entre ARS 1.000 y ARS 200.000. `test:responsive-browser` abre la PWA cliente a 390 × 844, comprueba actividad real, ausencia de overflow y ambos topes sin ejecutar una carga.
- [x] El refactor mantiene la fuente real del saldo y del historial en el estado autenticado; no introduce fixtures ni convierte la carga sandbox en dinero custodial.
- [~] Mercado Pago separa saldo disponible, movimientos aprobados, contracargos, reintegros y conciliación en reportes financieros. Flash muestra el ledger de la cuenta, pero sigue por debajo: faltan estados contables visibles, filtros/exportación, PSP productivo, conciliación externa y habilitación regulatoria.
- [ ] ARC-001 continúa sobre las concentraciones internas del cliente web y los contratos compartidos; este corte no cierra por sí solo el P0.

## Avance 30 de agosto de 2026 — ARC-001, Comidas móvil segmentada por tarea

- [x] Descubrimiento/búsqueda, restaurante/personalización, carrito, checkout y pedidos viven en cinco módulos con responsabilidad concreta. Incidencias de pedido, devoluciones y siniestros viven en `CustomerServiceIssueModals.tsx`; `CustomerScreen.tsx` bajó de 3.159 a 1.321 líneas sin agregar superficie durante el congelamiento de Fase 0.
- [x] El carrito, la dirección y las preferencias permanecen en el coordinador porque Cuenta y Actividad los consumen; cambiar de pestaña no descarta una compra, grupo o cotización en curso.
- [x] La extracción conserva catálogo y favoritos persistidos, stock, modificadores, alérgenos, dirección geocodificada, método tokenizado, cotización firmada, propina, reserva, creación, tracking y cancelación contra sus APIs reales.
- [x] El botón final muestra el mismo total que el detalle, incluida la propina; ya no presenta una cifra menor justo antes de confirmar el cobro.
- [x] `test:mobile-food-design` inspecciona cada límite extraído y `test:responsive-layout` fija el coordinador en 1.350 líneas, verifica las tres APIs de resolución de problemas e impide que vuelva a crecer silenciosamente.
- [~] Uber Eats y DoorDash permiten abrir problemas desde el pedido y categorizan ítems faltantes/incorrectos antes de evaluar crédito, reembolso u otra resolución. Flash conserva esa revisión y el ledger exacto, pero sigue por debajo porque no tiene evidencia fotográfica para incidencias de comida, política legal/comercial aprobada ni equipo de soporte habilitado.
- [~] El flujo coincide con la secuencia oficial de Uber Eats —dirección, restaurante, productos, carrito, revisión, confirmación y tracking— y con los estados/mapa de DoorDash. Flash sigue por debajo en proveedor de mapas con SLA, push físico, pagos marketplace conciliados, soporte 24/7 y operación comercial habilitada.
- [ ] ARC-001 continúa con contratos compartidos y la siguiente concentración monolítica; esta extracción no cierra por sí sola el P0.

## Avance 30 de agosto de 2026 — ARC-001, Viajes móvil fuera del coordinador

- [x] Origen/destino, GPS, destinos recientes, ruta, opciones, tarifa adelantada, reserva y solicitud persistida viven en `CustomerRideScreen.tsx`; no se agregó superficie durante el congelamiento de Fase 0.
- [x] `CustomerScreen.tsx` bajó de 3.809 a 3.159 líneas. Viajes permanece montado entre pestañas para conservar direcciones y una cotización en curso.
- [x] Cambiar el origen —por texto, GPS o una dirección de Cuenta— invalida ruta, opciones y precio anterior. El usuario ya no puede intentar solicitar con una tarifa visualmente vigente para otro origen.
- [x] La pantalla cliente conserva vista previa de ruta, distancia y ETA, pero dejó de mostrar instrucciones giro a giro. La guía operativa permanece exclusivamente en Flash Driver, como exige la segmentación vigente.
- [x] `test:responsive-layout` y `test:mobile-maps` fijan el nuevo techo, verifican las APIs reales `quoteRideOptions`/`createRide`, la invalidación de tarifa y la ausencia de maniobras en cliente.
- [~] Uber y Lyft muestran precio adelantado sujeto a ruta, demanda, tráfico y peajes; Flash conserva ese desglose, pero sigue por debajo en tráfico con SLA, oferta productiva, habilitación, seguro y validación física. Las instrucciones de conducción requieren además build Driver probado en movimiento.
- [x] Comidas ya fue segmentada por tarea en la entrega siguiente de este mismo día.

## Avance 30 de agosto de 2026 — ARC-001, Envíos móvil fuera del coordinador

- [x] Cotización, geocodificación, ruta vial, opciones, protección, firma y creación persistida viven en `CustomerShipmentScreen.tsx`; el cambio mueve lógica existente y no agrega superficie durante el congelamiento de Fase 0.
- [x] `CustomerScreen.tsx` bajó de 4.292 a 3.809 líneas. Envíos conserva su estado montado al cambiar de pestaña para no descartar direcciones, destinatario ni una cotización en curso.
- [x] Cuenta sigue propagando la dirección elegida mediante un evento tipado; Envíos consume el evento y reinvalida ruta/cotización sin volver a acoplar sus setters al coordinador.
- [x] `test:responsive-layout` y `test:mobile-maps` fijan el nuevo límite, verifican las APIs reales `quoteShipment`/`createShipment` y exigen coordenadas persistidas para el origen de sus mapas.
- [~] La secuencia cotizar → confirmar → crear y la prueba de entrega con PIN/firma siguen el contrato documentado por Uber Direct. Flash continúa por debajo en red productiva, SLA de tráfico, verificación de identidad, barcodes, retención de evidencia y operación asegurada; todos dependen de proveedor, habilitación y pruebas físicas.
- [ ] Comidas y Viajes son los dos cortes que todavía quedan dentro del coordinador para cerrar esta parte de ARC-001.

## Avance 29 de agosto de 2026 — ARC-001, Cuenta móvil fuera del coordinador

- [x] Seguridad de cuenta, sesiones, referidos, preferencias alimentarias, notificaciones, soporte, direcciones y métodos de pago viven en `CustomerAccountScreen.tsx`, con las mismas APIs y transiciones persistidas.
- [x] `CustomerScreen.tsx` bajó de 5.365 a 4.292 líneas sin agregar pantallas ni capacidades durante el congelamiento de Fase 0.
- [x] Cuenta permanece montada cuando se cambia de pestaña: un OTP, un reintento o un formulario en curso no se descarta por navegar.
- [x] La selección de una dirección cruza el límite mediante un solo evento tipado y sigue actualizando Comidas, Viajes y Envíos; no se trasladaron ocho setters al componente nuevo.
- [x] `test:responsive-layout` impone el nuevo techo del coordinador y verifica que Cuenta no vuelva a incrustarse ni pierda el cableado de direcciones; Chromium recorrió customer mobile y desktop merchant/operaciones desde 320×568 hasta 1440×900 sin overflow.
- [ ] Comidas, Viajes y Envíos siguen dentro del coordinador y son los próximos cortes de ARC-001.

## Avance 29 de agosto de 2026 — GEO-001, identidad geográfica hasta el checkout

- [x] Cada resultado de geocodificación recibe una validación JWT de 15 minutos, con audiencia propia y ligada al usuario autenticado.
- [x] Web y mobile exigen buscar y elegir una coincidencia; ya no guardan automáticamente el primer resultado ni aceptan coordenadas del cliente como hecho.
- [x] El flujo mobile vive en `CustomerAddressForm.tsx`; esa entrega bajó `CustomerScreen.tsx` a 5.365 líneas y no amplió el coordinador monolítico para sumar la capacidad.
- [x] La migración 136 persiste proveedor, `place_id`, tipo y fecha de validación sin fabricar un backfill para direcciones legacy.
- [x] El checkout de comida rechaza direcciones legacy, conserva la identidad geográfica dentro de la cotización firmada y obliga a recotizar si la dirección cambia.
- [x] `test:maps` y `test:postgres` prueban token de otro usuario, campos manipulados, ausencia de validación y checkout legacy contra PostgreSQL/PostGIS real.
- [~] Producción exige proveedor comercial y `place_id`, pero la calidad, deliverability y costo reales siguen bloqueados por una API key habilitada. Google Address Validation todavía no está integrado ni debe presentarse como tal.

## Avance 26 de agosto de 2026 — ARC-001 pasos 2 a 16, servidor y frente

Entregas novena a decimoquinta de la Fase 0. El paso 2 quedó sin registrar acá cuando se publicó, así que esta sección cubre los siete.

### Lo que se extrajo

| Módulo | Qué se lleva | Paso |
| --- | --- | ---: |
| `server/http/responses.js` | `ok`, `fail`, `parseOrFail` — 697 llamadas | 2 |
| `server/http/maps-router.js` | 2 rutas de mapas | 2 |
| `server/http/authorization.js` | 10 predicados + `requireAnyRole` — 81 usos | 3 |
| `server/http/addresses-router.js` | 5 rutas de direcciones, con esquema Zod propio | 3 |
| `server/http/realtime.js` | transporte SSE, registro de clientes y `/api/events` | 4 |
| `server/http/authentication.js` | `requireAuth` y la lectura del token | 5 |
| `server/fallback-runtime.js` | `readDb` instrumentada y `audit` del fallback SQLite | 5 |
| `server/audit-trail.js` | `auditRuntime`, la auditoría que sirve a los dos runtimes | 6 |
| `server/http/notifications-router.js` | notificaciones, preferencias y dispositivos — 7 rutas | 6 |
| `server/http/dietary-router.js` | preferencias alimentarias — 2 rutas | 6 |
| `server/http/feedback-router.js` | favoritos y calificaciones — 4 rutas | 7 |

`server/index.js`: 9.696 → **8.689 líneas**, 210 → **189 rutas**, 172 → **154 declaraciones de nivel superior**. Son 9 de 57 grupos de rutas. **Lo que importa no es cuánto se movió, sino qué quedó establecido.**

### La autorización deja de tocar la base de datos

Nueve reglas decidían quién puede hacer qué desde adentro de un archivo de 9.500 líneas, y **ninguna tenía una prueba directa**: la única forma de ejercitarlas era levantar la API y pegarle a un endpoint. Eso cubre los caminos que alguien se acordó de probar, no la regla.

Dos de ellas, `canAdvanceOrder` y `canMutateOrderStatus`, recibían el `db` completo y buscaban el comercio adentro. Esa dependencia era la que hacía imposible verificar un permiso sin un runtime. Ahora reciben el comercio ya resuelto y las nueve son puras.

`test:authorization` afirma cada una por separado sobre Vitest 4.1, sin red ni base, incluidos tres casos que un smoke de extremo a extremo no llega a montar: **el administrador con MFA habilitado y sin verificar**, el pedido cuyo comercio ya no existe, y el conductor que no es el asignado. El contrato encontró de paso que tres predicados devolvían `null` en vez de `false`; todos los sitios de llamada los usan en contexto booleano, así que la corrección es equivalente.

La suite además afirma que **el propio módulo no vuelve a depender de la base**: si un predicado recibe otra vez el `db`, el contrato falla. Sin esa aserción, la propiedad que hace verificable a todo lo demás se pierde en el primer PR que la olvide.

El primer límite de integración estándar también quedó activo: la segunda mitad de
`test:runtime-role-shape` crea PostGIS 17 desde Docker, replica los tres roles de producción y
aplica las 136 migraciones desde cero. Corre dentro de `ci-postgres`, así que una prueba que sólo
funcionara sobre la base preparada a mano por el workflow ya no podría satisfacer por sí sola el
criterio.

### Un contrato que pierde cobertura en silencio es peor que uno que falla

`test:realtime-audience` leía `server/index.js` y nada más. Al mudarse las direcciones, sus 6 publicaciones dejaron de inventariarse: el contrato pasó de **43 a 37 publicaciones y siguió en verde**, con un `entityType` menos cubierto y sin decir una palabra.

Es la misma clase de defecto que el paso 1 encontró en ocho suites acopladas al formato, pero peor: aquélla fallaba ruidosamente y bloqueaba el refactor; ésta lo acompaña degradando la protección. **Un contrato acoplado a dónde vive el código es tan frágil como uno acoplado a cómo está escrito.**

Ahora recorre todo `server/` y tiene un piso explícito de 43 publicaciones. Bajarlo exige escribir por qué, igual que el ratchet de longitud de línea.

### El patrón, y su precio

`addresses-router.js` es el primer grupo con la superficie completa que tienen los otros 54: autenticación, doble runtime PostgreSQL/SQLite, auditoría y evento de tiempo real. El de mapas no la tenía, así que no probaba que el patrón sirva para el resto.

Su factory recibe cuatro dependencias del núcleo —`requireAuth`, `readDb`, `audit`, `publishRealtimeEvent`— porque las cuatro siguen viviendo en `index.js`. **Esa lista es la medida de cuánto núcleo falta extraer**, y está escrita en un lugar en vez de dispersa en 265 líneas de un archivo de 9.500. El orden que se deriva de eso está en el ticket.

### El estado compartido era la dependencia que no se podía pasar por parámetro

La política de audiencias ya vivía aparte desde SEC-001. Lo que seguía adentro del archivo grande era el **transporte**: el registro de clientes SSE, el frame, el fanout y la publicación.

Ese registro es un `Map` vivo, y era la única dependencia de un grupo de rutas que no se podía pasar por factory sin arrastrar estado entre archivos. Por eso `addresses-router.js` la recibía por parámetro en el paso 3. Con el hub extraído, **su factory bajó de cuatro dependencias a tres** y los grupos que vengan importan `publishRealtimeEvent` como cualquier otra función.

La ruta `/api/events` viaja con el hub y no en un router aparte: es la única que escribe en el registro, y separarla del `Map` que administra sólo movería el acoplamiento de lugar.

El arreglo del paso 3 se pagó acá mismo: mover 43 publicaciones de archivo no bajó la cobertura del contrato ni en una.

### La factory era andamio

El paso 5 extrajo lo último que un grupo de rutas necesitaba del archivo grande: `requireAuth`, y con él `readDb` y `audit`, de los que depende.

**Los tres routers dejaron de ser factories.** No por una decisión de estilo: una factory existe para recibir lo que todavía no es un módulo, y cuando ya no queda nada que recibir, se cae sola. `addresses-router` llegó a recibir cuatro dependencias y terminó en cero sin que se tocara una sola de sus cinco rutas. Hoy los tres se importan y se montan.

El circuit breaker del proveedor cartográfico se fue con sus rutas por el mismo criterio: era la única parte del sistema que lo usaba, y su estado —fallos consecutivos, ventana abierta— vivía en un archivo que no lo consultaba.

### Identidad y permisos son dos preguntas distintas

`authentication.js` responde **quién sos**; `authorization.js`, **qué podés hacer**. El hallazgo H-08 las dejaba mezcladas en el mismo archivo de 9.500 líneas.

La asimetría entre las dos es la razón del orden en que se extrajeron: la autenticación **no puede ser pura** —tiene que consultar el usuario y, si es administrador, su estado de MFA—, mientras que los permisos sí. Resolver `mfa` una vez por request en `requireAuth` es lo que permite que `isAdmin` sea una función sin efectos, verificable sin levantar nada. Sacar los permisos primero era la única forma de que quedaran así.

### El primer paso que no tuvo que decidir nada

El paso 6 sacó dos grupos —notificaciones con dispositivos, y preferencias alimentarias— y **no hubo ninguna decisión de diseño que tomar**. Los archivos no reciben nada por parámetro: importan lo que usan. Eso era el objetivo de los cuatro pasos anteriores, y es la señal de que lo que queda es volumen y no arquitectura.

Lo único que hizo falta extraer de paso fue `auditRuntime`, que elige entre la cadena inmutable de PostgreSQL y la ventana en memoria del fallback. Vivía en `index.js`, donde cada handler que lo usaba quedaba a un `if` de distancia de auditar en el runtime equivocado.

Los tres subgrupos de notificaciones viajan juntos porque son un dominio visto de punta a punta: **qué se te notifica**, **qué se te notificó** y **a dónde se entrega**. Separar el token de dispositivo de la preferencia que decide si se usa dejaría dos archivos que nadie puede leer por separado.

Los dos grupos elegidos tienen suite propia sobre el fallback —`test:dietary-local` y `test:notification-local`—, así que la extracción se verificó contra el contrato que ya existía en lugar de contra uno escrito para la ocasión.

### Una suite que pasa en CI y falla en la máquina de quien la corre

`test:security` es la puerta que cubre el runtime entero, y su espera de arranque tenía dos defectos. El `sleep` estaba **dentro del `catch`**: si `/health` respondía algo distinto de 200 sin lanzar, el bucle quemaba sus 60 intentos de corrido. Y aun durmiendo, 60 × 200 ms daban **12 segundos de presupuesto** contra un arranque en frío medido en **22**.

Pasa en el runner de CI, que está caliente, y falla en la máquina de quien la corre. Es la peor forma de falso negativo, porque entrena a ignorar el rojo: **tres verificaciones de esta misma sesión se perdieron creyendo que había una regresión donde no la había.** Ahora se cuenta tiempo en lugar de intentos, con 90 s de presupuesto, y el error dice cuál fue la última respuesta. `test:telemetry` tenía la misma forma con 24 s —dos segundos de margen— y quedó igual.

### El paso 8 no movió código: desarmó una trampa

La mitad que falta de ARC-001 es partir `src/App.tsx` (10.553 líneas) y `apps/mobile/App.tsx` (**15.374 líneas y 600 KB, más grande de lo que `server/index.js` fue nunca**). Antes de tocarlos hubo que mirar quién los vigila.

**Nueve suites los leían por ruta fija.** Y `section()`, el helper que recorta una región entre dos marcadores, devolvía `""` cuando no encontraba el inicio — de sus cuatro sitios de llamada, **sólo uno tenía guarda**.

El caso peligroso no es la región vacía, es la que **encoge**. Medido, no supuesto: si `CartScreen` se muda a su propio archivo y queda la firma, `section` devuelve 60 caracteres, la guarda `if (!checkout) throw` no lo atrapa porque 60 es un valor verdadero, y `containsNone(checkout, ["Defensa 982"])` **pasa afirmando sobre nada** — justo cuando la dirección prohibida podría haberse ido con el componente.

Ahora `section` lanza si el marcador falta o si la región cae por debajo de un piso, y `containsNone` se niega a responder sobre una región colapsada. Las nueve suites leen el árbol de su audiencia con `readAudienceSource`, así que un componente que cambie de archivo sigue bajo contrato.

**Y ya había una víctima.** `test:web-tracking-maps` afirmaba que cuatro verticales comparten el mapa, contando sobre dos archivos. En el árbol hay cinco: cuando `RideHome` se extrajo a su propio archivo, su uso dejó de contarse **y el contrato siguió en verde**, afirmando una cobertura de cuatro mientras miraba tres.

### El frente: primer corte, y el mismo orden que en el servidor

`src/App.tsx` tenía **10.553 líneas y 78 componentes**. El paso 9 se lleva la superficie administrativa entera —la consola y sus doce paneles, más diez tableros— a `src/backoffice/AdminConsole.tsx`: **10.553 → 7.420 líneas, 78 → 53 componentes**.

El corte se eligió por una propiedad, no por tamaño: de los trece componentes del bloque **sólo `SuperAdminConsole` cruza la frontera**. Los otros doce se usan únicamente adentro.

Y hubo que sacar el núcleo compartido primero, igual que en el servidor. `money` (47 usos), `initials` (6) y los tres mapas de etiquetas de estado vivían en `App.tsx`; exportarlos desde ahí habría cerrado un ciclo —`App` importa la consola, la consola importa `App`—. Salieron a `src/format.ts` y `src/labels.ts`.

**El uso decidió, no el nombre.** `AdminKpi` y `AdminSectionHeader` comparten prefijo con los paneles administrativos, pero se usan 4 y 10 veces fuera del backoffice: son primitivas compartidas y quedaron en `src/ui/panels.tsx`. Renombrarlas es deuda anotada, no parte de esta entrega: mover y renombrar en el mismo commit hace irrevisable el diff.

Un análisis por regex dijo que el bloque no dependía de nada externo. Era falso: `tsc` encontró 182 errores, entre ellos doce componentes de afuera. **El compilador es el analizador de dependencias, no una expresión regular.**

### Diez suites esperaban 10 segundos un arranque de 22

El paso 7 arregló esa carrera en dos scripts. Al correr la batería del frente aparecieron dos más, y al buscar la clase entera había **ocho**, con presupuestos de 10 a 12 segundos. Todas contaban intentos en lugar de tiempo, y varias dormían dentro del `catch`, así que una respuesta distinta de 200 que no lanzara quemaba los intentos de corrido.

`scripts/wait-for-api.mjs` las reemplaza: un presupuesto, un lugar, y un error que dice si lo último fue `ECONNREFUSED` o `HTTP 503`. En una sola sesión esta clase costó cuatro verificaciones perdidas, una reportada como regresión inexistente.

### El móvil: 15.374 → 10.876 líneas, y una deuda que se pagó sola

`apps/mobile/App.tsx` era el archivo más grande del repositorio. Casi un tercio —**4.445 líneas**— era el objeto `styles`, usado en 1.746 lugares. Ninguna pantalla se podía mover mientras eso viviera en el entrypoint, así que salió primero a `apps/mobile/src/styles.ts`, junto con el formateo compartido en `apps/mobile/src/format.ts`.

Las etiquetas de estado del móvil **no** se unificaron con las de la web aunque compartan forma: el móvil dice «Nuevo · aceptar» donde la web dice «Aceptado», porque ahí la pantalla es del comercio y la etiqueta es una acción. Unificarlas sería perder la distinción.

**El paso 8 se pagó una entrega después, y se puede medir.** `test:responsive-layout` afirma `contains(mobile, "customerViewport: { maxWidth: 430")`. Tras mover la hoja de estilos, ese texto existe **sólo** en `styles.ts` y ya no en `App.tsx`: con la lectura por ruta fija que había antes, la aserción se rompía hoy. Con la lectura por árbol, encontró el código en su lugar nuevo y pasó.

**Y el compilador ganó de nuevo.** Un grep dijo que el bloque de estilos no dependía de nada externo. Dependía de `flashDesign` y de `Platform`. Es la tercera vez en la sesión que un análisis por texto se equivoca y `tsc` lo corrige: para dependencias, el compilador es la herramienta, no la expresión regular.

### La pantalla del cliente, y la primera línea larga que baja

`apps/mobile/App.tsx`: **15.374 → 4.359 líneas**. El paso 11 saca las primitivas compartidas a `src/ui.tsx` y la pantalla del cliente —con sus tres hojas de seguimiento— a `src/screens/CustomerScreen.tsx`.

**Qué es compartido lo decidió el conteo, no el nombre.** `ActionButton` aparece 16 veces repartidas entre cliente, comercio y conductor; `OrderCard` y `KpiRow` las usan comercio y conductor; `ServiceChatModal` las tres. Las hojas de pedido, viaje y envío son sólo del cliente y viajaron con él.

### Una guarda sólo protege donde se la usa

`test:mobile-maps` falló, y falló bien. Recortaba la región del seguimiento con `app.slice(indexOf(A), indexOf(B))` —**`indexOf` crudo, no `section()`**—, así que se saltaba las guardas que el paso 8 puso contra el colapso y contra el marcador ausente.

Al mudarse `RideTrackingSheet` a la pantalla del cliente y `ServiceChatModal` a las primitivas, los dos marcadores quedaron en archivos distintos y el recorte pasó a abarcar miles de líneas ajenas. La aserción de ausencia acusó código que nunca quiso mirar. **Falló por suerte, no por diseño**: si el recorte se hubiera achicado en lugar de inflarse, habría pasado en silencio. Ahora usa `section()` y su marcador de cierre es la hoja siguiente del mismo archivo.

### 262 → 261

La primera línea larga que baja desde el reformateo del paso 1. Al aislarse en un archivo nuevo, el ratchet la vio sin línea base que la tolerara y exigió partirla en lugar de ampliar el presupuesto. Es exactamente para lo que existe.

### El móvil queda en su shell: 15.374 → 321 líneas

El paso 12 saca las tres pantallas que quedaban a `src/screens/`: conductor (2.492 con su guía giro a giro, la captura de firma y sus dos tarjetas), comercio (982 con su detalle de pedido) y acceso (686).

`apps/mobile/App.tsx` queda en **321 líneas**: el proveedor de safe area, el banner de red, `AppContent` y el enrutado por audiencia. **El primer criterio de aceptación de ARC-001 se cumple del lado móvil**, con 321 contra un techo de 1.500. Del lado web falta: `src/App.tsx` sigue en 7.420.

La pantalla de acceso quedó en archivo propio y no dentro de una audiencia porque **no pertenece a ninguna: es la que decide cuál sos**. Un entrypoint por audiencia va a necesitarla entera, sea cual sea.

`SafeAreaView` se importa ahora en dos archivos, y está bien: el shell provee el contexto y la pantalla del conductor lo consume. Los errores de `tsc` por dependencias nativas ausentes pasaron de 3 a 4 por eso, no por una regresión — en esta máquina faltan `react-native-maps` y `react-native-safe-area-context`, que CI sí instala.

### Lo que encontró el navegador y ningún contrato veía

Con la aplicación corriendo por primera vez en esta sesión, `/api/admin/payouts` sobre el fallback SQLite devolvía al cliente:

```
Cannot read properties of null (reading query)
```

El manejador global de `server/index.js` **ya tenía la política correcta** —de 500 para arriba responde «Error interno del servidor» y nunca el texto del error—, pero **130 handlers capturaban el error ellos mismos** y escribían `fail(res, error.status || 500, error.message || "No se pudo X")`. Puenteaban la política justo en el caso que la motiva.

`failFrom(res, error, mensajePropio)` la dice una sola vez: por debajo de 500 el mensaje del error es parte del contrato y se conserva; de 500 para arriba se responde el texto del handler —qué operación falló, no por qué— y el detalle queda en el log, correlacionable por `requestId`.

El código no estaba roto. Era **indiscreto**, y eso no lo ve un `tsc` ni un contrato de forma.

### Un cuarto argumento que se descartaba en silencio

`fail` toma tres parámetros. La verificación del código de pickup le pasaba **cuatro**, con `attemptsRemaining` en el último. JavaScript lo ignoraba sin decir nada: **el pasajero nunca supo cuántos intentos le quedaban antes del bloqueo de diez minutos**, aunque el repositorio calculaba el número y el flujo gemelo de PIN de envío sí lo dice. Ahora va en el mensaje, con la misma convención.

### Mi propia puerta tenía un punto ciego

La primera versión del contrato buscaba la cadena `error.status || 500` línea por línea, y quedó en verde. **El navegador siguió mostrando la fuga en la sección de tarifas**: ese handler escribía `fail(res, 500, error.message || "...")`, con el 500 literal.

La corrección no fue agregar un caso: fue cambiar la forma de comprobar. Ahora se cuentan paréntesis y se analiza **cada llamada entera** —316 de ellas—, no una forma de escribirla. Y el manejador global queda exento por su forma, no por su archivo, para que copiar el patrón no herede la excepción sin heredar el enmascarado.

### La superficie de comercio, y el navegador dentro del bucle

`src/App.tsx`: **7.420 → 5.645 líneas**. El paso 14 saca la consola de comercio de escritorio y sus cuatro editores —horarios de sucursal, catálogo de modificadores, catálogo dietario y detalle de pedido— a `src/merchant/MerchantConsole.tsx`.

De las cinco piezas **sólo `MerchantDesktopConsole` cruza la frontera**. `OrderOpsCard` iba en sentido contrario: la usa este bloque y también el conductor y operaciones, así que salió antes a `src/ui/panels.tsx`. `compactMinutes` siguió el mismo camino hacia `src/format.ts`. Kernel primero, otra vez.

Es la superficie que el criterio «el build de driver no incluye pantallas de comercio» nombra literalmente.

**La diferencia con las trece entregas anteriores es que ésta se verificó corriendo.** Entré como comercio y recorrí las cinco pestañas de la consola: 855, 915, 607, 793 y 1.101 caracteres de contenido real, sin un solo error. Eso no lo dice `tsc`, que sólo afirma que los tipos cierran.

### La superficie de cliente, y un flujo que estaba muerto

`src/App.tsx`: **5.645 → 2.041 líneas**. El paso 15 saca las quince pantallas del cliente y las diez primitivas que sólo ellas usan a `src/customer/CustomerSurface.tsx`.

De las veinticinco piezas **sólo dos cruzan la frontera**: `CustomerApp`, que es la superficie, e `ItemSheet`, que `App` renderiza como hoja global porque se abre desde cualquier pantalla de comida. `SectionTitle`, `TopBar` e `IconButton` iban al revés —las usan también las consolas de operaciones— y salieron antes a `ui/panels.tsx`, junto con los helpers dietarios a `src/dietary.ts` y las progresiones de estado a `src/labels.ts`.

### Lo que encontró el navegador esta vez

Al recorrer el camino de compra —comercio, producto, agregar al carrito— la aplicación mostró **«Backend no disponible»**. No era el refactor:

- `GET /api/cart` **sí** tenía guarda de fallback: `if (!usesPostgresCommerce()) return ok(res, { cart: [] })`
- `PUT /api/cart` **no la tenía** e iba directo a PostgreSQL

Sobre SQLite se podía leer un carrito vacío pero no agregarle nada: **el flujo de pedir comida estaba muerto en el runtime que corre el job `local-fallback` de CI y la máquina de cualquier desarrollador**. Idéntico en `e51caf0`, el commit donde empezó esta sesión.

Antes del paso 13 el error además filtraba `Cannot read properties of null (reading query)`. Ahora degrada como las otras 136 rutas que dependen de PostgreSQL: 503 y un mensaje que dice por qué. Con su regresión en `test:security`.

**Ningún contrato estático podía ver esto.** El código compilaba, los tipos cerraban y la asimetría entre el GET y el PUT no es un error de forma: es una guarda que falta.

### Los dos `App.tsx` bajo el techo

`src/App.tsx`: **2.041 → 1.245 líneas**. El paso 16 saca las tres consolas móviles —comercio, conductor y operaciones— con su riel y sus seis tarjetas a `src/operations/OperationsSurface.tsx`.

Las tres viven juntas y no en un archivo cada una porque **comparten el riel, las tarjetas y la forma**: son la misma consola vista por tres roles. Separarlas obligaría a un módulo más sólo para lo común, sin que ninguna quede más legible.

`Metric` salió a `ui/panels.tsx`: era la última primitiva compartida entre el entrypoint y una superficie.

**Con esto se cumple el primer criterio de aceptación de ARC-001, entero:**

| Archivo | Al empezar | Ahora | Techo |
| --- | ---: | ---: | ---: |
| `apps/mobile/App.tsx` | 15.374 | **321** | 1.500 |
| `src/App.tsx` | 10.553 | **1.245** | 1.500 |

Lo que queda en cada uno es el shell: proveedor de contexto, banner de red, barra de modo y enrutado por audiencia.

Y bajó la segunda línea larga de la sesión, **261 → 260**, por el mismo mecanismo que la primera: al aislarse en un archivo nuevo el ratchet la vio sin línea base que la tolerara.

### Una prueba de navegador puede ensuciar una suite

`test:security` falló con «Repartidor no disponible». No era el refactor: **el navegador y la suite comparten la misma base SQLite de fixture**, y al entrar como conductor pulsé «Pausar», que lo dejó fuera de línea.

Es una consecuencia real de meter el navegador en el bucle de verificación, y la disciplina que exige es simple: **resetear la fixture después de una sesión de pruebas manuales**, con el mismo `POST /api/reset` que la suite usa en su última aserción.

### Lo que sigue faltando

Idéntico al paso 1, menos nueve grupos: separar entrypoints customer/driver/merchant, extraer features de los dos `App.tsx`, dividir `commerce-repository.js`, y los 48 grupos de rutas restantes. **El núcleo compartido está completo**: un grupo nuevo ya no necesita nada de `index.js`, así que lo que queda es trabajo repetitivo y no de diseño. Ninguna línea larga se corrigió: siguen 262, casi todas SQL en template literals.

## Avance 26 de agosto de 2026 — ARC-001 paso 1, reformateo mecánico

Octava entrega de la Fase 0. **Sin cambios de comportamiento:** Prettier sólo reescribe espaciado, el build pasa y las siete puertas de CI pasan.

### El hallazgo no era «los archivos son grandes»

Era que el código estaba comprimido en líneas de hasta **4.061 caracteres**. Con eso, un diff es ilegible, un conflicto de merge irresoluble, `git blame` no aporta nada y una revisión de seguridad es impracticable.

| Archivo | Antes | Ahora |
| --- | ---: | ---: |
| `apps/mobile/App.tsx` | 4.061 | **206** |
| `server/commerce-repository.js` | 2.655 | 1.540 |
| `src/App.tsx` | 1.791 | 270 |
| `server/auth-repository.js` | 1.563 | 357 |

Líneas largas totales: **1.543 → 262**. `apps/mobile/App.tsx` pasó de 327 líneas largas a **1**, y de 5.695 líneas a 15.374 que una persona puede leer. Lo que queda largo es sobre todo SQL en template literals, que Prettier no parte.

### Lo que hubo que arreglar primero

**Ocho suites afirmaban lógica leyendo el fuente y buscando substrings literales.** La intención es buena: impiden que una pantalla vuelva a inicializarse con datos ficticios, o que un checkout confirme una cotización distinta de la que mostró.

Pero `app.includes("entry.lat!==null")` falla en cuanto un formateador escribe `entry.lat !== null`. Eso las convertía en **un obstáculo para cualquier refactor** —el reformateo y también la extracción de módulos que viene después— en lugar de una protección.

`scripts/source-contract.mjs` compara ignorando el espaciado de los dos lados. Verificado en ambos sentidos: las suites pasan con el archivo formateado **y** sin formatear. Independencia del formato significa pasar en los dos estados, no haber sido reajustadas al nuevo.

`responsive-layout` además usaba una regex acotada con `[^
]*`, que asumía la hoja de estilos escrita sin saltos de línea.

### La puerta

`test:format` impide que el código vuelva a derivar. **El ratchet acota el daño heredado; el formateador impide que se genere daño nuevo.**

### Lo que ARC-001 todavía no hace

Esto es **sólo el paso 1**. Faltan extraer features de los dos `App.tsx`, separar entrypoints customer/driver/merchant, descomponer `server/index.js` y dividir `commerce-repository.js`. Ninguno de esos era revisable antes de este commit.

## Avance 26 de agosto de 2026 — DSP-001, selección de dispatch en dos etapas

Séptima entrega de la Fase 0. Cierra el núcleo del hallazgo [H-06](docs/auditoria-2026-08-25.md#h-06--dispatch-sin-recorte-espacial-previo).

- [x] **Etapa 1: recorte espacial.** `ST_DWithin` más orden KNN `<->` sobre el índice GiST parcial `drivers_available_location_gix ... WHERE online`. Antes no había **ninguna** ocurrencia de `ST_DWithin` ni de `<->` en todo el repositorio.
- [x] **Etapa 2: puntuación acotada.** El scoring conserva exactamente sus componentes y sólo evalúa la lista corta. **La optimización cambia a cuántos conductores se evalúa, no a quién se le ofrece el trabajo.**
- [x] **El punto de pickup entra como parámetro, no como columna de un join.** El planificador sólo usa el índice para KNN cuando un operando es constante; si viniera de un join, el recorte existiría en el texto y no en el plan.
- [x] **Radio dinámico con protección contra inanición.** Un radio fijo deja trabajos sin ofrecer en zonas de baja densidad. La escalera duplica de 8 km a 25 km, y sólo si la lista corta no alcanza. El radio usado y si hubo expansión quedan en `score_breakdown`: una zona que necesita expandir es visible en lugar de degradar en silencio.
- [x] `test:dispatch-candidates` incluye una **regresión sobre el hallazgo original**, cuya evidencia fue exactamente la ausencia de ambos operadores.
- [ ] **`EXPLAIN ANALYZE` con padrón sintético de al menos 1.000 conductores.** El contrato prueba la forma de la consulta; el plan hay que medirlo.
- [ ] **ETA vial por Route Matrix.** `computeRouteMatrix()` existe y está verificado; falta conectarlo al scoring y **depende de una API key**.
- [ ] **Stats precomputadas.** Con la lista corta, el historial de 30 días quedó acotado a 30 conductores: dejó de ser corrección para pasar a ser optimización.
- [ ] Prep time del comercio y dispatch manual desde backoffice.

## Avance 26 de agosto de 2026 — tres de cuatro suites fuera de cuarentena

Sexta entrega de la Fase 0. Ninguna de las tres resultó ser fragilidad de la prueba: las cuatro causas eran defectos reales, y tres son variantes del hallazgo [H-11](docs/auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada).

- [x] **`test:postgres` sale de cuarentena.** Fallaba por tres causas encadenadas.
- [x] **`test:dietary-local` y `test:notification-local` salen de cuarentena.** Corren ahora en el job `local-fallback`.
- [~] **`test:support-routing` sigue en cuarentena**, con su propio motivo.

**Cobertura al 26-08: 75 de 79 suites bloquean el merge, 1 en cuarentena.**

### Lo que estaba roto de verdad

1. **Un backfill que nombra filas por id envejece con el catálogo.** La migración `059` declaró alérgenos sobre `item_pizza_muzzarella` e `item_pizza_fugazzeta`; el catálogo cambió después y la pizza vigente, `item_pizza_burrata`, quedó sin declarar ninguno. `assertCatalogItemsExist` ahora falla ruidosamente ante esa deriva.
2. **Un backfill puede depender de otro.** La `041` crea las sucursales principales y la `055` les siembra horarios, pero sólo a las existentes. Al reaplicar la primera sin la segunda, cada sucursal quedó sin horario, `app.branch_is_scheduled_open` devolvió `false` y **el catálogo entero se volvió invisible**. El escaneo original tampoco las había visto: buscaba backfills derivados de cinco tablas y estos derivan de `merchant_branches`.
3. **El motor de riesgo trata como nueva a toda cuenta sembrada.** `new_account` suma 20 puntos por debajo de las 24 horas; en una base desde cero eso alcanza a todas, y se combina con velocidad y gasto hasta bloquear la operación con un `403`. En la base local de un desarrollador nunca se nota.
4. **Las dos suites «local» probaban el runtime equivocado.** Afirman el contrato del fallback SQLite —etiquetas dietarias como strings donde PostgreSQL devuelve objetos con `.code`— y estaban apuntadas a la API de PostgreSQL. No era interferencia de estado, como suponía la nota de cuarentena.

### Un punto que excede a CI

Que `new_account` pese 20 puntos significa que **un primer despliegue productivo marcaría a sus propios primeros clientes**. Si esa regla debe pesar eso en una plataforma cuyos clientes son todos nuevos es una decisión de producto, no de fixture, y queda anotada.

### Sobre las aserciones opacas

Dos aserciones agrupaban varias condiciones en un único mensaje, así que un fallo no decía cuál. Se les agregó diagnóstico sin cambiar lo que afirman; sin eso, cada ronda de CI habría sido otra conjetura.

## Avance 26 de agosto de 2026 — NOT-001 y GEO-001 hasta donde llegan sin credenciales

Quinta entrega de la Fase 0. Los dos bloqueadores dependían de proveedores externos; se llevaron hasta el límite de lo verificable sin credenciales.

### NOT-001 — push productivo ya es posible

- [x] **`NOTIFICATION_PROVIDER` acepta `expo`.** Antes el enum sólo admitía `disabled` y `sandbox`, y producción prohibía `sandbox`: el único valor válido era `disabled`. No había forma de entregar un push y el esquema lo impedía por construcción.
- [x] **`EXPO_ACCESS_TOKEN` obligatorio en producción.** Sin él, cualquiera que conozca un token de dispositivo puede enviarle notificaciones en nombre de Flash.
- [x] `server/push-provider.js`: lotes de 100, recibos de 1000, clasificación de errores, reintentabilidad, timeout y métricas. Nunca pone un token de dispositivo en un error.
- [x] **Migración `111`: estado `accepted`.** `notification_deliveries` sólo admitía `delivered` y `failed`, lo que obligaba a tratar un envío aceptado como una entrega.
- [x] `worker:push-receipts`, alerta `FlashPushReceiptsStale` y su [runbook](docs/runbooks/push-receipts.md).
- [ ] **Entrega en un dispositivo físico Android y iOS.** Exige credenciales FCM/APNs y un development build. Es la condición de cierre.

**Un ticket aceptado no es una entrega.** Expo sólo confirma que tomó el mensaje y su servicio no ofrece SLA, así que un ticket deja la notificación en `sent` y sólo un recibo confirmado la promueve a `delivered`. Un recibo ausente queda pendiente en lugar de contarse como éxito: esa es la diferencia entre monitorear la entrega y suponerla.

### GEO-001 — instancias públicas ya no llegan a producción

- [x] **`MAPS_PROVIDER=openstreetmap` hace fallar el arranque en producción.** La política de uso de Nominatim excluye expresamente a las aplicaciones comerciales; el demo público de OSRM está igual.
- [x] `server/maps-provider.js`: funciones **puras** `describe*`/`parse*` que no tocan la red, así el caché, el circuit breaker, el presupuesto y las métricas siguen donde estaban y el contrato se verifica entero sin credenciales.
- [x] **Google Geocoding + Routes `TRAFFIC_AWARE` + Route Matrix**, con field mask (sin ella se factura la respuesta completa) y `place_id` conservado.
- [x] Los endpoints `/api/maps/geocode` y `/api/maps/route` ya consumen el adapter: no es código muerto.
- [x] La alerta de mapas cubre los tres proveedores, no sólo el de desarrollo.
- [ ] **API key habilitada.** Sin ella no se puede verificar la calidad real de las rutas ni el costo por consulta, y ninguna tarifa se calculó todavía con routing vial real.

`computeRouteMatrix()` es además la dependencia de la etapa 2 de [DSP-001](docs/backlog-tecnico.md#dsp-001--dispatch-v2): permite pedir el ETA vial de varios conductores a un pickup en una sola llamada en lugar de una por candidato.

### La distancia que esto deja clara

Ambos contratos se verifican con `fetch` interceptado. Que el contrato sea correcto **no dice nada** sobre si un push llega a un teléfono ni sobre cuánto cuesta una consulta de rutas. Por eso las dos capacidades quedan en `CI` y no en `PROV`: están protegidas contra regresiones, no demostradas contra el mundo real.

## Avance 26 de agosto de 2026 — DAT-001, matriz de cobertura RLS

Cuarta entrega de la Fase 0. Clasifica el hallazgo [H-04](docs/auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security) y lo convierte en contrato.

- [x] **Las 106 tablas clasificadas** en [`database/rls-classification.json`](database/rls-classification.json): 65 `por-usuario` (60 con política), 24 `global-lectura`, 15 `servicio`, 2 `sin-uso`.
- [x] **`test:rls-matrix` como puerta.** Falla si una tabla nueva no se clasifica, si la matriz se desalinea de las migraciones, si una clasificación sobrevive a su tabla, o si una tabla `por-usuario` queda sin política fuera de la deuda declarada. Verificado que detecta las tres derivas.
- [x] **Deuda declarada que sólo puede achicarse:** `user_roles`, `drivers`, `merchants`, `shipment_details`, `promotion_redemptions`.
- [x] **Regla en `AGENTS.md`:** toda migración que crea una tabla la clasifica en el mismo PR.
- [x] Aplicar política a las cinco tablas de la deuda.
- [x] Eliminar el esquema muerto con una migración.
- [x] Decidir `FORCE ROW LEVEL SECURITY`: no corresponde al rol migrador y la forma del rol runtime queda probada en CI.
- [x] Sustituir `GRANT ... ON ALL TABLES` por grants explícitos: las migraciones hasta la 135 reducen los pares DML sin uso de 114 a cero; el contrato nominal y el trinquete en cero impiden que vuelvan a crecer.

### Dos cosas que la clasificación destapó

**`user_roles` se lee antes de autenticar.** `findAuthUserByEmail` hace `JOIN` a `user_roles` sin contexto de usuario y con `postgresPool.query` directo. Una política `user_id = app.current_user_id()` devolvería cero filas y **rompería el login de toda la plataforma**. Aplicar RLS ahí exige mover el camino de login a una función `SECURITY DEFINER`: es un cambio de diseño, no una migración mecánica. Por eso queda declarado en lugar de improvisado.

**`user_security_factors` es esquema muerto.** Ningún archivo de `server/` ni `scripts/` la referencia; la MFA real usa `user_mfa`. Declara columnas para secretos TOTP y credenciales WebAuthn que nada escribe ni lee, sin política RLS y con DML abierto al rol de runtime. `outbox_events` está igual. Superficie de ataque gratuita que existe sólo porque nadie las borró.

## Avance 26 de agosto de 2026 — INF-001, imagen productiva endurecida

Tercera entrega de la Fase 0, mediante [PR #2](https://github.com/santyperez145/Flash-Delivery-App/pull/2). Cierra el hallazgo [H-05](docs/auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root).

- [x] **Imagen multi-etapa.** Dependencias completas para construir, dependencias de producción aparte, y un runtime que copia sólo `dist`, `server`, `database` y `scripts`.
- [x] **Non-root verificado en una build real:** `uid=999(flash)`. No es un contrato sobre el texto del Dockerfile: el job `container-image` construye la imagen y comprueba el resultado.
- [x] **Mismo entrypoint que Compose.** `CMD` usa `server/start.js`. Antes, la imagen desplegada tal cual perdía telemetría, apagado ordenado y readiness, porque sólo Compose sobrescribía el comando.
- [x] **Sin devDependencies ni árbol de fuentes** en la imagen productiva.
- [x] **Capabilities eliminadas** y sin escalada de privilegios en Compose, con `/tmp` como tmpfs.
- [x] **`test:container-security` ampliado** de validar sólo roles de PostgreSQL a exigir el contrato de la imagen. Verificado que falla al quitar el `USER` y al divergir el entrypoint.
- [ ] **Filesystem raíz de sólo lectura.** Necesita una corrida real para confirmar que nada escribe fuera del volumen montado; no hay demonio Docker en el entorno de desarrollo usado.
- [ ] **380 MiB de imagen.** `react`, `react-dom`, `maplibre-gl`, `lucide-react`, `@mercadopago/sdk-react` y `concurrently` están en `dependencies` pese a que ningún archivo de `server/` ni `scripts/` los importa. Moverlos a `devDependencies` achicaría la imagen pero **los sacaría de `npm audit --omit=dev`**, y esos paquetes viajan al navegador. La decisión correcta es moverlos y ampliar la puerta de auditoría al árbol completo, no moverlos a secas.
- [ ] SBOM, scan y firma de imagen.

## Avance 26 de agosto de 2026 — CI-001 con las tres puertas en verde

Segunda entrega de la Fase 0, mediante [PR #1](https://github.com/santyperez145/Flash-Delivery-App/pull/1).

- [x] **`ci-critical-flows.yml`.** Levanta la API contra PostgreSQL y cubre pagos, conciliación, riesgo, payouts, propinas, KYC, vehículos, ganancias, safety, chat, siniestros, SLA de soporte, notificaciones y recursos por audiencia.
- [x] **Cobertura al 26-08: 15 → 73 de 76 suites**, 69 bloqueantes. Las 54 que estaban sin puerta se clasificaron por lo que realmente necesitan: 17 puras a `ci-fast`, 5 de sólo base a `ci-postgres`, 32 a flujos críticos.
- [x] **`test:ci-coverage`.** Falla cuando un script `test:*` no está referenciado por ningún workflow o cuando una excepción quedó obsoleta. Es la puerta que impide que la brecha vuelva a abrirse en silencio.
- [x] **`migrate-from-base` ejecutado por primera vez** y en verde: el PR fue justamente su primera validación real.
- [~] **Cuatro suites en cuarentena declarada:** `test:postgres`, `test:support-routing`, `test:dietary-local` y `test:notification-local`. Corren en cada push y su salida se publica, pero no bloquean. Cerrarlas es condición para dar CI-001 por terminado.
- [ ] **Falta `ci-nightly.yml`** (Playwright, carga k6, restore drill, provider sandbox) y la protección de rama, que es configuración manual en GitHub.

### Defectos que sólo aparecieron al hacer cumplir las puertas

- **Las cuentas sembradas no podían iniciar sesión.** La migración `052` verifica el email mediante `UPDATE` sobre los usuarios existentes; en una base desde cero quedan sin verificar y la API rechaza todo login. **28 de 32 suites fallaban, al 25-08, por esta única causa.** Es la segunda cara de [H-11](docs/auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada), que el primer escaneo omitió por buscar sólo backfills `INSERT ... SELECT`.
- **Rate limiting de autenticación.** Treinta suites contra una instancia agotan los 40 intentos por minuto por defecto; las suites que esperaban un `403` recibían un `429`.
- **`test:operations-resources` dependía del orden de ejecución:** exige que ya exista un evento de auditoría y se apoyaba en que `test:postgres` corriera antes.

Correr las suites en un bucle que registra cada resultado, en lugar de cortar en el primer fallo, es lo que permitió ver «28 fallos, una causa» en una sola corrida.

## Avance 26 de agosto de 2026 — SEC-001 y primera mitad de CI-001

Primera entrega de la Fase 0. Detalle y estado en [`docs/plan-de-accion.md`](docs/plan-de-accion.md).

- [x] **SEC-001 — realtime default-deny.** Eliminado el fallback `allRoles`. La política vive en `server/realtime-audience.js`, un módulo sin dependencias; una entidad desconocida llega solamente a `admin`. El defecto era mayor que el estimado: **13 de las 44 publicaciones difundían a todos los roles**, incluidas las seis del libro de direcciones y tres de `job`. `test:realtime-audience` bloquea el merge y se comprobó que falla ante el defecto.
- [x] **Observabilidad de audiencias.** Métrica `flash_realtime_audience_total{entity_type,outcome}`, alerta `FlashRealtimeUnclassifiedAudience` y runbook [`docs/runbooks/realtime-audience.md`](docs/runbooks/realtime-audience.md).
- [x] **CI con PostgreSQL.** `ci.yml` se dividió en `ci-fast.yml` y `ci-postgres.yml`. PostGIS 17 corre con los tres roles separados, migraciones desde cero, **migración incremental sobre la rama base del PR**, RLS, cadena de auditoría, aislamiento por ciudad, datos sensibles e idempotencia. Cobertura: **15 → 24 scripts**.
- [x] **Ratchet de longitud de línea.** `test:line-length` fija una línea base de **1.543 líneas de más de 200 caracteres en 120 archivos** y sólo admite bajarla. Contiene H-08 mientras ARC-001 no empieza.
- [x] **CODEOWNERS** para dinero, aislamiento y puertas de calidad.
- [~] **CI-001 sigue abierto.** Faltan `ci-critical-flows.yml` — necesita levantar la API porque esas suites usan `API_URL` — y `ci-nightly.yml`. **54 suites siguen sin puerta.**
- [x] **Ambos workflows en verde.** `CI PostgreSQL` corre **97 aserciones** sobre una base migrada desde cero. `main` llevaba en rojo desde el 23 de agosto sin que nadie estuviera bloqueado: la prueba práctica de H-01.
- [x] **Dos defectos reales destapados por la primera corrida.** `test:redis-rate-limit` fallaba porque node-redis 5+ emite un lote de claves por iteración de `scanIterator` y un lote vacío se traducía en `DEL` sin argumentos. Y **una base creada desde cero no era equivalente a una migrada**: ocho migraciones hacen backfill sobre datos preexistentes, así que un ambiente nuevo quedaba sin sucursales, vehículos ni métodos de pago wallet. Nuevo hallazgo [H-11](docs/auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada), corregido con `npm run db:seed:derived`.
- [~] **SEC-001 conserva deuda.** El contrato es estático: falta verificación de runtime de `resolveAudience` contra PostgreSQL con fixtures multiusuario, y el dashboard de la métrica.
- [~] **`migrate-from-base` sin ejecutar.** Sólo se activa en pull requests y esta entrega llegó por push directo; su primera validación real será el primer PR.
- [ ] **Reproducibilidad hacia adelante.** `db:seed:derived` corrige el estado actual, pero cada migración futura que haga backfill sobre datos existentes reintroduce H-11. Debe entrar en la definición de terminado de DAT-001.
- [ ] **Protección de rama.** `CODEOWNERS` no bloquea nada por sí solo: exige activar PR obligatoria y «Require review from Code Owners» en Settings > Branches. Es configuración manual en GitHub, todavía pendiente.

Deuda registrada: el fallback SQLite de `publishRealtimeEvent` difunde a todos los clientes SSE sin filtrar audiencia. Sólo es alcanzable sin `DATABASE_URL` — desarrollo y tests, nunca producción — pero conviene alinearlo.

## Auditoría integral — 25 de agosto de 2026

**Este bloque manda sobre el resto del roadmap.** Se realizó una auditoría integral del repositorio cuyos hallazgos están verificados contra el código, no inferidos. Documentos rectores:

- [`docs/auditoria-2026-08-25.md`](docs/auditoria-2026-08-25.md) — dictamen, hallazgos con evidencia reproducible y comparación competitiva.
- [`docs/plan-de-accion.md`](docs/plan-de-accion.md) — orden ejecutivo, fases con fechas y criterios de salida.
- [`docs/backlog-tecnico.md`](docs/backlog-tecnico.md) — tickets P0/P1 con criterios de aceptación verificables.
- [`docs/matriz-madurez.md`](docs/matriz-madurez.md) — estado real de cada capacidad.

### Dictamen

Flash es una **plataforma avanzada de preproducción**, no un MVP ni una maqueta. Es apta para demo a inversores, desarrollo interno, staging serio y prueba cerrada de delivery tras resolver los P0. **No** está aprobada para lanzamiento público irrestricto, custodia de saldo real, pagos masivos sin supervisión, transporte público de pasajeros ni operación multiciudad.

> El riesgo principal ya no es que el producto sea demasiado simple, sino el contrario: **Flash tiene más superficie funcional de la que hoy puede validar, mantener y operar de manera confiable.**

Evaluación global: **6,2/10**. La matriz de madurez lo cuantifica: de 91 capacidades inventariadas, 81% de las que existen están sin puerta automática, y **ninguna alcanzó prueba contra proveedor real**.

### Congelamiento de funcionalidades

Desde el 25 de agosto y hasta cerrar la Fase 0 (20 de septiembre de 2026), **no se agregan verticales, pantallas ni capacidades nuevas**. Sólo se admiten: tickets P0, defectos que bloqueen un P0, pruebas/contratos/puertas CI/observabilidad, y documentación de lo anterior. Detalle en [`docs/plan-de-accion.md`](docs/plan-de-accion.md).

### Candidatos de superficie post-Fase 0 — 2 de septiembre de 2026

Pedido de producto: cerrar paridad competitiva con pantallas/admin/config “completas”. **Durante el freeze no se implementan.** Quedan acá como candidatos priorizados tras el 20/09, medidos contra Uber/Uber Eats, PedidosYa, Rappi, DoorDash y el inventario en [`docs/experience-surface-inventory.md`](docs/experience-surface-inventory.md).

**Ya existe (no reinventar):** Cliente web/móvil (Comidas, Viajes, Envíos, Actividad, Cuenta, Wallet); Driver (mapa, ofertas, cockpit, ganancias, KYC); Merchant desktop + app (cocina, catálogo, sucursales, finanzas); Superadmin con 16 secciones (dispatch, comercios, drivers, envíos, siniestros, pagos, tarifas, mensajes, usuarios, finanzas, inversión, producto/flags, soporte, seguridad, infra); rol support acotado a tickets.

**P0 post-freeze (habilitación / dinero / safety — no pantallas decorativas):**
- [ ] PSP marketplace + conciliación + payouts productivos (PAY-001).
- [ ] Push FCM/APNs en dispositivo físico + builds firmados + deep links (NOT-001 / MOB-001).
- [ ] Mapas comerciales con SLA y Route Matrix (GEO-001 / DSP-001).
- [ ] Safety rides: no-show/waiting regulado, seguros, ops 24/7 antes de movilidad pública.

**P1 post-freeze (paridad operativa fina):**
- [ ] Merchant: POS sync, campañas nativas, prep predictivo, equipo/permisos/auditoría.
- [ ] Driver: multi-oferta cuando DSP lo soporte; promos reales; liquidación bancaria.
- [ ] Cliente: foto en incidencias de comida; alergia por ítem con timebox; pin de pickup editable; SLA self-serve.
- [ ] Soporte: portal con SLA visible al cliente y asignación automática medida.
- [ ] *Flash Más* cobrado + beneficios de ride/dispatch activos (hoy el cobro depende de PAY-001).
- [ ] Settings de plataforma: actualización forzosa / mantenimiento remotos; explicación de indisponibilidad por mercado.

**P2 post-freeze (diferenciadores / escala):**
- [ ] Multi-comercio en un pedido; grocery/kiosco; Destination Mode; CarPlay/Android Auto.
- [ ] Marketing desktop; personalización con consentimiento; B2B/centros de costo.
- [ ] KYC biométrico automatizado; playbook de segunda ciudad.

**Comparación:** Uber/DoorDash/PedidosYa ya tratan POS, personalización, multi-store y safety 24/7 como producto core. Flash tiene el esqueleto de marketplace + admin; queda por debajo en habilitaciones productivas y profundidad operativa, no en “falta de shell”. Inventar pantallas nuevas ahora empeora exactamente la métrica de la auditoría: más superficie de la que se puede validar.

### Hallazgos P0 verificados

- [ ] **H-01 / CI-001 — CI no ejecuta el 86% de su matriz.** 104 scripts declarados, 15 en CI. **CI no levanta PostgreSQL/PostGIS**, por lo que pagos, RLS, ledger, dispatch, KYC, safety y aislamiento por ciudad no bloquean ningún merge.
- [ ] **H-02 / NOT-001 — push productivo imposible por configuración.** `NOTIFICATION_PROVIDER` sólo admite `disabled|sandbox` y producción prohíbe `sandbox`. El outbox está bien construido pero no tiene destino.
- [ ] **H-03 / SEC-001 — realtime fail-open.** `realtime-repository.js:8` y `:16` devuelven `allRoles` ante evento sin entidad o `entityType` desconocido: un error de clasificación se convierte en broadcast a clientes, comercios y conductores.
- [ ] **H-04 / DAT-001 — cobertura RLS incompleta.** 106 tablas, 86 con RLS, **20 sin política** y **cero `FORCE ROW LEVEL SECURITY`**, con `GRANT ... ON ALL TABLES` al rol de runtime. Sin política, la única barrera es el código de aplicación.
- [ ] **H-05 / INF-001 — imagen Docker divergente y root.** Una etapa, con devDependencies, sin `USER`, y `CMD` sobre `server/index.js` en lugar del entrypoint instrumentado `server/start.js` que sí usa Compose.
- [ ] **H-06 / DSP-001 — dispatch sin recorte espacial.** Cero ocurrencias de `ST_DWithin` y de KNN `<->`: cada oleada recalcula historial de 30 días para todo el padrón online.
- [ ] **H-07 / GEO-001 — mapas públicos por defecto.** Nominatim, OSRM y tiles de OpenStreetMap como valores por defecto, contra su propia política de uso comercial.
- [ ] **H-08 / ARC-001 — concentración monolítica.** `apps/mobile/App.tsx` 433 KB, `src/App.tsx` 360 KB, **`server/index.js` 338 KB**, con líneas de hasta 4.061 caracteres que hacen ilegible cualquier diff.
- [ ] **H-09 / PAY-001 — Mercado Pago preparado pero no validado.** Sin sellers de prueba, sin credenciales, sin conciliación operada y sin el caso de refund con saldo insuficiente del vendedor.
- [~] **H-10 — documentación desalineada.** Corregido parcialmente por esta entrega. `ROADMAP.MD` decía «migraciones hasta 105»: son **110**.

### Corrección de estado

- El recuento correcto de migraciones es **110** (`database/migrations/110_merchant_prep_acceptance_clock.sql`), no 105. Las menciones a «hasta 105» en bloques anteriores corresponden a la fecha en que se escribieron.

## Avance 22 de agosto de 2026 — Acceso mobile profesional

- [x] Login dejó la tarjeta básica sobre gradiente y adoptó una composición Flash
  propia con hero de servicios, hoja compacta, targets táctiles y scroll seguro.
- [x] El acceso ahora es progresivo: email primero, contraseña después, identidad
  editable y recuperación contextual; registro, OTP y reset tienen estados y
  navegación independientes sobre los contratos backend existentes.
- [x] La UI dejó de autocompletar códigos/tokens de desarrollo y no presenta
  Apple, Google, teléfono, biometría o passkeys como disponibles sin proveedor.
- [x] Customer, Driver y Merchant reciben contexto propio; sólo Customer expone
  registro público y un intento válido en la variante incorrecta revoca la
  sesión recién emitida antes de informar el error.
- [x] La decisión y sus fuentes oficiales quedan registradas en
  `docs/competitive-research/mobile-authentication.md`.
- [ ] Siguiente gate de identidad: integrar passkeys y proveedores nativos sólo
  después de dominio, credenciales, backend, privacidad y builds físicos.

## Avance 22 de agosto de 2026 — Design Roadmap rector

- [x] `docs/DESIGN_ROADMAP.md` convierte la calidad visual, cobertura de pantallas, tokens, componentes, referencias y definición de terminado en lineamiento obligatorio del repositorio.
- [x] Foodu queda como referencia estructural principal de Comidas por su preview de más de 180 pantallas; Foodie, FreshGo, Foodeck y FoodWagon tienen usos secundarios acotados para no mezclar identidades.
- [x] La decisión se contrastó con fuentes oficiales vigentes de DoorDash y Uber Eats: marketplace de tres lados, descubrimiento con contexto, tracking honesto y Driver centrado en mapa/operación.
- [x] Se preserva identidad propia Flash y se prohíbe copiar activos, textos, colores, código o marca de los kits y competidores.
- [ ] P0 visual: materializar tokens compartidos y rediseñar el flujo completo de Comidas; luego aplicar la misma base a Actividad, Cuenta, Viajes, Envíos, Driver, Merchant y Operaciones sin retirar lógica real.

## Avance 22 de agosto de 2026 — Home de Comidas profesional y real

- [x] El primer sistema de tokens React Native fija identidad, colores por vertical, tipografía, espacios, radios y objetivos táctiles sin instalar otra dependencia.
- [x] Home adopta app bar de ubicación, hero tipográfico, campaña contextual, búsqueda, categorías, favoritos y cards 16:9 con jerarquía consistente y media sin deformar.
- [x] Campaña y código provienen de `/api/promotions`; se eliminaron el popup forzado `Hurry Offers`, `FLASH25` y las categorías/URLs de imágenes decorativas.
- [x] Categorías, comercios, rating, ETA, fee y distancia se derivan del catálogo autoritativo. El estado sin opciones queda explícito y accionable.
- [x] Favoritos se hidratan desde la cuenta, persisten en PostgreSQL mediante `/api/favorites/:restaurantId` y exponen busy/checked accesibles; agregar y quitar se verificó en el navegador real.
- [x] Un smoke dedicado impide reintroducir el cupón demo, fixtures visuales o corazones sin API; TypeScript mobile permanece verde.
- [~] Buscar, restaurante, producto, carrito y checkout conservan lógica real pero necesitan recibir el mismo rediseño antes de marcar Comidas visualmente completo.

## Avance 22 de agosto de 2026 — Buscar y Restaurante profesionales

- [x] Buscar presenta categorías reales, catálogo paginado, skeleton, resultado rico, cero coincidencias y error con reintento; no etiqueta fixtures como “búsquedas recientes”.
- [x] Cada resultado expone portada proporcional, ETA, fee, cantidad y nombres de coincidencias reales antes de abrir el comercio.
- [x] Restaurante usa hero 16:9, favorito PostgreSQL, apertura, campaña, dirección, rating, ETA, distancia y fee del catálogo.
- [x] Los tabs se derivan de las categorías reales del menú; seleccionar uno filtra productos y actualiza el conteo. Se eliminaron `Popular/Combos/Bebidas` hardcodeados.
- [x] Producto muestra descripción/categoría declarada, precio, dieta, stock y estado agotado; ya no inventa una descripción culinaria genérica.
- [x] Navegador real verificó catálogo vacío, resultados, apertura de restaurante y filtro Pizza con un único producto; TypeScript y el smoke de diseño bloquean regresiones.
- [~] Personalización, carrito y checkout son los siguientes tramos P0; la disponibilidad horaria fina por sucursal requiere trasladar ese contrato al catálogo Customer.

## Avance 22 de agosto de 2026 — Carrito y Checkout profesionales

- [x] Carrito muestra comercio, productos, cantidades, extras, notas, subtotal, direcciones geocodificadas, pagos reales y promoción aplicable con una jerarquía responsive única.
- [x] Si faltan dirección o pago, el flujo bloquea la quote y dirige a Cuenta; no elige ni dibuja datos sustitutos.
- [x] Fees y descuentos no aparecen antes de cotizar. Cambiar dirección, pago, cupón o carrito invalida la quote previa y obliga a recalcular.
- [x] Checkout usa el JWT firmado para mostrar vencimiento, ETA, distancia, versión tarifaria, líneas, modificadores, dirección, pago, subtotal, envío, servicio, descuento y total.
- [x] El CTA confirma el total autoritativo, declara la revalidación servidor y se deshabilita al vencer; actualizar precio vuelve a cotizar en vez de crear silenciosamente otro total.
- [x] Navegador real abrió una quote de 8,29 km / 46 min y mantuvo separado el ETA de catálogo de 22 min; no se confirmó la compra de prueba.
- [~] Prueba física de teclado/safe areas/caducidad y rediseño de personalización siguen abiertos antes de declarar completo el flujo nativo de Comidas.

## Avance 22 de agosto de 2026 — Personalización y post-compra

- [x] La sheet de producto muestra imagen, descripción, precio, dieta, alérgenos, modificadores, obligatoriedad, mínimos/máximos, nota y total desde datos reales.
- [x] El CTA permanece dentro del área segura, refleja el total base + modificadores y se bloquea si falta una selección obligatoria; alcanzar el máximo bloquea opciones adicionales.
- [x] Browser real verificó el cambio `0/4 → 1/4` y `$ 6.500 → $ 7.050` al elegir Cheddar extra; la hoja se cerró sin agregar la prueba al carrito.
- [x] Confirmación y pedidos en curso usan labels de estado para cliente, ETA, destino, total, compartir, tracking y cancelación; ya no muestran el enum técnico del backend.
- [x] El smoke visual protege límites, alérgenos, contador de nota, total de modificadores y traducción de estado.
- [~] Teclado, scroll del sheet, Dynamic Type y una compra end-to-end en build físico siguen pendientes; no se declara completo sólo por el render web.

## Auditoría 22 de agosto de 2026 — arquitectura completa de pantallas

- [x] `docs/product-execution-guidelines.md` formaliza como contrato versionado los lineamientos de producto competitivo, frontend/backend real, visuales completas, guía exclusiva de Driver y publicación verificada.
- [x] Se creó `docs/experience-surface-inventory.md` como inventario rector de pantallas, hojas, modales y estados para Cliente, Driver, Comercio y Operaciones.
- [x] La segmentación se contrastó con documentación oficial vigente de Uber Driver, Lyft Driver y DoorDash Dasher; se adoptan jerarquía y estados, nunca activos ni identidad propietaria.
- [x] La guía giro a giro queda exclusivamente en Flash Driver. El cliente conserva mapa, ubicación, ETA y progreso, pero no instrucciones de conducción.
- [x] Flash Driver separa Home/Mapa, Ganancias, Inbox y Cuenta con barra inferior fija; legajo/flota salen del flujo de conducción y cada cambio de sección vuelve al inicio de su contenido.
- [~] El mapa de demanda observada ya usa polígonos y conteos reales; voz, tráfico, reportes viales, waiting fees, llamadas anonimizadas y CarPlay/Android Auto permanecen bloqueados hasta tener contratos, proveedor, operación y prueba física.

## Avance 22 de agosto de 2026 — contrato adaptativo transversal

- [x] `docs/ui-layout-guidelines.md` convierte distribución, safe areas, barras, sheets, mapas, texto variable y breakpoints en lineamiento obligatorio para cada audiencia.
- [x] La decisión se contrastó con Uber Base Web, DoorDash Business Manager, Apple HIG y Expo; se adoptan estándares de composición y accesibilidad, nunca identidad propietaria.
- [x] Customer, Driver y Merchant comparten `SafeAreaProvider` real y un viewport mobile/web acotado; notch, barras del sistema y home indicator dejan de depender de padding supuesto.
- [x] Tracking, incidencias, personalización, firma y comanda limitan ancho; hechos, formularios, métricas y acciones permiten wrap en pantallas compactas.
- [x] Operaciones y Negocios cambian sidebar por navegación superior desplazable bajo 900 px; los grids de alta densidad colapsan antes de provocar scroll horizontal.
- [x] Matriz Chromium reproducible verde en 320×568, 390×844, 768×1024, 1024×768 y 1440×900 para Customer mobile, Driver, Flash Negocios, comercio desktop y Operaciones; valida acceso, overflow, destinos, targets y cambio de composición.
- [x] El portal desktop se conserva desde 620 px para activar su composición tablet; 320/390 usa el workspace táctil y el acceso Expo ya no desborda por su decoración absoluta.
- [~] Safe areas, teclado, orientación y Dynamic Type continúan abiertos hasta prueba física Android/iOS; no se infieren desde la matriz Chromium.

## Avance 22 de agosto de 2026 — ganancias contables de Flash Driver

- [x] `GET /api/driver/earnings` deriva identidad exclusivamente de la sesión Driver y devuelve cortes diario/semanal en su zona horaria, nunca acepta un `driverId` del cliente.
- [x] Servicios de comida, viajes/envíos, propinas y ajustes aprobados se clasifican desde asientos `posted`; los débitos conservan signo y el detalle queda limitado a 100 movimientos.
- [x] Home dejó de leer `metadata.earningsToday`: su importe y la pantalla Ganancias comparten el mismo cálculo PostgreSQL de doble partida.
- [x] Ganancias separa hoy, semana, servicios, propinas, ajustes, saldo Wallet, vacío/error/reintento y movimientos recientes, con barra inferior fija verificada en navegador.
- [x] OpenAPI y smoke PostgreSQL verifican `401`, `403`, ownership, `no-store`, sumas del ledger, categorías, ausencia de movimientos inventados y paridad entre Home/Ganancias.
- [~] El saldo Wallet y las sesiones/horas operativas son reales; retiro/liquidación externa permanece visible como no configurado hasta seleccionar PSP bancario, completar KYC/habilitación y hacer prueba controlada.

## Avance 22 de agosto de 2026 — jornadas operativas de Flash Driver

- [x] Las migraciones `107_driver_operational_sessions.sql` y `108_driver_job_session_assignment_reason.sql` registran intervalos online por modo y de asignación a cierre por job, con razones de apertura/cierre, índices parciales y baselines honestos para estados preexistentes.
- [x] Triggers PostgreSQL cubren disponibilidad, cambio de modo, reasignación, finalización, cancelación y desconexiones indirectas por compliance/vehículo/suspensión; no dependen de que una única ruta HTTP sea la autora del cambio.
- [x] Ganancias devuelve `onlineSeconds` y `activeSeconds` diario/semanal, recorta al huso horario y momento observado, y une solapamientos para no duplicar batching.
- [x] La API entrega una serie diaria ordenada y acotada a la semana local; importes diarios reconcilian contra ledger semanal y los intervalos se cortan por medianoche local.
- [x] La vista Ganancias presenta ingresos, jornada conectada/activa, proporción válida, resumen semanal, anomalía explícita, procedencia y refresco cada 60 segundos sin mezclar métricas con navegación.
- [x] Ganancias grafica el neto diario real con escala relativa, cero explícito y correcciones negativas diferenciadas; no instala un charting SDK ni agrega puntos de muestra.
- [x] Cada barra diaria es accesible y seleccionable; el detalle usa la misma respuesta para mostrar neto, servicios, propinas, conexión y tiempo activo sin otra fuente paralela.
- [x] Sin PostgreSQL no hay horas simuladas: el contrato responde `null` y procedencia no disponible. La métrica no habilita salario horario, promociones, surge ni garantía de ingreso.
- [x] Ownership RLS, auditoría de sólo lectura, `401/403`, `no-store`, atribución de razones y cálculo con trabajos concurrentes quedan cubiertos por smokes dedicados.
- [x] La semántica competitiva y las fronteras de producto se documentan en `docs/competitive-research/driver-operational-time.md`.

## Avance 22 de agosto de 2026 — operación real de Flash Negocios

- [x] `GET /api/merchant/dashboard` dejó de sumar el historial descargado por el cliente: deriva ownership de la sesión y calcula en PostgreSQL la cola viva y las métricas del día de la sucursal.
- [x] Las ventas diarias exigen un evento terminal `completed` dentro del día local; cancelaciones, ticket promedio y stock usan la misma fuente autoritativa.
- [x] Los pedidos nuevos persisten tiempo de preparación y plazo de listo como snapshots por pedido. El reloj empieza al aceptar el pago y no se modifica si luego cambia el ETA general del local.
- [x] Acción requerida, preparando, listo para retirar, courier en flujo, atrasos, pedido activo más antiguo y faltantes tienen conteos separados; los pedidos heredados sin snapshot quedan como `untrackedPrepOrders` y nunca se estiman.
- [x] El recurso es privado `no-store`, limita selección cruzada a administración, tiene contrato OpenAPI y smoke PostgreSQL dedicado.
- [x] La máquina de estados impone ownership: Comercio prepara y marca listo; sólo entonces dispatch publica ofertas y Driver puede retirar/entregar. Demanda Driver cuenta únicamente trabajos despachables.
- [x] La decisión se contrastó con DoorDash Merchant y Uber Eats Manager y queda registrada en `docs/competitive-research/merchant-live-operations.md`.
- [x] Desktop y Merchant App consumen el contrato privado: venta/ticket del día, cola, SLA y stock nunca se reconstruyen desde el historial parcial. Ambas superficies distinguen loading, error y última lectura conservada, refrescan por evento/poll acotado y muestran procedencia/horario.
- [x] La selección multi-comercio es explícita y revalida ownership; apertura y ETA actualizan comercio + sucursal principal en una única transacción. La app móvil sólo ofrece las transiciones de cocina que pertenecen al comercio.
- [x] `GET /api/merchant/orders/active` reemplaza la lista derivada de actividad parcial: exige selección propia, prioriza acción/plazo/etapa en PostgreSQL, excluye terminales, limita 100 y declara `hasMore` en lugar de truncar silenciosamente.
- [x] Merchant App dejó de ser una pantalla plana: Hoy, Pedidos, Catálogo y Cuenta tienen contenido propio y navegación inferior fija/accesible. Pedidos y desktop comparten la cola autoritativa; estados que pertenecen al courier ya no muestran CTA de comercio.
- [x] Desktop y Merchant App abren una comanda real y responsive con sucursal, plazo, courier, destino, productos, extras, notas e historial de cambios; el chat conserva el contexto del pedido.
- [x] La cola expone la sucursal autoritativa y el faltante sólo modifica su inventario. PostgreSQL rechaza reemplazos iguales, globalmente o localmente inactivos, sin stock suficiente o más caros que el original.
- [x] Las propuestas quedan pendientes hasta decisión explícita del cliente y bloquean el avance del pedido. Aceptar un reemplazo más barato produce el reintegro exacto mediante el ledger Wallet balanceado.
- [x] Contratos OpenAPI para consultar/proponer/decidir sustituciones y smokes de ownership, inventario, consentimiento y UI impiden volver a una gestión hardcodeada.
- [~] La composición amplia de desktop y la superficie mobile/web se verificaron visualmente con datos PostgreSQL. Falta prueba física en build nativo, teclado/safe areas y red degradada; el pre-dispatch antes de “listo” requiere separar estados de cocina/logística y medir esperas reales.

## Avance 22 de agosto de 2026 — preferencia de navegación Driver

- [x] La migración `106_driver_preferences.sql` persiste un único proveedor de handoff por conductor (`system`, `google_maps`, `apple_maps`) con constraint, ownership RLS y visibilidad auditora de sólo lectura.
- [x] `GET/PATCH /api/driver/preferences` deriva el conductor de la sesión, valida un enum cerrado, responde `no-store` y audita cada cambio sin registrar ubicación.
- [x] Cuenta Driver presenta radios accesibles y estados guardando/error; Apple Maps sólo se ofrece visualmente en iOS, mientras Predeterminada y Google Maps respetan plataforma y tipo de vehículo.
- [x] El cockpit usa la preferencia persistida al construir la URL oficial y conserva el destino/trabajo dentro de Flash; cambiar proveedor no altera la ruta autoritativa ni el estado del servicio.
- [x] Smoke API/PostgreSQL, contrato OpenAPI, RLS, URLs iOS/Android, build/typecheck y prueba visual real en navegador están verdes.

## Avance 22 de agosto de 2026 — demanda zonal real de Flash Driver

- [x] `GET /api/driver/demand-zones` deriva ciudad y modo desde la sesión Driver y calcula en una transacción consistente trabajos abiertos y oferta elegible por polígono PostGIS.
- [x] La oferta excluye GPS con más de 5 minutos o peor a 100 m, compliance/vehículo no aprobados y conductores sin capacidad; nunca se exponen puntos de trabajos u otros conductores.
- [x] OpenAPI y smoke físico verifican roles, `no-store`, conteos contra SQL, geometría agregada y bandas deterministas.
- [x] La investigación competitiva y la metodología quedan registradas en `docs/competitive-research/driver-demand-zones.md`; el contrato declara que no pronostica ofertas/ganancias ni altera precios.
- [x] Home Driver muestra primero el mapa operativo: libre renderiza polígonos nativos y tarjetas con loading/empty/error/stale/refresh; con trabajo activo reemplaza demanda por ruta y cockpit sin mezclar contextos.
- [x] Android/iOS compilan el renderer `react-native-maps`; web mobile degrada explícitamente sin evaluar el SDK nativo y conserva los conteos verificables. Typecheck, Expo Doctor 21/21, exports Android/iOS/web y prueba visual real están verdes.
- [~] Forecast, surge y recomendación de posicionamiento permanecen bloqueados hasta disponer de datos/modelo, monitoreo de sesgos y operación real; la cartografía nativa productiva aún requiere clave restringida, builds firmados y prueba física.

## Avance 22 de agosto de 2026 — mapas nativos mobile

- [x] Comida, Viajes y Envíos reemplazan teselas HTML, proyección Mercator y líneas SVG por un único `MapView` nativo interactivo con pan, zoom, reencuadre y marcadores accesibles.
- [x] Android usa Google Maps con estilo Flash neutral y clave inyectada durante el build; iOS usa Apple MapKit `mutedStandard`. La app muestra un estado explícito en Android si la clave no fue configurada.
- [x] Cotizaciones de viajes y envíos, más tracking de las tres verticales, dibujan exclusivamente geometría vial devuelta por `/api/maps/route`; el conductor sólo aparece con una ubicación persistida real.
- [x] El cotizador de Envíos dejó de precargar un destino ficticio, invalida coordenadas/tarifa al editar y calcula ruta y cotización contra los mismos puntos geocodificados.
- [x] `react-native-maps` quedó fijado en la versión compatible instalada por Expo SDK 57; TypeScript, Expo Doctor 21/21, exports Metro Android/iOS/web, auditoría y contratos mobile están verdes.
- [~] Faltan registrar y restringir una clave Google Maps productiva, crear builds firmados EAS y verificar cartografía/GPS prolongadamente en dispositivos Android/iOS reales.

## Avance 22 de agosto de 2026 — navegación visual de Flash Driver

- [x] La app de conductor muestra un mapa nativo del GPS vigente al próximo pickup/destino para comida, viajes o envíos, con ruta vial, color por vertical y reencuadre.
- [x] La guía interna vive sólo en Driver y abre un cockpit dedicado con maniobra dominante, distancia a la maniobra, ETA, tres pasos próximos, etapa, destino, chat y traspaso a la guía completa del dispositivo.
- [x] El tracking del pasajero conserva ruta, ETA, conductor y seguridad, pero dejó de mostrar instrucciones viales destinadas a quien conduce.
- [x] Viajes y envíos precargan como origen la dirección predeterminada sólo cuando posee coordenadas persistidas; el usuario ve contexto cartográfico desde el primer destino sin geocodificar ni inventar una ubicación nuevamente.
- [x] Cambiar de trabajo o fase elimina inmediatamente la geometría anterior; una falla de routing se informa y nunca deja visible una ruta obsoleta.
- [x] El botón Navegar delega giro a giro a Apple Maps para conducción iOS o a Google Maps mediante URL universal para Android, bicicleta y fallback web, sin requerir otra clave.
- [x] La URL omite el origen para que el proveedor use la ubicación actual del dispositivo, y sólo se habilita desde un job real con destino geográfico.
- [~] La guía interna conserva maniobras/ETA del adaptador actual; tráfico, desvíos en vivo y ensayo físico en movimiento requieren proveedor productivo, build firmado y prueba vial controlada.

## Corrección 22 de agosto de 2026 — aislamiento del SDK cartográfico por plataforma

- [x] Expo web dejó de evaluar `react-native-maps`, que sólo existe en Android/iOS y rompía el runtime aunque el export Metro terminara correctamente.
- [x] La resolución `.native.tsx` conserva Google Maps/MapKit y `.web.tsx` entrega un estado visual explícito; el fallback TypeScript nunca importa el módulo nativo.
- [x] `test:mobile-maps` bloquea regresiones verificando que la implementación web no dependa del SDK nativo.
- [x] TypeScript, export web y ejecución real en `http://127.0.0.1:8081/` quedaron verdes; se inspeccionaron Home y Viajes sin error de runtime.

## Corrección 22 de agosto de 2026 — sesión web sin tormenta de refresh

- [x] Las respuestas `401` concurrentes comparten una única rotación de refresh; una respuesta tardía que usó el access token anterior reutiliza la credencial ya rotada.
- [x] Polling de estado y SSE sólo se inician con una sesión confirmada y se detienen al recibir el evento central de autenticación requerida.
- [x] El bootstrap inicial se ejecuta una vez incluso bajo el doble montaje deliberado de React Strict Mode en desarrollo.
- [x] Una prueba determinista cubre doce `401` simultáneos, recuperación tras falla y respuesta tardía; build y contratos de red están verdes.
- [x] Prueba real aislada en navegador: el arranque anónimo hizo una sola comprobación de cookie y generó cero llamadas API durante el ciclo posterior de 18 segundos.

## Avance 22 de agosto de 2026 — mapa web interactivo de Viajes

- [x] La vista previa de Viajes reemplaza la grilla fija 3×3 por MapLibre GL JS con pan, zoom, controles accesibles y reencuadre automático de todos los puntos reales.
- [x] La geometría OSRM se dibuja como capa GeoJSON con casing; origen, destino y conductor usan jerarquía Flash y nunca aparece una línea directa cuando routing no responde.
- [x] El renderer GPU y su CSS se cargan en un chunk asíncrono independiente, conservando el presupuesto del JavaScript inicial.
- [x] El fallback OpenStreetMap conserva atribución y CSP autoriza sólo orígenes HTTPS enumerados; `VITE_MAP_STYLE_URL` habilita un estilo vectorial público sustituible sin exponer secretos privados.
- [~] Falta contratar o autohospedar tiles/estilo vectorial web con SLA y verificarlo en dispositivos; la migración mobile se registra en el bloque posterior.

## Avance 22 de agosto de 2026 — mapas web unificados por vertical

- [x] Tracking autenticado de comida, viajes y envíos, más el enlace público de viaje, reutilizan el mismo renderer MapLibre interactivo.
- [x] Comida conserva ruta naranja, movilidad violeta y envíos verde; las cuatro superficies permiten pan, zoom y reencuadre sin deformar la geometría.
- [x] Las actualizaciones reemplazan GeoJSON y marcadores reales sin acumular capas; el enlace público no dibuja ruta porque su contrato mínimo no entrega esa geometría.
- [x] Se retiraron la proyección Mercator manual, nueve `<img>` por mapa, polylines SVG y estilos legacy de tracking web.
- [x] `test:web-tracking-maps`, build y bundle budget protegen reutilización, carga asíncrona y ausencia de movimiento inventado.
- [~] El renderer mobile está integrado; estilo vectorial web productivo, credencial Android restringida, builds firmados y prueba física siguen pendientes.

## Avance 22 de agosto de 2026 — inicio real de Viajes web

- [x] Desktop/PWA dejó de precargar Defensa→Aeroparque: toma una vez la dirección principal geocodificada del usuario o muestra un estado vacío honesto.
- [x] GPS, edición manual y destinos guardados invalidan coordenadas/tarifa anteriores; no se puede cotizar sin origen y destino explícitos.
- [x] La vista previa usa `/routes`, polyline y teselas OpenStreetMap con atribución; si no hay coordenadas no dibuja una ruta ni un vehículo inventados.
- [x] La superficie Viajes se carga como chunk independiente, reduciendo nuevamente el JavaScript inicial en lugar de relajar el presupuesto.
- [x] `test:web-ride-home`, build, mobile typecheck y bundle budget cubren la integración; navegación/ubicación física prolongada continúa pendiente de dispositivo y proveedor productivo.

## Corrección 22 de agosto de 2026 — migración física de verificación telefónica

- [x] `097_phone_verification.sql` ya no falla al encontrar `users.phone_verified_at`, columna creada originalmente por la migración `003`; conserva compatibilidad con reconstrucciones y bases existentes.
- [x] PostgreSQL 17.11/PostGIS 3.6 aplicó `097`–`105`; mapas y RLS físicos quedaron verdes.
- [x] El contador OTP ahora tipa el parámetro como `smallint`, persiste cinco intentos fallidos y responde `400` en vez de filtrar un error SQL `500`; la suite sandbox completa quedó verde.
- [~] Restore drill local quedó verde; SMS real y restore sobre infraestructura administrada continúan pendientes.

## Verificación 22 de agosto de 2026 — recuperación física local

- [x] Backup custom de 1.207.839 bytes con manifiesto SHA-256 verificado, ACL incluidas, tablas requeridas y esquema íntegramente legible.
- [x] Restore sobre cluster PostgreSQL temporal aislado validó, al 25-08, 105 migraciones, PostGIS 3.6.2, constraints, RLS, auditor append-only, cadena de auditoría y cero desbalances de ledger.
- [x] El cluster temporal fue detenido y eliminado por el procedimiento después de la verificación; la base activa no fue restaurada ni modificada por el drill.
- [~] Falta repetir el simulacro con PITR/HA en una cuenta administrada aislada; no se presenta el backup local como recuperación productiva.

## Avance 22 de agosto de 2026 — checkout web de comida sin datos simulados

- [x] Desktop/PWA eliminó la dirección visible fija y ofrece sólo direcciones privadas con coordenadas verificadas de la cuenta autenticada.
- [x] Cambiar dirección, Wallet/tarjeta, promoción o carrito invalida la cotización anterior y solicita al backend un nuevo total firmado.
- [x] Distancia, ETA, versión tarifaria, desglose y vencimiento provienen de `/orders/quote`; confirmar reutiliza exactamente ese token y bloquea cotizaciones vencidas o fallidas.
- [x] Wallet usa el método propio persistido y Mercado Pago sólo aparece si el comercio y la clave pública están realmente configurados; PAN/CVV permanece dentro del Brick oficial.
- [x] `test:web-checkout`, build, bundle budget y contratos PostgreSQL existentes cubren la frontera cliente-servidor; la prueba visual y sandbox externa sigue condicionada al motor/credenciales reales.
- [x] La analítica first-party se carga fuera del camino crítico web y conserva su cola no bloqueante, evitando relajar el presupuesto de JavaScript inicial tras sumar el checkout.

## Avance 22 de agosto de 2026 — resiliencia de red web y mobile

- [x] El cliente web y el cliente mobile aplican timeout de 12 segundos a las llamadas HTTP para no dejar pantallas bloqueadas indefinidamente.
- [x] Las lecturas `GET`, `HEAD` y `OPTIONS` reintentan una sola vez después de un corte transitorio; `POST`, `PATCH` y `DELETE` no se reintentan automáticamente para evitar duplicar pedidos, viajes, pagos, cancelaciones o evidencias.
- [x] Web escucha conectividad del navegador y fallas de transporte, muestra una alerta accesible de offline/reconexión y refresca al recuperar conexión; el desktop operativo también queda visible.
- [x] Mobile incorpora `expo-network` compatible con Expo SDK 57, escucha conectividad nativa y refresca el estado al volver internet; el canal de estado offline es explícito.
- [x] `test:network-resilience`, `build` y `mobile:typecheck` cubren la política de transporte y los puntos de integración del frontend.
- [~] No se presenta una cola offline de escrituras como capacidad productiva: queda pendiente diseñar persistencia local, expiración, consentimiento visible e idempotencia por operación antes de permitir acciones diferidas.

Decisión técnica: se usa el módulo oficial [Expo Network](https://docs.expo.dev/versions/latest/sdk/network/) para observar conectividad en la app nativa y se mantiene `fetch` con `AbortController` para el transporte, evitando introducir un cliente HTTP adicional en esta etapa. La resiliencia sólo suaviza fallas de lectura; la autoridad de pedidos, pagos y estados sigue siendo el backend.

## Avance 22 de agosto de 2026 — analytics first-party web, mobile y fallback local

- [x] Web, Customer App, Driver App y Merchant App envían un vocabulario cerrado de eventos de producto: home, búsqueda iniciada, comercio visto, carrito, checkout, cotización, job creado y actividad.
- [x] La cola cliente genera IDs UUID, agrupa hasta veinte eventos, limita memoria a cien eventos y reintenta espaciado sin bloquear pedidos, viajes, envíos ni pagos cuando el transporte falla.
- [x] El cliente filtra claves sensibles antes de transmitir y el backend vuelve a validar que no entren email, teléfono, dirección, coordenadas, tokens, nombres, notas, búsquedas ni texto libre.
- [x] PostgreSQL conserva la migración, deduplicación por `public_id`, retención de 90 días y métricas agregadas de embudo; SQLite demo implementa el mismo contrato, RBAC y métricas sin consultar un pool nulo.
- [x] `test:product-analytics-local` verifica lote válido, deduplicación, rechazo de PII, aislamiento de métricas y funnel; `analytics:prune` funciona tanto con PostgreSQL como con el fallback local.
- [~] La base de instrumentación está lista, pero el prep-time predictivo, cohortes, dashboards productivos y consentimiento legal por jurisdicción siguen pendientes antes de una beta abierta.

Decisión competitiva: [Uber describe una plataforma de experimentación con métricas administradas para rider, driver, Eats y otras superficies](https://www.uber.com/us/en/blog/xp/), y [su modelo de sessionización combina eventos de rider, driver y backend](https://www.uber.com/us/en/blog/sessionizing-data/). Flash adopta la disciplina de métricas y embudo, pero mantiene un contrato first-party pequeño, eventos pseudónimos y agregados operativos, sin SDK publicitario, fingerprinting ni copiar activos o código propietario. Los cambios de producto se validarán por pilotos controlados, coherente con el enfoque de [Uber para nuevos pilotos de marketplace](https://www.uber.com/us/en/marketplace/open-marketplace/new-product-pilots/).

## Corrección 22 de agosto de 2026 — preferencias alimentarias en demo local

- [x] El bootstrap de cliente ya no intenta usar `postgresPool.query` cuando se ejecuta sin `DATABASE_URL`: las preferencias alimentarias tienen tabla SQLite persistente, migración idempotente y ownership por usuario.
- [x] `GET` y `PUT /api/dietary-preferences` mantienen el contrato de PostgreSQL, validan el mismo esquema y registran auditoría local; las preferencias sobreviven a la escritura de eventos de auditoría.
- [x] `test:dietary-local` cubre lectura inicial, actualización, persistencia y contrato de respuesta; se verificó la recuperación del frontend en el navegador después de reiniciar el API.
- [~] SQLite sigue siendo sólo modo demo/desarrollo; producción requiere PostgreSQL con migraciones `059` y `060` aplicadas.

## Corrección 22 de agosto de 2026 — guard de rol en dashboard web

- [x] El frontend sólo solicita `/api/admin/dashboard` cuando el usuario autenticado tiene rol `admin`; clientes y comercios no generan llamadas prohibidas durante bootstrap o refresh.
- [x] El backend mantiene la denegación `403` como defensa autoritativa si un cliente intenta llamar directamente al dashboard; la corrección evita el ruido de consola sin debilitar autorización.
- [x] `test:network-resilience` verifica el guard de rol y se validó el bundle nuevo en navegador sin errores de consola.

## Corrección 22 de agosto de 2026 — panel operativo local

- [x] Comercios, conductores, usuarios, soporte y auditoría operativos seleccionan PostgreSQL cuando `DATABASE_URL` está configurado y el fallback SQLite local cuando se ejecuta el entorno demo.
- [x] El fallback conserva autorización de administrador, filtros, límites, cursores opacos, respuestas privadas y serializadores sin credenciales.
- [x] `test:operations-resources` cubre aislamiento por rol y paginación de las cinco superficies.
- [~] El fallback SQLite sólo sirve para desarrollo/demo local; staging y producción deben usar PostgreSQL/PostGIS y sus migraciones.

## Avance 22 de agosto de 2026 — centro de notificaciones web y SQLite

- [x] El modo local usa tablas SQLite persistentes para `notifications` y `notification_preferences`, con migración idempotente al iniciar sin borrar datos existentes.
- [x] `GET /api/notifications`, lectura por ownership y preferencias por categoría tienen el mismo contrato funcional que PostgreSQL; otra cuenta recibe `404` al intentar leer una notificación ajena.
- [x] Pedidos, viajes y envíos locales emiten eventos in-app persistentes al crearse y al avanzar de estado; el historial no depende de datos estáticos del frontend.
- [x] Web/PWA incorpora centro de notificaciones desde la campana, contador de no leídas, estado vacío, canal visible y switches de preferencias push por categoría.
- [x] Mobile ya consume la misma bandeja y preferencias, por lo que el fallback local deja de responder vacío/500 en desarrollo.
- [x] `test:notification-local` cubre persistencia, preferencias, lectura propia y aislamiento entre cuentas; `test:security`, `test:web-delivery`, `test:operations-resources` y `mobile:typecheck` siguen verdes.
- [~] Push, email y SMS productivos siguen condicionados a registrar proveedores, dispositivos y credenciales reales; en local se declara explícitamente que el canal activo es in-app.

Decisión competitiva: se adopta una bandeja transaccional persistente y preferencias separadas de marketing, siguiendo el comportamiento documentado por [Uber sobre preferencias de notificación](https://help.uber.com/driving-and-delivering/article/change-notification-settings?nodeId=dd318478-7ac5-4017-9936-db431dd8194d) y [Uber Eats sobre avisos de progreso y llegada](https://help.uber.com/en/ubereats/restaurants/article/tips-to-receive-your-order-smoothly?nodeId=92f776cc-5893-4448-867f-09dfcddd3a52). No se presenta un proveedor externo como activo hasta completar su habilitación.

### Estado ejecutivo de bloqueadores

> **Nota de nomenclatura (25 de agosto de 2026).** Los identificadores de esta sección son históricos y **no** corresponden a los del [backlog técnico](docs/backlog-tecnico.md) vigente. En particular, el `SEC-001` histórico designa el aislamiento entre audiencias (cerrado), mientras que el `SEC-001` del backlog nuevo designa el default-deny del realtime (abierto). Ante conflicto, manda el backlog técnico.
>
> Los estados `[x]` de abajo significan «verificado localmente». Tras la auditoría del 25 de agosto se sabe que **casi ninguno está protegido por una puerta CI**, porque CI no levanta PostgreSQL. Un `[x]` local no equivale a una garantía continua: ver [`docs/matriz-madurez.md`](docs/matriz-madurez.md).

- [x] **P0-01 / SEC-001 — aislamiento.** Ownership, serializers por rol, RLS físico y tests cross-tenant funcionan. Web, mobile y suites migraron a bootstrap y recursos segmentados; `/api/state` responde permanentemente `410 Gone`.
- [x] **P0-02 / DAT-001 — PostgreSQL/PostGIS.** Runtime principal, migraciones, índices, transacciones por operación, auditoría append-only, backup y restore drill operativos; SQLite está aislado como fallback de tests.
- [~] **P0-03 / IAM-001 — identidad.** Access/refresh rotativo, refresh web en cookie HttpOnly con defensa de origen, respuestas autenticadas `no-store`, sesiones remotas, recuperación, email OTP, MFA admin y suspensión funcionan. Teléfono E.164 tiene OTP y adaptador Twilio; migraciones hasta `105`, RLS y prueba física sandbox están verdes. Payouts exigen step-up WYSIWYS de un solo uso ligado a comercio/importe. Falta prueba SMS real con cuenta/proveedor habilitado.
- [~] **P0-04 / PAY-001 — dinero.** Payment intents, Wallet sandbox, ledger, reservas, conciliación y riesgo existen. Mercado Pago suma OAuth seller con PKCE S256, tokens cifrados y rotación automática, Card Payment Brick web oficial cargado bajo demanda, readiness por comercio, tokenización sin PAN/CVV, creación idempotente con `application_fee`, saga sin despacho hasta `approved`, conciliación estricta por webhook, captura balanceada y refund real previo a cancelar con reserva contra carreras. El split del seller queda fuera del saldo retirable interno para no duplicar fondos. Migraciones hasta `105` están aplicadas; faltan Core Methods nativo mobile, scheduler/alertas productivas del worker OAuth, alta comercial/credenciales, conciliar tasas del reporte del PSP y prueba sandbox/visual física.
- [x] **P0-05 / IDEM-001 — concurrencia.** Idempotencia, constraints, locks, ofertas privadas, TTL, aceptación atómica, dedupe y prune acotado/concurrente de claves vencidas cubiertos.
- [x] **P0-05b / API-001 — contratos de escritura.** Las mutaciones con cuerpo exigen JSON, rechazan media types ambiguos con `415` y validan payloads tipados antes de escribir.
- [~] **P0-06 / GEO-001 — mapas.** Geocoding, PostGIS, zonas, OSRM, polylines, caché, quotes firmados, circuit breaker, stale controlado, presupuesto y métricas funcionan. Faltan tráfico/Route Matrix productivo y cuota distribuida.
- [~] **P0-07 / RT-001/MOB-001 — ubicación y push.** Background nativo, stale-location gate, outbox, worker, reintentos y dead-letter operativos. Faltan FCM/APNs, builds firmados y ensayo físico.
- [~] **P0-08 — safety/regulación.** KYC, vehículos, PIN, trusted contacts, share trip, SOS y soporte prioritario funcionan. Viajes públicos siguen bloqueados hasta seguros, habilitación, anomalías y procedimientos reales.

### Secuencia de ejecución vigente

> **Sustituida el 25 de agosto de 2026** por [`docs/plan-de-accion.md`](docs/plan-de-accion.md), que fija fechas, entregables semanales y criterios de salida verificables por fase. La secuencia de abajo se conserva como registro del estado alcanzado hasta el 22 de agosto; su numeración de fases **no** coincide con la del plan vigente.

#### Fase 0 — estabilización inmediata

- [x] Sin auto-login ni selector productivo de identidades.
- [x] Retirar `/api/state`: todos los consumidores migrados; la ruta responde `410 Gone`.
- [x] Scoping por rol, ownership y RLS físico.
- [~] Ocultar o etiquetar capacidades dependientes de PSP, aseguradora, push o factura fiscal.
- [x] Máquinas de estado, permisos, pagos y ledger implementados/documentados.
- [~] Threat model y ambientes: endurecimiento documentado; faltan staging administrado y secret manager.
- [x] Escaneo automático de secretos y dependencias de severidad alta/crítica como puertas CI bloqueantes (`test:secrets` y `test:dependency-gate`); runtimes web/API/mobile en cero vulnerabilidades conocidas.

#### Fase 1 — core productivo

- [~] Monolito modular por repositorios; falta migrar Express y frontend principal a TypeScript modular.
- [~] Bundle web con React e iconos cacheables, tracking público diferido y minificación productiva Terser: entry propio 457,2 KiB y carga inicial 845,8 KiB bajo presupuestos CI de 560/850 KiB. Falta extraer Customer, Negocios y Operaciones del `App.tsx` monolítico y medir Core Web Vitals con tráfico real.
- [x] Entrega web productiva con gzip dinámico, assets versionados inmutables por un año, HTML revalidable y SSE excluido de compresión para evitar buffering; contrato HTTP bloqueante en CI.
- [x] CSP activa por defecto: scripts same-origin, sin `unsafe-eval`, objetos/iframes bloqueados y allowlist explícita para API, mapas, imágenes, workers y estilos necesarios; contrato bloqueante sobre el HTML real.
- [x] Viajes exige cotización JWT vigente en PostgreSQL igual que comida/envíos; desktop consume opciones firmadas, invalida tarifa al cambiar ruta/categoría y bloquea confirmación sin recotizar. El endpoint legacy también firma su respuesta.
- [x] PostgreSQL/PostGIS, al 25-08 105 migraciones, idempotencia, locks, auth, MFA, outbox, métricas, backup y restore local verificado.
- [x] Autorización ampliamente probada; OpenAPI 3.1 y contratos runtime cubren plataforma, geografía, auth, sesiones, cotización/creación idempotente de comida/viajes/envíos, conexión PSP, comprobantes, tracking temporal, ofertas privadas, soporte y backoffice operativo. OpenTelemetry HTTP/PostgreSQL exporta por OTLP.
- [~] Redis con readiness obligatorio, rate limiting compartido y ensayo real de dos réplicas en CI; falta migrar presencia realtime y validar un servicio administrado con failover.
- [x] El entorno Docker separa owner/migrador, runtime y auditor; readiness productivo rechaza roles con `BYPASSRLS` o propietarios del esquema y CI impide volver a credenciales compartidas.
- [x] Despliegues drenan readiness y SSE, dejan finalizar HTTP, aplican un límite configurable y cierran listener realtime, PostgreSQL, Redis y OpenTelemetry en orden; Docker concede 20 segundos antes de matar el contenedor.

#### Fase 2 — delivery beta-ready

- [x] Rutas, zonas, pricing, dispatch TTL, background GPS, prueba de entrega, SLA, onboarding y operación sin SQL.
- [~] Superficies estrictas por rol; faltan targets/builds firmados independientes.
- [ ] PSP marketplace sandbox externo conciliado.
- [ ] Push FCM/APNs probado físicamente.

#### Fase 3 — beta cerrada

- [x] Sustituciones, refunds, cancelaciones, ratings, suspensiones, promociones, soporte y métricas financieras de ledger.
  - La propina también se toma en el checkout (migración 126, GTM-001): se cobra con el pedido en un solo cargo, queda retenida hasta que hay conductor, y se libera entera al liquidar. No entra en el reparto entre comercio, conductor y plataforma.
  - Los pedidos de comida se programan y **cualquier reserva se puede mover** (migración 127, GTM-001). `PATCH /api/jobs/:id/schedule` vale para pedidos y viajes, sólo mientras nadie empezó. La ventana de reserva dejó de estar duplicada dentro del router de viajes, y una reserva futura ya no cuenta como trabajo activo del comercio.
  - **Pedidos grupales** (migración 128, GTM-001), en web y móvil: canasta por participante, tope de gasto por persona verificado contra la base, y un código de seis caracteres que no da lectura por sí solo. Un grupo confirmado se convierte en un pedido normal, así que nada aguas abajo necesita un caso especial.
  - **Con esto GTM-001 cierra sus cuatro criterios de producto.** Lo que queda del ticket es comercial —precio, oferta, medición—, no de ingeniería.
- [~] Payout/conciliación interna; falta adaptador bancario/PSP.
- [~] Feature flags, analytics first-party y go/no-go de zona basado en supply/comercios/volumen/cancelaciones/soporte listos; la instrumentación base web/mobile y el funnel agregado ya están operativos, pero faltan prep-time predictivo, cohortes, dashboards productivos y consentimiento legal.

#### Fase 4 — piloto de movilidad

- [~] KYC, vehículos, PIN, contactos, compartir recorrido, SOS y chat cifrado: los contratos y flujos internos existen, pero KYC no está homologado ni conectado a un proveedor productivo y las funciones de seguridad requieren piloto físico y operación habilitada.
- [ ] KYC automatizado por riesgo conforme a [`docs/estrategia-kyc-automatizado.md`](docs/estrategia-kyc-automatizado.md): procesamiento directo para casos de alta confianza, recaptura automática y revisión excepcional antes de toda decisión adversa. Es candidato post-Fase 0; faltan proveedor, RFP, evaluación biométrica, DPIA, revisión legal, piloto físico y homologaciones.
- [ ] Seguros/habilitación local, anomalías, privacidad telefónica, no-show/waiting fees, accidentes y aseguradora.

#### Fases 5/6 — B2B y multiciudad

- [~] Referidos, jobs programados, **suscripción** y **pedidos grupales** existen; faltan Flash Business, centros de costo, POS, logística híbrida y multi-stop.
  - *Flash Más* (migración 125, GTM-001) entrega el envío sin cargo desde un monto, cableado en web y móvil y revalidado al crear el pedido. Los otros dos beneficios del plan —comisión reducida en viajes y prioridad de dispatch— están en la fila y todavía no se aplican: el estimador de viajes es público y el orden de candidatos lo decide DSP-001. No cobra: el cobro recurrente depende de PAY-001.
- [ ] `city_id` transversal, aislamiento por ciudad, warehouse, experimentación y playbook de apertura.

### Próximos bloques, en orden

1. [x] **SEC-001:** Todos los consumidores y suites componen recursos segmentados. `/api/me` concentra sólo contexto propio; operaciones usa recursos paginados, configuración usa contratos cacheables y `/api/state` responde `410 Gone`.
2. [~] **TST-001:** escaneo CI de secretos y gate de dependencias críticas activos; Mercado Pago prueba idempotencia, respuestas mínimas, red, rate limit y errores sanitizados. Faltan contratos de mapas/push y caos sobre infraestructura externa.
3. [~] **MOB-001:** perfiles EAS Customer, Driver y Merchant, IDs/schemes separados, role gate y permisos mínimos por build listos; faltan credenciales, asociación EAS y builds físicos firmados.
4. [~] **OBS-001:** OpenTelemetry OTLP instrumenta HTTP/Express/PostgreSQL; CI verifica exportación, SLO/error budget y alertas Prometheus con runbooks. Faltan colector/dashboards/Alertmanager administrados y paging productivo.
5. [~] **P1-09:** entidad ciudad, asociaciones obligatorias, índices, Buenos Aires beta y contrato público/zonas aislado implementados; faltan RLS transversal por ciudad y playbook antes de habilitar una segunda ciudad.
6. [ ] **Externos:** PSP, FCM/APNs, staging, seguros y habilitaciones; nunca simular su finalización.

## Avance 15 de agosto de 2026 — Tracking background nativo

- [x] Tarea Expo global para GPS background, foreground service Android y background mode iOS.
- [x] Inicio/detención ligados a disponibilidad y logout, con fallback foreground explícito en web/Expo Go.
- [x] Refresh tokens migrados de AsyncStorage nativo a Keychain/Keystore mediante SecureStore.
- [x] Source, precisión y fecha persistidos; dispatch descarta fixes de más de diez minutos o precisión mayor a 200 m.
- [x] Cambio de modo online revalida compatibilidad del vehículo y no puede dejar supply inconsistente.
- [x] Coordenadas precisas retiradas del audit append-only histórico y cadena SHA-256 reconstruida/verificada.
- [x] Expo Doctor 21/21 y bundles Metro web/iOS/Android generados; falta ensayo físico prolongado y builds EAS firmados.

## Avance 15 de agosto de 2026 — Flota real del conductor

- [x] Registro PostgreSQL de hasta cinco vehículos con patente única, tipo, capacidad y modos compatibles.
- [x] Mobile permite alta, selección del vehículo activo y retiro no destructivo.
- [x] Operaciones revisa cada alta o edición y registra aprobación o rechazo fundado.
- [x] Editar o retirar el vehículo activo desconecta al conductor automáticamente.
- [x] Conexión y dispatch exigen vehículo activo, aprobado y compatible; `online` por sí solo no alcanza.
- [x] RLS, ownership, auditoría y privilegios por columna ocultan patente/modelo/color al rol auditor.

## Avance 15 de agosto de 2026 — Chat operacional cifrado multivertical

- [x] Conversación PostgreSQL compartida por comida, viajes y envíos.
- [x] Participantes derivados del job: cliente, conductor asignado y comercio propietario.
- [x] Cuerpos AES-256-GCM; auditor, realtime y notificaciones reciben sólo metadatos.
- [x] RLS, ownership API, límite de envío y cierre automático al finalizar/cancelar.
- [x] Interfaz mobile reutilizable en Actividad, cocina del comercio y trabajos del conductor.
- [x] Prueba end-to-end bidireccional, aislamiento entre cuentas y verificación directa del cifrado.
- [x] Confirmaciones de lectura persistentes, idempotentes y visibles al remitente.
- [x] Respuestas rápidas operativas reutilizables en las tres verticales.
- [x] Adjuntos JPEG/PNG/PDF cifrados, con MIME verificado, límite, ownership y apertura nativa mobile.
- [x] Catálogo de respuestas rápidas configurable desde operaciones por vertical, rol, idioma, orden y vigencia.

## Avance 15 de agosto de 2026 — Verificación de pasajero por PIN

- [x] Todo viaje nuevo crea el desafío en la misma transacción PostgreSQL que el job.
- [x] El pasajero consulta un PIN derivado; la base sólo conserva bcrypt.
- [x] El conductor asignado debe verificarlo al llegar antes de iniciar el recorrido.
- [x] Cinco errores bloquean el desafío diez minutos y el rate limiter protege el endpoint.
- [x] Ownership, RLS y privilegios de columna ocultan PIN/hash a terceros y al auditor.
- [x] Mobile pasajero muestra el código dentro del tracking; mobile conductor verifica e inicia en una sola acción.
- [x] Compatibilidad explícita para viajes activos anteriores al rollout, sin debilitar viajes nuevos.

## Avance 15 de agosto de 2026 — Seguimiento dedicado de Viajes

- [x] Hoja mobile tipo Lyft accesible desde Viajes y Actividad.
- [x] Estados Buscando, Asignado, Llegando, En curso y Finalizado derivados del job PostgreSQL.
- [x] Mapa OSM con ruta OSRM, pickup, destino y posición vigente del conductor.
- [x] Tarjeta de conductor con identidad, vehículo y rating reales del asignado.
- [x] Actualización periódica mientras la vista está abierta, sin animar posiciones inventadas.
- [x] Centro de seguridad integrado: enlace temporal, contactos cifrados, SOS y cancelación con motivo.
- [x] Bundle Expo web, TypeScript y build desktop verificados.

## Avance 15 de agosto de 2026 — Contactos de confianza cifrados

- [x] CRUD mobile/API para hasta cinco contactos de seguridad por cliente.
- [x] Teléfonos E.164 cifrados con AES-256-GCM y deduplicados mediante HMAC; sólo se muestran últimos cuatro dígitos.
- [x] RLS y ownership bloquean lectura y borrado entre cuentas.
- [x] El auditor no puede consultar nombre, teléfono cifrado ni hash de deduplicación.
- [x] Un viaje activo puede generar un enlace temporal y abrir el selector nativo dirigido al contacto elegido.
- [x] Pruebas end-to-end verifican cifrado en reposo, actualización idempotente, aislamiento y borrado.

## Avance 15 de agosto de 2026 — Destinos privados y frecuentes de Viajes

- [x] Se eliminaron Aeroparque/Trabajo hardcodeados del buscador mobile.
- [x] Casa, Trabajo y demás direcciones guardadas reutilizan coordenadas PostGIS exactas.
- [x] Los destinos cotizados se persisten por usuario, se deduplican por dirección normalizada y acumulan frecuencia de uso.
- [x] La interfaz combina guardados y recientes, admite borrado y mantiene un estado vacío honesto.
- [x] Retención acotada a veinte recientes por cuenta, RLS, ownership API y auditoría sin dirección privada.
- [x] Pruebas end-to-end y RLS cubren aislamiento entre clientes y un usuario creado únicamente en PostgreSQL.

## Avance 15 de agosto de 2026 — Configuración operativa de Envíos

- [x] Consola desktop para administrar categorías, instrucciones, peso máximo, recargos, multiplicadores, ETA y distancia máxima.
- [x] Mutaciones PostgreSQL protegidas por rol `admin`, validación de rangos y respuestas 404/400 explícitas.
- [x] Auditoría común corregida para conservar estado anterior y posterior de cada cambio operativo.
- [x] La siguiente cotización usa inmediatamente la configuración publicada; la suite restaura los valores iniciales tras probarlo.
- [x] Clientes y conductores no pueden alterar configuración tarifaria ni SLA.
- [x] Opciones inactivas desaparecen de mobile pero siguen visibles y reactivables en Flash Admin.
- [x] Flujo de aprobación de cuatro ojos, programación de vigencia y worker de activación para cambios tarifarios.
- [x] Alertas persistidas por variaciones fuera de tolerancia y rollback gobernado desde la misma consola.

## Avance 15 de agosto de 2026 — Tracking visual dedicado de Envíos

- [x] Actividad abre una vista de seguimiento propia para cada envío activo.
- [x] Mapa OSM y ruta vial real usan las coordenadas PostGIS persistidas y el proveedor Routes/cache de la API.
- [x] Encuadre adaptativo evita rutas y marcadores deformados en recorridos cortos o largos.
- [x] Ubicación vigente del conductor, distancia, duración y estado operativo visibles sin inventar movimiento.
- [x] Progreso, SLA, categoría, instrucciones, protección, foto, firma y devolución se derivan de hechos del servidor.
- [x] PIN consultable sólo por el propietario dentro del tracking y oculto una vez completado o cancelado.

## Avance 15 de agosto de 2026 — Categorías y SLA reales de Envíos

- [x] Categorías Documentos, Estándar, Frágil y Electrónica persistidas en PostgreSQL con instrucciones, peso máximo y recargo.
- [x] Niveles Economy, Standard, Priority y Express con multiplicador de transporte, ETA y distancia máxima configurables.
- [x] Cotización y creación validan configuración activa, límites y precio exclusivamente en servidor.
- [x] Categoría y SLA forman parte del token firmado; cambiarlos después de cotizar rechaza la solicitud.
- [x] App mobile ofrece selectores visuales y muestra nombre, ETA e instrucciones; el conductor recibe las reglas de manipulación.
- [x] Se corrigió la ubicación de Protección y Firma, que estaban apareciendo dentro de Viajes en vez de Envíos.

## Avance 15 de agosto de 2026 — Protección y devoluciones de envíos

- [x] Valor declarado y plan de protección seleccionables desde la app mobile, sin importes hardcodeados por el cliente.
- [x] Prima, mínimo, límite de cobertura y deducible configurados en PostgreSQL y calculados exclusivamente por la API.
- [x] Cotización firmada vincula ruta, paquete, valor declarado y protección; cualquier alteración se rechaza antes de crear o cobrar.
- [x] Solicitud de devolución limitada al propietario, a envíos entregados y a una ventana de siete días, con una única solicitud por envío.
- [x] Operaciones administra transiciones controladas `requested → approved/rejected → in_transit → completed`, con auditoría.
- [x] Actividad mobile muestra el estado y permite iniciar la devolución con motivo real.
- [ ] Liquidación de siniestros, documentación probatoria y emisión contractual requieren integrar una aseguradora/proveedor habilitado.

## Avance 15 de agosto de 2026 — Firma manuscrita de recepción

- [x] El cliente puede exigir firma desde la solicitud y esa condición queda incluida en la cotización firmada.
- [x] Capturador gráfico mobile con nombre, relación con el destinatario y consentimiento versionado.
- [x] Firma PNG cifrada con AES-256-GCM, hash SHA-256, hora y GPS opcional; una nueva captura sustituye únicamente la evidencia anterior del mismo tipo.
- [x] El servidor bloquea la entrega configurada hasta reunir foto, firma e identidad del receptor y PIN correcto.
- [x] El auditor inspecciona postura de consentimiento e integridad, pero no el contenido cifrado ni el nombre del firmante.

## Avance 15 de agosto de 2026 — Tracking visual de comida

- [x] Actividad abre un seguimiento dedicado para cada pedido activo.
- [x] Ruta vial comercio→cliente calculada por el proveedor de mapas, con distancia y duración reales.
- [x] Progreso deriva del estado y timeline PostgreSQL; no usa animaciones con estados inventados.
- [x] Muestra repartidor y posición vigente cuando existe, y un estado explícito mientras se busca conductor.
- [x] Fallback visual si el proveedor de rutas falla, sin ocultar el estado operativo del pedido.

## Avance 15 de agosto de 2026 — Confirmación y recompra segura

- [x] Confirmación mobile usa el pedido persistido y muestra ID, total, ETA y acceso a Actividad.
- [x] “Pedir de nuevo” reconstruye el carrito desde el snapshot histórico sin reutilizar precios anteriores.
- [x] Revalida ownership, comercio, horario de sucursal, inventario, productos y reglas actuales de modificadores.
- [x] Cualquier línea inválida revierte toda la recompra; el checkout siempre exige una cotización nueva.
- [ ] Factura fiscal integrada depende del proveedor fiscal y jurisdicción de despliegue.

## Avance 15 de agosto de 2026 — Productos personalizables reales

- [x] Grupos y modificadores por producto migrados a tablas PostgreSQL con mínimos, máximos, orden, disponibilidad y precio.
- [x] Carrito mobile persistido contra API; variantes del mismo producto se separan por selección y nota.
- [x] Hoja visual mobile para elegir agregados, cumplir grupos obligatorios y enviar indicaciones de cocina.
- [x] Carrito, cotización y confirmación recalculan modificadores desde catálogo; IDs inventados, duplicados o no disponibles son rechazados.
- [x] Cotización firmada incluye base, agregados, precio unitario final y nota; el snapshot inmutable llega al comercio y al recibo.
- [x] Flash Negocios crea y elimina grupos/opciones, ajusta mínimos, máximos, precios y disponibilidad con autorización y persistencia PostgreSQL.
- [x] IDs ambiguos o repetidos se rechazan tanto en administración como durante carrito y checkout.
- [x] Restricciones alimentarias y alérgenos normalizados en PostgreSQL con vocabulario controlado y presencia “contiene/puede contener”.
- [x] Flash Negocios administra declaraciones por producto; mobile las muestra antes de personalizar o agregar al carrito.
- [x] Preferencias alimentarias y alérgenos evitados persistidos por usuario con aislamiento RLS.
- [x] Filtro mobile opcional oculta productos explícitamente incompatibles sin interpretar una declaración ausente como producto seguro.
- [x] Búsqueda alimentaria server-side con ranking `pg_trgm`, paginación, disponibilidad efectiva y perfil alimentario autenticado.
- [x] Índices parciales GIN para comercios/productos y relaciones dieta/alérgeno preparados para crecimiento del catálogo.
- [ ] Particionado geográfico, réplicas de lectura y OpenSearch quedan para escala multi-ciudad de alto volumen.

## Avance 15 de agosto de 2026 — Horarios reales de comercios

- [x] Horario semanal por sucursal persistido en PostgreSQL con zona horaria IANA.
- [x] Turnos diurnos, 24 horas, días deshabilitados y jornadas que cruzan medianoche.
- [x] Cierres y aperturas excepcionales por fecha para feriados o eventos operativos.
- [x] Catálogo, cotización y confirmación calculan disponibilidad efectiva en servidor; el interruptor manual no suplanta el horario.
- [x] Portal Flash Negocios permite editar semana y excepciones, y diferencia pausa manual de cierre automático.
- [x] Ownership, auditoría, RLS y privilegio mínimo de la función SQL aplicados.

## Avance 15 de agosto de 2026 — Prueba de entrega reforzada

- [x] El envío sólo puede completarse con foto cifrada tomada por el repartidor asignado y PIN correcto del destinatario.
- [x] Evidencia PostgreSQL con AES-256-GCM, SHA-256, MIME validado por firma, límite de 1,5 MB, fecha y GPS opcional.
- [x] Cámara integrada en la app mobile del conductor; el cliente ve el estado de evidencia desde Actividad.
- [x] Contenido accesible únicamente para cliente propietario, conductor asignado y roles autorizados; el auditor sólo ve metadatos de integridad.
- [x] Fuerza bruta del PIN bloqueada persistentemente tras cinco fallos, independientemente del rate limit de borde.
- [x] Valor declarado, prima firmada, firma manuscrita y devolución operativa incorporados con ownership y estados persistentes.
- [x] Apertura, cálculo de cobertura/franquicia, seguimiento y resolución operativa de siniestros persistidos y auditables.
- [x] Evidencia probatoria de siniestros cifrada, validada por firma de archivo y accesible sólo por titular u operaciones.
- [ ] Liquidación regulada automática sigue pendiente de aseguradora/proveedor habilitado y webhook firmado.

## Avance 15 de agosto de 2026 — Checkout de comidas con consentimiento de precio

- [x] Resumen visual mobile separado del carrito, con dirección geocodificada, artículos, ETA, distancia, método de pago, cupón y desglose final.
- [x] Subtotal, delivery, cargo de servicio, descuento y total calculados exclusivamente por PostgreSQL/PostGIS y firmados por cinco minutos.
- [x] Confirmación rechazada si cambian carrito, sucursal, dirección, promoción, método de pago o total luego de aceptar la cotización.
- [x] Método Wallet propio creado para cuentas existentes y nuevas; ownership y revocación se validan antes de cobrar.
- [x] Captura Wallet, redención de promoción, reserva de inventario, pedido e idempotencia permanecen dentro del flujo transaccional probado.
- [ ] Captura de tarjetas externas y conciliación productiva: depende de contratar y configurar un PSP; no se simula como cobro real.

## Avance 15 de agosto de 2026 — Verificación de identidad básica

- [x] Registro sin sesión hasta confirmar OTP de email.
- [x] Código bcrypt, vencimiento, cinco intentos, consumo único y reenvío invalidante.
- [x] Entrega por outbox cifrado sandbox/SMTP y estado mobile dedicado.
- [x] Cuentas existentes migradas como verificadas sin interrupción.

## Avance 15 de agosto de 2026 — Recuperación de cuenta

- [x] Solicitud anti-enumeración con token temporal de un solo uso.
- [x] Digest inaccesible para el rol auditor y sin token plano persistido.
- [x] Cambio transaccional de contraseña y revocación total de sesiones.
- [x] Flujo mobile y pruebas de expiración, replay y credenciales anteriores.
- [x] Proveedor SMTP transaccional con outbox cifrado, reintentos y guardas de producción.
- [ ] Deep link universal verificado en builds iOS/Android.

## Avance 15 de agosto de 2026 — Seguridad de viajes

- [x] Seguimiento público en vivo mediante enlace temporal y revocable.
- [x] Bearer token de 256 bits almacenado sólo como digest SHA-256.
- [x] Vista pública minimizada, sin identidad completa ni información financiera.
- [x] SOS persistente con evidencia GPS opcional, notificación a operaciones, realtime y auditoría.
- [x] Integración mobile y smoke test de ownership, revocación y privacidad.

Fecha base: 14 de agosto de 2026.

Este roadmap organiza Flash Delivery App como plataforma grande: marketplace de comida, movilidad/taxi, app de comercio, app de conductor/repartidor y superadmin web. La meta no es solo tener pantallas, sino construir una base operable, segura, medible y escalable.

## Vision

Flash debe competir con plataformas tipo Uber, Uber Eats y PedidosYa desde cuatro experiencias:

- Cliente mobile: comida, taxi, wallet, promociones, tracking y soporte.
- Comercio mobile/tablet: pedidos, cocina, menu, stock, horarios, promociones y soporte.
- Driver mobile: delivery/taxi, ofertas, navegacion, ganancias, documentos y seguridad.
- Superadmin web: operaciones, usuarios, comercios, drivers, zonas, pagos, soporte, auditoria y salud de plataforma.

## Estado actual

Leyenda: `[x]` terminado y verificado, `[~]` operativo con deuda identificada, `[ ]` pendiente.

## Ruta critica hacia beta real

### P0 - Datos, dinero y seguridad

- [x] Esquema PostgreSQL/PostGIS versionado.
- [x] Dominios base: usuarios, comercios, catalogo, drivers, vehiculos, jobs, dispatch, eventos e idempotencia.
- [x] Dominios financieros: payment intents, metodos tokenizados, refunds, payouts y ledger.
- [x] Dominios de operacion: promociones, ratings, soporte, notificaciones, dispositivos y auditoria.
- [x] Row-Level Security para datos de cliente, jobs, pagos, notificaciones y soporte.
- [x] Minimización del agregado `/api/state` por rol y ownership; ofertas de driver redactan PII antes de aceptar.
- [x] Roles físicos separados: `flash_app` migra, `flash_runtime` ejecuta sin bypass y `flash_rls_audit` prueba políticas con contexto.
- [x] Produccion falla al iniciar sin JWT seguro o `DATABASE_URL` PostgreSQL.
- [x] MFA TOTP para superadministración: secreto AES-GCM, confirmación previa, desafío corto, códigos de recuperación bcrypt de un solo uso, bloqueo por intentos y tokens sin privilegio hasta completar el segundo factor.
- [x] Centro de seguridad admin usable: estado persistido, enrolamiento por QR, exportación puntual de recuperación y confirmación TOTP desde la web.
- [x] Readiness valida PostgreSQL/PostGIS cuando esta configurado y no filtra rutas internas.
- [x] Entorno local verificado con PostgreSQL 17.11, PostGIS 3.6.2, usuario sin privilegios y autenticacion SCRAM.
- [x] Runtime principal: auth, catálogo, carrito, comida, viajes, envíos, drivers y wallet operan en PostgreSQL/PostGIS.
- [x] `/api/state`, `/api/me`, registro y edición de perfil leen identidades, direcciones lógicas y métodos tokenizados desde PostgreSQL; nuevos usuarios ya no se duplican en SQLite.
- [x] Libreta de direcciones PostgreSQL/PostGIS: CRUD con ownership, máximo por cuenta, principal única atómica, sincronización de perfil, auditoría, RLS y consumo mobile transversal.
- [x] Migrar auth y sesiones al repositorio PostgreSQL con refresh rotation y revocacion persistentes.
- [x] Migrar catalogo, carrito y pedidos de comida a transacciones PostgreSQL.
- [x] Idempotencia obligatoria y respuesta repetible para creacion de pedidos.
- [x] Persistencia de disponibilidad y GPS de drivers en PostGIS.
- [x] Viajes, envíos, matching geoespacial, detalles de paquete y tracking de estados migrados a PostgreSQL/PostGIS.
- [x] Migrar wallet y ganancias de conductor a double-entry ledger; saldo calculado desde asientos balanceados.
- [x] Captura Flash Wallet atómica para comida, viajes y envíos, con payment intent y ledger de doble entrada.
- [x] Cancelación con reintegro atómico, registro de refund e idempotencia financiera para las tres verticales.
- [x] Ingesta de webhooks firmados por HMAC, comparación timing-safe y deduplicación persistente de eventos.
- [x] Tickets y conversaciones de soporte en PostgreSQL, con cola operativa, notas internas y estados reales.
- [x] Notificaciones in-app persistentes, deduplicadas y marcables como leídas sólo por su propietario.
- [x] RLS de soporte/notificaciones probado físicamente; notas internas invisibles para clientes incluso por conexión DB restringida.
- [x] Promociones en PostgreSQL con códigos, vigencia, reglas, cupos, límite por usuario y redención atómica en checkout.
- [x] Referidos PostgreSQL: código estable, atribución única, rechazo de auto-referido y recompensa bilateral Wallet sólo tras primer servicio completado y pagado, con ledger balanceado e idempotencia.
- [x] Zonas de servicio como polígonos PostGIS; conteos activos y multiplicadores de viaje/envío calculados desde ubicación real.
- [x] Administración RBAC y auditoría PostgreSQL para promociones y configuración de zonas.
- [x] Auditoría operacional PostgreSQL para comercios, menú, pedidos, viajes, envíos y ubicación/disponibilidad de drivers.
- [x] Auditoría PostgreSQL físicamente append-only: runtime conserva `INSERT/SELECT` pero no puede actualizar, borrar ni truncar; trigger protege incluso al owner sin contexto explícito de mantenimiento.
- [x] Cadena SHA-256 canónica entre eventos de auditoría, serializada con advisory lock, verificable por rol read-only y validada también después de restaurar backups.
- [x] Runtime PostgreSQL probado sin escrituras SQLite durante el smoke integral; SQLite queda como fallback aislado de tests.
- [x] Alta de viajes desacoplada de identidades fixture SQLite; usuarios registrados únicamente en PostgreSQL pueden solicitar servicios y están cubiertos por regresión.
- [x] Favoritos persistentes y ratings ligados a trabajos completados, con sujeto derivado por servidor y RLS físico.
- [x] Historial visible de Wallet obtenido del ledger PostgreSQL, no de fixtures.
- [x] Comprobantes post-servicio inmutables para comida, viajes y envíos, con snapshot de importes, ownership, RLS y auditoría; se identifican explícitamente como no fiscales.
- [x] Cancelaciones de las tres verticales registran actor, motivo normalizado y reintegro exacto en PostgreSQL; la actividad móvil muestra el resultado y RLS protege el registro.
- [x] Settlement Wallet de movilidad distribuye cada captura entre conductor y revenue de plataforma en una transacción idempotente y balanceada; pagos no capturados no generan saldo ficticio.
- [x] Dashboard financiero obtiene GMV, capturas, refunds, revenue posteado, deuda comercial y payouts del ledger; burn, runway y margen dejan de mostrarse como cifras inventadas.
- [x] Tarifas base de viajes y envíos migradas a planes PostgreSQL versionados; cotizaciones reaccionan a configuración persistida y conservan `pricingVersion` firmado.
- [x] Endpoint Prometheus protegido por token dedicado, con métricas HTTP, pool PostgreSQL, jobs, soporte y pagos.
- [x] Backup local custom con manifiesto SHA-256 y verificación no destructiva de catálogo/esquema.
- [x] Restore drill local completo en cluster temporal aislado: checksum, ACL, migraciones, PostGIS, datos, constraints, RLS, secretos y ledger verificados; limpieza segura automática.
- [~] Restore conserva privilegio mínimo local; falta repetir el simulacro contra PostgreSQL administrado en una cuenta/proyecto temporal.
- [~] Conciliación automática interna y resolución auditada de excepciones listas; falta el adaptador y credenciales del PSP externo.
- [x] Scoring transaccional explicable e idempotente previo al cobro, bloqueo crítico y cola operativa de revisión para las tres verticales.
- [ ] Backups administrados, PITR y simulacro de restore documentado.

### P0 - Producto completo desde Figma

- [x] Inventario trazable en `docs/figma-screen-matrix.md`.
- [~] Comidas: discovery, detalle personalizable, carrito persistente, checkout visual, actividad y restricciones alimentarias estructuradas con perfil privado/filtro web+mobile funcionales; falta paridad visual fina de confirmación.
- [~] Comidas: total firmado, pago Wallet, promociones, OTP de email, soporte y comprobante de servicio funcionales; faltan factura fiscal, PSP externo y completar tracking visual.
- [~] Viajes: mapa, ruta, modalidades, precio, solicitud, asignacion y guia funcionales; falta paridad final de confirmación y navegación.
- [~] Viajes: matching, estados, rating, reservas, propina, comprobante y seguridad base funcionan; faltan seguros/habilitación y operaciones de emergencia reales.
- [x] Envios: cotización, solicitud, asignación, mapa/ruta, PIN y tracking visual funcionales.
- [~] Envios: SLA/categorías, PIN + foto/firma cifradas, cancelación/reintegro, valor declarado, protección y devoluciones auditables; faltan siniestros con proveedor regulado y paridad visual fina.

### Puertas de salida beta

- [~] Wallet, métodos tokenizados administrables, captura, refunds y ganancias están en PostgreSQL; falta conectar credenciales de un PSP externo y conciliación.
- [x] Pedidos, viajes, envíos y sus capturas Wallet exigen claves idempotentes y rollback completo ante fondos insuficientes.
- [x] BOLA/ownership, RBAC y RLS físico cubiertos por tests con rol PostgreSQL no-owner/sin bypass.
- [x] BOLA/ownership y minimización por rol cubiertos por smoke de seguridad.
- [x] Puerta automatizada verifica ausencia de PAN/CVV/OTP/refresh tokens, hashes unidireccionales y push tokens cifrados; logs HTTP no registran cuerpos.
- [x] Login protegido por cuenta con contador PostgreSQL atómico, bloqueo temporal tras cinco fallos, recuperación verificada y respuesta indistinguible para credenciales inválidas.
- [x] Trust & Safety puede suspender/reactivar cuentas desde superadmin: revoca sesiones, desconecta supply, retira ofertas y audita motivo y resultado en una transacción.
- [x] La superficie desktop deriva estrictamente del rol: admin ve Command Center, merchant ve Negocios y customer/driver reciben una vista restringida sin controles operativos.
- [~] Benchmark local concurrente verifica p95 menor a 500 ms en estado, catálogo y cotizaciones; falta carga sostenida sobre infraestructura productiva.
- [x] Dispatch es atómico/idempotente y tracking SSE reconecta con replay, cursor persistido, deduplicación, renovación de sesión y backoff con jitter.
- [~] Restore de backup probado localmente de extremo a extremo; falta rotación de secretos y ensayo sobre infraestructura administrada.
- [ ] Todas las pantallas Figma en la matriz estan `[x]` o aceptadas explicitamente para post-beta.

- [x] Frontend React/Vite responsive.
- [x] Mobile/PWA para cliente, comercio, conductor y operaciones.
- [x] Web desktop reservada para superadmin.
- [x] Backend Express con API real.
- [x] SQLite local persistente.
- [x] Login con bcrypt y JWT.
- [x] RBAC por roles: `customer`, `merchant`, `driver`, `admin`.
- [x] Ownership en servidor para pedidos, viajes, restaurantes y drivers.
- [x] Auditoria de mutaciones criticas.
- [x] Docker y Docker Compose.
- [x] Smoke test de seguridad con `npm run test:security`.
- [x] Documentacion de arquitectura, investigacion, infraestructura y progreso.
- [x] Investor Command Center en superadmin desktop.
- [x] Base Expo/React Native en `apps/mobile`.
- [x] Documento investor-ready con KPIs y data room inicial.
- [x] SSE autenticado con event log PostgreSQL, secuencia durable, LISTEN/NOTIFY, audiencias y replay por cursor.
- [x] Reconexion automatica del frontend y estado visible del canal live.
- [x] Geolocalizacion foreground para origen de taxi y drivers online.
- [x] Cotizacion inicial por coordenadas y dispatch por cercania.
- [x] Flujos mobile reales de comida, taxi, comercio y driver contra API autenticada.
- [x] Wallet sandbox con transacciones persistentes y perfil/direccion editables.
- [x] Cuenta web/PWA con libreta de direcciones real: Casa/Trabajo/Otro, alta, edición, principal única, eliminación y coordenadas capturadas desde geolocalización del dispositivo.
- [x] Base PostgreSQL/PostGIS ejecutable con migraciones transaccionales y Docker Compose.
- [x] Esquema productivo para catalogo multivertical, jobs, dispatch, ledger, outbox e idempotencia.
- [x] Selector mobile de viajes con tarifas, ETA, capacidad y disponibilidad real de drivers.
- [x] Navegacion cliente separada en Comidas, Viajes y Envios.
- [x] Envios locales con cotizacion, restricciones, destinatario, autoasignacion, tracking, PIN y flujo de driver.
- [x] Entrega de envíos exige PIN con ownership, rate limit, bloqueo de fuerza bruta, prueba PostgreSQL y acreditación idempotente.
- [x] Busqueda y filtros funcionales para catalogo de comidas.
- [x] Portal desktop de negocios con cocina, catalogo, stock, capacidad y metricas operativas.
- [x] Dashboard de comercio protegido por ownership en la API.
- [x] Ganancias de conductor acreditadas por trabajos completados en wallet persistente.
- [x] App driver mobile con GPS, modos, ofertas y gestion de pedidos, viajes y envios.
- [x] Sesiones mobile persistentes con access token corto, refresh rotativo, revocacion y logout real.
- [x] Login por credenciales y superficie derivada del rol; eliminado el cambio de identidad por pestañas demo.
- [x] Sistema visual mobile con gradientes, iconografia, fotografia de catalogo y mapas operativos estilizados.
- [x] Comidas alineado al archivo Figma: home, ubicacion, busqueda, categorias visuales, ofertas, restaurantes, detalle, menu, carrito y pedidos.

## Paridad visual y funcional con Figma

La implementacion se sigue por flujos completos y no por pantallas aisladas. Cada bloque se considera terminado cuando conserva el lenguaje visual del diseño y ejecuta operaciones reales contra la API.

- [x] Comidas: inicio, busqueda, categorias, listado y detalle de restaurante.
- [x] Comidas Home: proporcion mobile del Figma, categorias fotograficas, oferta modal superpuesta y restaurantes abiertos.
- [x] Navegacion mobile reinicia el scroll entre servicios y subpantallas para evitar vistas recortadas.
- [x] Barra inferior de Comidas fuera del scroll y fija al final de la pantalla en Inicio, Buscar, Pedidos y Carrito.
- [x] Integracion con la hoja nativa de compartir para pedidos, viajes y envios activos.
- [x] Navegacion global cliente: Inicio, Buscar, Actividad y Cuenta compartida por Comidas, Viajes y Envios.
- [x] Actividad unificada con pedidos, viajes y envios leidos del backend autenticado.
- [x] Geocodificacion real OpenStreetMap, rutas viales OSRM y mosaicos cartograficos configurables desde backend.
- [x] Ruta real dibujada sobre el mapa con estilo Flash y guia paso a paso basada en maniobras OSRM.
- [x] Dependencia nativa SVG instalada para superposiciones cartograficas escalables.
- [x] Cotizador adelantado con base, distancia, tiempo, modalidad, demanda, servicio, peajes y version de pricing.
- [x] Cotizacion firmada y bloqueada cinco minutos; el backend rechaza tokens vencidos o modificados.
- [x] Reservas de viaje PostgreSQL entre 30 minutos y 30 días, recordatorio, activación dispatch a 15 minutos y cancelación transaccional.
- [x] Driver recalcula ruta e instruccion siguiente desde cada actualizacion GPS para viajes con coordenadas.
- [x] Auditoria responsive inicial: ancho mobile consistente, mapas sin overflow, textos con contraste y acciones tolerantes a contenido largo.
- [x] Benchmark UX actualizado con patrones oficiales de Uber, Uber Eats, Lyft, Rappi/PedidosYa y DoorDash.
- [x] Comidas: menu, agregado de productos, cantidades, carrito, direccion y creacion real del pedido.
- [x] Comidas: checkout exige una dirección propia geocodificada y persiste pickup/dropoff PostGIS, distancia y ETA sin reutilizar la ubicación del comercio.
- [x] Comidas: pedidos activos y cancelacion autorizada.
- [~] Comidas: onboarding real, favoritos persistentes, cupones y checkout con Wallet funcionan; falta paridad visual fina de confirmación.
- [x] Comidas web/PWA: Actividad abre tracking dedicado con ruta OSRM real, mosaicos OSM, repartidor asignado, ETA/timeline, compartir estado y degradación honesta.
- [x] Viajes web/PWA: Actividad abre tracking con ruta OSRM, vehículo/placa/rating, PIN de retiro, enlace temporal, vista pública móvil y reporte de incidente autenticado.
- [~] Viajes: flujo de destino, mapa, selector, confirmación, matching y viaje activo está operativo; falta paridad final con el Figma Lyft y habilitación de emergencias locales.
- [x] Envios web/PWA: Actividad abre tracking autenticado con ruta OSRM, destinatario, repartidor, ETA/timeline, PIN de entrega, prueba de entrega y fallback honesto.
- [x] Envios web/PWA: cotización y solicitud reales con geocodificación, categorías/SLA configurables, protección, firma, términos, token firmado e idempotencia; esta superficie cobra sólo con Flash Wallet.
- [x] Actividad, wallet, perfil, soporte y notificaciones como navegacion compartida.
- [~] Paridad de estados vacios, errores, carga, offline y accesibilidad en todos los flujos: offline/reconexión base está cubierto en web y mobile; faltan cola de escrituras diferidas, auditoría visual exhaustiva y ensayo con redes degradadas en dispositivos físicos.

## Principios tecnicos

- Mobile primero para usuarios finales; desktop solo para administracion.
- Backend autoritativo: el frontend nunca decide permisos.
- Eventos auditables para cambios de estado, pagos, usuarios y configuracion.
- Separacion progresiva por dominios: identity, marketplace, dispatch, payments, support, notifications y admin.
- Datos transaccionales en Postgres; geoespacial en PostGIS; presencia y locks en Redis.
- Realtime para tracking, dispatch, chat y soporte.
- Observabilidad obligatoria desde beta: logs, histogramas de latencia, trazas y alertas.
- Seguridad por defecto: JWT/refresh tokens, RBAC, ownership, rate limits, MFA admin y secretos fuera del codigo.

## Fase 1: MVP local serio

Objetivo: tener una app fullstack real que funcione en local y demuestre flujos completos.

Incluido:
- Cliente crea pedidos de comida.
- Cliente cotiza y solicita taxi.
- Comercio gestiona cocina, stock y productos.
- Driver acepta y avanza deliveries/viajes.
- Superadmin ve metricas, zonas, auditoria y actividad.
- API valida payloads, permisos y propiedad.

Criterios de salida:
- `npm run build` pasa.
- `npm run test:security` pasa.
- La app levanta con `npm run dev`.
- Los datos del runtime principal se persisten en PostgreSQL/PostGIS sin lecturas ni escrituras SQLite.
- Acciones anonimas y cross-user quedan bloqueadas.

## Fase 2: Backend productivo

Objetivo: preparar el backend para beta cerrada.

Trabajo:
- Configuracion por entorno con validacion estricta.
- Headers de seguridad, CORS controlado y rate limiting.
- Request IDs y logs estructurados.
- Endpoints `/api/health` y `/api/ready`.
- CI en GitHub Actions.
- Tests de integracion por dominio.
- Error handling centralizado.

Criterios de salida:
- CI ejecuta build y smoke security en cada push/PR.
- Produccion falla si falta `JWT_SECRET` fuerte.
- Las respuestas incluyen `requestId`.
- Las rutas sensibles tienen limites de abuso.

## Fase 3: Datos productivos

Objetivo: pasar de demo local a datos de produccion.

Trabajo:
- [x] Migrar el runtime principal de SQLite a PostgreSQL.
- [x] Agregar PostGIS para zonas, sucursales y distancia.
- Migraciones versionadas con Prisma, Drizzle o Knex.
- Indices para estados activos, usuarios, comercios, drivers, zonas y auditoria.
- Ledger financiero append-only.
- Backups automaticos y restore probado.

Criterios de salida:
- Migraciones reproducibles.
- Seeds por ambiente.
- Consultas principales indexadas.
- Auditoria y ledger no se editan destructivamente.

## Fase 4: Dispatch y realtime

Objetivo: asignar trabajos y tracking sin polling.

Trabajo:
- [x] SSE durable para estado en vivo entre múltiples réplicas de API.
- Redis GEO para ubicacion de drivers.
- Worker de dispatch separado.
- [x] Ofertas PostgreSQL privadas con expiración, retiro al cancelar y aceptación atómica.
- [x] Ranking inicial por distancia PostGIS, rating, frescura de ubicación, carga activa y modo.
- [x] Reasignación automática por oleadas con locking, candidatos nuevos y backoff al agotar oferta.
- [~] Tasa histórica de aceptación y velocidad de respuesta incorporadas con score persistido y explicable; faltan SLA comercial y tráfico vial actual.
- Simulador de demanda/oferta.

Criterios de salida:
- Pedido/viaje emite ofertas a drivers elegibles.
- Oferta expira y se reasigna.
- Cliente, comercio, driver y admin reciben eventos en vivo.
- Operaciones ve backlog en tiempo real.

## Fase 5: Apps mobile nativas

Objetivo: publicar apps reales para Android/iOS.

Trabajo:
- Monorepo `apps/mobile` con Expo/React Native.
- Builds separados para cliente, comercio y driver.
- [x] Registro/revocación de dispositivos sin exponer push tokens.
- [x] Outbox PostgreSQL transaccional para comida, viajes, envíos y cancelaciones.
- [x] Worker con locks concurrentes, lease, deduplicación, reintentos y adaptador sandbox verificable.
- [~] Registro, revocación automática de tokens inválidos, cifrado AES-256-GCM, centro in-app, preferencias, dead-letter y replay auditable listos; faltan adaptadores FCM/APNs y secret manager.
- [x] Bandeja mobile/PWA de ofertas privadas con countdown, aceptar, rechazar y polling resiliente.
- [x] Geolocalización foreground/background para driver con permisos, foreground service, sesión segura y corte de posiciones obsoletas.
- [x] Onboarding con documentos KYC y vehículos sujetos a validación independiente.
- Biometria opcional, deep links y crash reporting.

Criterios de salida:
- Builds EAS para Android/iOS.
- Driver comparte ubicacion en background con permisos correctos.
- Push llega para ofertas, cambios de estado y soporte.
- App mobile usable sin navegador.

## Fase 6: Pagos y finanzas

Objetivo: operar dinero real con conciliacion.

Trabajo:
- [ ] Integración productiva Mercado Pago, Stripe u otro PSP local.
- [x] Wallet de cliente y conductor con doble partida.
- [x] Ledger PostgreSQL inmutable por API y verificación de balance.
- [x] Comisiones, reembolsos y split exacto cliente/comercio/conductor/plataforma.
- [x] Saldo comercial y reserva idempotente de retiros.
- [x] Cotización de comida PostgreSQL/PostGIS por distancia y zona, plan versionado y price lock firmado verificable.
- [x] Checkout de comida exige consentimiento sobre el total final firmado y revalida ownership del método, carrito, inventario, sucursal, promo y todos los importes antes de la captura Wallet.
- [~] Reserva, step-up transaccional, aprobación independiente, rechazo y liberación contable listos. Mercado Pago Split 1:1 ya tiene OAuth seller protegido con PKCE, renovación rotativa, cobro web, webhooks y conciliación; el gate productivo restante es alta comercial/KYC, credenciales, despliegue de workers y ensayo sandbox controlado. No se construirá un worker bancario propio.
- [x] Propinas post-servicio y ajustes operativos parciales/totales con Wallet, ledger, RLS, idempotencia, límite concurrente y aprobación dual.
- Antifraude inicial por usuario, dispositivo, tarjeta, zona y promo.

Criterios de salida:
- Cobros sandbox reales.
- Cada movimiento financiero tiene asiento en ledger.
- Superadmin puede conciliar pagos y resolver excepciones.

## Fase 7: Operacion y crecimiento

Objetivo: administrar una ciudad completa.

Trabajo:
- Soporte multiagente con SLA.
- [~] Promociones, cupones y referidos operativos; falta consola de campañas de referidos con aprobación dual y antifraude por dispositivo/hogar.
- Ratings, calidad y suspensiones.
- Heatmaps de demanda.
- Forecast de oferta/demanda.
- Panel de onboarding de comercios y drivers.

Criterios de salida:
- Operaciones resuelve incidentes sin tocar base de datos.
- Marketing lanza promos con limites y medicion.
- [x] Calidad puede suspender o reactivar cuentas con motivo obligatorio, protecciones contra autobloqueo/último admin y trazabilidad operacional.

## Fase 8: Escala regional

Objetivo: soportar crecimiento multi-ciudad.

Trabajo:
- API Gateway.
- Servicios por dominio.
- Event bus con Kafka, Redpanda o Pub/Sub.
- Kubernetes/autoscaling o plataforma gestionada equivalente.
- OpenTelemetry, Prometheus/Grafana, Sentry y logs centralizados.
- Deploy canary/blue-green.
- WAF, rate limits por usuario/IP, secret manager y MFA admin.

Criterios de salida:
- SLOs por flujo critico.
- Runbooks operativos.
- Rollback probado.
- Pruebas de carga para cotizacion, dispatch, tracking y checkout.

## Proximo sprint

- Instalar y verificar `apps/mobile` con Expo Go/dev build.
- [x] Completar adaptadores críticos y verificar el runtime PostgreSQL/PostGIS con cero lecturas SQLite.
- Extender realtime SSE a payloads por usuario, push y tracking; evaluar WebSocket para presencia bidireccional.
- [x] Conectar Nominatim/OSRM y añadir caché PostgreSQL compartida con TTL, claves anonimizadas y validación WGS84.
- [x] Paridad comercial base: incidencias, reintegros parciales, sustituciones con consentimiento y disponibilidad por sucursal conectadas al checkout real.
- [x] Decisión de sustituciones visible en Actividad mobile con comparación, reintegro Wallet y acciones reales.
- [x] Formulario mobile de incidencias para pedidos entregados, con categorías, validación, monto solicitado y persistencia PostgreSQL conectada al workflow de operaciones.
- [x] Administración mobile de métodos tokenizados: alta sandbox no productiva, principal atómico, revocación, ownership y auditoría sin PAN/CVV.
- [x] Centro mobile de notificaciones con lectura, preferencias PostgreSQL y fallback in-app que evita perder eventos al desactivar push.
- [x] KYC de conductores con archivos AES-256-GCM, hash, versiones, vencimientos, revisión manual, RLS y bloqueo de conexión.
- [x] Navegación vial del conductor unificada para retiro/entrega de comida, pasajeros y paquetes usando coordenadas PostGIS y OSRM.
- [x] Soporte conversacional con SLA, routing multiagente por skill/capacidad, ownership histórico y escalamiento automático idempotente.
- [x] Reemplazar login demo por onboarding, refresh tokens, secure storage y sesiones revocables.
- [x] Checkout Wallet real y ledger financiero de doble entrada; mantener explícita la frontera pendiente del PSP externo.
- [x] Paridad de cuenta en frontend web/PWA: destinos frecuentes editables y reutilizables por checkout, con degradación explícita cuando el navegador no concede GPS.
- Crear pitch demo mode con datos de crecimiento historico.
