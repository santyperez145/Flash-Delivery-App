# Plan de los frontends a la par de la competencia

Salido de la auditoría del 19 de noviembre de 2026: cinco superficies (web del cliente, consola del comercio, repartidor y operaciones en la web, app del cliente, apps de reparto y comercio) contra Uber, Uber Eats, PedidosYa, Rappi y DoorDash, con fuentes oficiales cuando existen. Cada ola es un PR, web y móvil juntos cuando el hueco está en los dos, y se verifica en el navegador con datos reales.

## Resumen

Plan de entrega en 24 olas (una ola = un PR de 8 a 20 archivos, web y móvil juntos cuando el hueco está en los dos) más una cola posterior. Entran 117 de los 118 huecos auditados; se descarta 1 entero y varias sub-partes sin precedente. Tres hallazgos propios, verificados contra el repositorio antes de ordenar: (1) la rama actual feat/fe-03-confianza-y-acceso ya tiene sin commitear buena parte de WEB-CLI-01, 03 y 04 (src/auth/WebAccountFlows.tsx con CrearCuenta, VerificarEmail y RecuperarClave; api.register y recuperación en src/api.ts; onLogout en CustomerApp; SinComercios en CustomerHome.tsx), así que la Ola 1 termina esa rama en vez de empezar de cero. (2) No existe ningún camino de producto para crear un comercio ni un repartidor: el único INSERT INTO merchants está en scripts/db-seed-commerce.mjs y en una prueba, y /api/auth/register sólo otorga el rol customer. Con la regla «Todo real, nada falso» eso deja el catálogo vacío para siempre (hoy la API devuelve verticals: []), por eso las altas de comercio y de repartidor suben a las Olas 3 y 4: desbloquean verificar todo lo demás con datos reales. (3) Las dos auditorías se contradicen sobre el catálogo público: en el código GET /api/catalog/restaurants y /api/catalog/verticals son públicas (server/http/catalog-router.js:217 y 264); sólo /api/catalog/search (línea 283-285) y /api/maps/geocode (server/http/maps-router.js:46) exigen sesión. El modo invitado necesita abrir esas dos con límite de uso, no todo el catálogo.

## Reglas para todas las olas

- Cada PR agrega su fila FE-xx en la tabla de fases de docs/reestructuracion-competitiva.md, actualiza docs/matriz-madurez.md y ROADMAP.MD, y nombra qué competidor ya lo tiene (CONTRIBUTING §1).
- Los textos nuevos van en voseo rioplatense con tildes; desde la Ola 5 lo vigila una puerta de copy.
- Toda pantalla tocada sale con rótulos accesibles, foco visible, objetivos de 44 px y colores por token; el barrido final de la Ola 23 y 24 cubre sólo lo que ninguna ola tocó.
- Verificación con datos reales: la cuenta, el comercio y los pedidos de prueba son los propios del dueño, se crean por el flujo del producto y se borran al terminar (AccountDeletion, suspensión del comercio). No se siembra nada.
- Entorno de verificación: npm run dev (API en localhost:4000, web en localhost:5173) y, para la app móvil en el navegador, npm run web dentro de apps/mobile (expo start --web). Lo que depende de un teléfono real (push, sonido en segundo plano, cámara) se declara como borde NOT-001 y no se marca completo.
- Toda migración que crea tabla la clasifica en database/rls-classification.json con prueba negativa por rol; todo backfill suma su derivación a scripts/db-seed-derived.mjs.

## Olas

### FE-03. Confianza y acceso en la web del cliente, y catálogo sin datos inventados

Que una persona pueda crear su cuenta, recuperarla y cerrar sesión desde la web, que el inicio y Explorar nunca queden en blanco ni prometan lo que no hay, y que ninguna calificación o caloría salga de un valor fijo del servidor.

**Huecos:** WEB-CLI-01, WEB-CLI-03, WEB-CLI-04, WEB-CLI-05, WEB-CLI-06, MERW-01 (origen en el servidor), MC-22 (calificación sin opiniones)

**Cambios:**

- src/auth/WebLogin.tsx — ya enruta ingresar, crear, verificar y recuperar. Falta pasar el texto al cliente («Te damos la bienvenida», «Pedí comida, viajes y envíos con una sola cuenta», ejemplo tu@email.com) y sacar de la variante cliente el panel de audiencias de staff y la nota «Acceso por audiencia» (línea 84).
- src/auth/WebAccountFlows.tsx (nuevo, ya escrito) — revisar: requisitos de contraseña visibles antes de enviar, aceptación de términos con LegalLinks, reenvío del código con cuenta regresiva, y el mensaje neutro «Si la cuenta existe, te mandamos instrucciones».
- src/App.tsx y src/api.ts — ya hechos (verificationRequired, register, resend y confirm de email, request y confirm de recuperación). Sumar el tuteo que queda en App.tsx:736-868.
- src/styles/auth.css — estilos de los pasos, con foco visible y controles de 44 px.
- src/customer/CustomerProfileScreen.tsx y src/customer/CustomerSurface.tsx — el botón «Cerrar sesión» ya existe; falta la confirmación «¿Cerrar sesión en este navegador?» con Volver por omisión.
- src/customer/EmptyState.tsx — nueva prop action ({label, onClick}) y una segunda acción opcional; el título deja de ser siempre h2.
- src/customer/CustomerHome.tsx — SinComercios ya se muestra; agregarle los botones «Pedir un viaje» y «Mandar un envío» sólo si esos flags están activos (cambian a Viajes). «Todo lo que podés pedir en tu zona» sólo si hay servicios. «Cambiar dirección» se suma en la Ola 6.
- src/customer/FoodDiscoveryHome.tsx — promo-rail y FlashPassTeaser (154-171) sólo con al menos un comercio abierto; «Sin comercios para mostrar acá.» (174) pasa a EmptyState con «Ver todos los rubros»; no pintar «Platos de comercios abiertos» vacío (188).
- src/customer/FoodCartScreen.tsx — placeholder «Ingresá tu código» en vez de «Ej. FLASH40» (630); carrito vacío «Tu carrito está vacío» con botón «Ver comercios» (369-374).
- server/http/catalog-router.js — POST /api/restaurants/:id/menu deja de escribir rating 4.5, kcal 500, tag Nuevo e image del comercio (391-395); mensaje «No podés gestionar este local» (382).
- server/catalog-repository.js — el ítem ya no expone rating; el comercio devuelve rating null sin calificaciones (sin caer a metadata.rating, línea 259) y suma ratingCount contado desde ratings.
- src/types.ts y apps/mobile/src/types.ts — rating: number | null y ratingCount en el comercio; kcal y timeMin opcionales en el ítem.
- src/customer/FoodCatalogComponents.tsx, FoodItemSheet.tsx y FoodRestaurantScreen.tsx — «★ 4,6 (120)» con coma decimal sólo desde 10 calificaciones reales; por debajo, chip «Nuevo». Sin estrella por plato. kcal y minutos sólo si el comercio los declaró.
- apps/mobile/src/screens/CustomerFoodBrowseScreen.tsx (322-325) y CustomerFoodRestaurantScreen.tsx (127-128) — la misma regla de calificación.
- scripts/catalog-honesty-contract.mjs (nuevo, con scripts/source-contract.mjs) — falla si el alta de producto vuelve a fijar rating o kcal; se falsifica y se conecta a ci-fast.

**Servidor:** Sin endpoints nuevos: las rutas de alta, verificación y recuperación ya existen (server/http/auth-router.js:607-685). Cambian el alta de producto y la proyección del catálogo (ratingCount). La limpieza de lo ya guardado va en la Ola 2.

**Fuentes:** https://help.uber.com/riders/article/how-do-i-create-an-uber-account--?nodeId=fdfc0273-f67e-4545-9885-f89d0ca0aacf · https://www.uber.com/ie/en/legal/ratings-and-reviews-on-uber-eats/ · estados vacíos y promociones: sin fuente oficial

**Verificación:** En localhost:5173 sin sesión: «Crear cuenta» con un email propio, ingresar el código (fuera de producción el servidor devuelve developmentCode), entrar. Salir, «¿Olvidaste tu contraseña?», cambiarla con el token y volver a ingresar. En Cuenta, «Cerrar sesión» pide confirmación y Atrás no reabre la sesión. Con el catálogo real vacío (verticals: []), Inicio y Explorar muestran «Todavía no hay comercios en tu zona» con sus acciones, sin promociones ni Flash Más. En la pestaña Red, GET /api/catalog/restaurants no trae ningún rating sin ratingCount. La parte de tienda y producto se vuelve a mirar con el comercio real que nace en la Ola 3. Al terminar, borrar la cuenta de prueba desde Cuenta. Puertas: test:customer-home, test:api-wiring, test:postgres y el contrato nuevo.

### FE-04. Nada inventado: datos guardados, app móvil, repartidor y consolas

Sacar el resto del contenido fabricado o engañoso de todas las superficies: metadata ya guardada, foto del comercio usada como foto del plato, «Abierto ahora» fijo, métricas internas al cliente, formulario sandbox, vencimiento 2099, calificación 5 que nadie dio, ceros de relleno, pines decorativos y cifras mal calculadas.

**Huecos:** MERW-01 (migración y consola), MC-04 (foto del comercio), MC-22 («Abierto ahora»), MC-21 (sólo el título «Elegidos para vos»), MC-24 (métricas internas), MC-17 (formulario sandbox), DRV-10 (vencimiento 2099), DRV-08 (5 por defecto), DRV-13 (ceros al cargar), OPS-W09 (saldo con cero inventado), OPS-W10, OPS-W05 (quitar pines), OPS-W11 (rótulo y cancelados), MERW-16 (horario 9 a 23 precargado)

**Cambios:**

- database/migrations/150_catalogo_sin_inventos.sql — quita de la metadata de ítems el rating 4.5 y kcal 500 por defecto, el tag Nuevo sembrado y la image igual a la del comercio. scripts/db-seed-derived.mjs — la misma derivación, idempotente.
- server/http/driver-router.js — /api/driver/me expone ratingCount para no mostrar el 5 por defecto de 001_core.sql:78.
- src/merchant/MerchantConsole.tsx (855, 1075) — producto sin foto muestra «Sin foto · Subí una», no la foto del local.
- src/merchant/MerchantCatalogEditors.tsx (23-50) — sucursal sin horario: «Esta sucursal todavía no tiene horario», no 09:00 a 23:00 precargado.
- apps/mobile/src/screens/CustomerFoodRestaurantScreen.tsx — item.image o tarjeta sin foto, nunca restaurant.image (196, 282); «Abierto ahora» (109-112) calculado desde branches[].weeklyHours o se quita.
- apps/mobile/src/screens/CustomerFoodBrowseScreen.tsx (265) — «Abiertos ahora» en lugar de «Elegidos para vos».
- apps/mobile/src/screens/CustomerRideScreen.tsx (286-288, 420) — quitar «N online» y «N conductores».
- apps/mobile/src/screens/CustomerAccountScreen.tsx (1005-1089) — el formulario «Agregar tarjeta sandbox» sale del build del cliente; queda «Todavía no se pueden agregar tarjetas desde la app».
- apps/mobile/src/screens/DriverAccountPanel.tsx (32) — vencimiento vacío y obligatorio, validado como fecha futura.
- apps/mobile/src/screens/DriverEarningsPanel.tsx (103-112, 335-338) y DriverHomePanel.tsx (356) — «—» o esqueleto mientras carga o si falla; «Todavía no te calificaron» sin ratingCount.
- src/operations/OperationsSurface.tsx — sin zona alta, «Sin zonas con demanda alta ahora» (372, 436-445); saldo sin dato «—» (461); fuera los pines (594-603); «ETA comida» y «Espera viajes» separados (731).
- src/shell/StaffShell.tsx (114-123) y src/styles.css (572-585) — fuera los pines y la cuadrícula decorativa.
- src/backoffice/AdminOverviewBoards.tsx — ancho del embudo proporcional al valor (191); sin dashboard, «Sin datos del ledger todavía · Reintentar» en vez de $0 (112-116); fuera el párrafo de inversores (95-99). AdminInvestorPanels.tsx acompaña.
- src/backoffice/AdminReleaseControls.tsx (84-118) — el panel de infraestructura muestra estado real (workers vivos, dead letters) o se elimina; nada de hoja de ruta presentada como estado.
- src/backoffice/AdminConsole.tsx (92-95) y AdminFinanceOverview.tsx (28-49) — volumen sólo desde dashboard.marketplace.grossVolume, sin cancelados y con el período rotulado; «Wallet clientes» filtra rol customer.

**Servidor:** Una migración de limpieza sin tabla nueva y ratingCount en /api/driver/me. El ledger por período queda para la Ola 22.

**Fuentes:** https://merchants.ubereats.com/mx/en/resources/learning-center/menu-and-photos · regla propia «Todo real, nada falso»

**Verificación:** Web: con la cuenta admin real, Dispatch y el panel de marca sin pines; embudo proporcional o vacío; Finanzas con período y sin cancelados. SQL de control: ningún ítem con rating 4.5 y kcal 500 en metadata. Móvil en el navegador (npm run web en apps/mobile): Viajes sin «N online», Cuenta sin formulario sandbox, Ganancias con «—» al cortar la red. Con el comercio real de la Ola 3 se confirma producto sin foto prestada.

### FE-05. Alta real de comercio: postulación web, aprobación y puesta en marcha

Que un comercio de verdad pueda sumarse sin seed: se postula en la web, operaciones lo aprueba y la consola lo guía hasta estar listo para vender. Es lo que permite verificar todas las olas siguientes con datos reales.

**Huecos:** OPS-W01 (comercio), OPS-W02 (pestaña Comercios), MERW-17, OPS-W15

**Cambios:**

- database/migrations/152_merchant_applications.sql y database/rls-classification.json — tabla por-usuario con estados pendiente, observada, aprobada, rechazada; prueba negativa por rol.
- server/merchant-application-repository.js y server/http/applications-router.js (nuevos), montados en server/index.js — POST /api/applications/merchant, GET /api/applications/me, GET /api/admin/merchant-applications?status&cursor, POST /api/admin/merchant-applications/:id/decision. Aprobar crea el comercio y su sucursal y recién ahí otorga el rol merchant.
- server/work-queue-repository.js — cola merchant_applications.
- src/partners/MerchantApplication.tsx (nuevo) y ruta pública /comercios en src/App.tsx — «Sumá tu comercio» en 3 pasos con barra de progreso: rubro (VerticalRail) y datos (razón social, CUIT), dirección con geocodificación, horarios. Cierre honesto: «Recibimos tu solicitud. Te avisamos cuando la revisemos», con el estado visible al volver.
- src/ui/SystemStateScreen.tsx (55-93) y apps/mobile/src/screens/LoginScreen.tsx (668-670) — enlace a la postulación en lugar de «continúa en la app móvil» sin salida.
- src/backoffice/AdminApplications.tsx (nuevo), AdminConsole.tsx y WorkQueueBoard.tsx — sección «Altas» con la pestaña Comercios: lista por antigüedad, detalle, aprobar o rechazar con motivo predefinido editable; la fila de la cola lleva a la sección.
- src/backoffice/OperationsInterventionPanel.tsx y AdminMarketplacePanels.tsx — una sola fila por comercio con estado real («Activo», «Pausado por el local», «Suspendido por operaciones · motivo · fecha») y un único menú Pausar, Suspender, Reactivar; fuera el «Suspendido en esta sesión».
- src/merchant/MerchantSetupChecklist.tsx (nuevo) y MerchantConsole.tsx — tarjeta «Puesta en marcha · x de 6» calculada de datos reales: horario por sucursal, productos con foto propia, una categoría, Mercado Pago vinculado, retiro y efectivo revisados, dos pasos activo.
- src/api.ts y src/types.ts — métodos y tipos; status, suspendedAt y suspensionReason en el comercio de operaciones.

**Servidor:** Nuevo: tabla, cuatro rutas y la aprobación que crea el comercio. /api/operations/restaurants tiene que incluir los suspendidos con status, suspendedAt y suspensionReason. La vinculación con Mercado Pago es borde de tercero: el checklist lo dice sin simularlo.

**Fuentes:** https://merchants.ubereats.com/us/es/s/signup · https://help.uber.com/en/merchants-and-restaurants/article/cu%C3%A1les-son-los-requisitos-para-unirte-a-uber%C2%A0eats?nodeId=514f1720-55b0-4155-a820-7dc9496ebcf4 · https://merchants.ubereats.com/au/en/academy/store-edits · PedidosYa: sin fuente oficial

**Verificación:** Sin sesión, abrir /comercios y postular el comercio propio del dueño con datos reales. Entrar como admin, Altas, aprobar. Entrar como ese comercio: la consola muestra «Puesta en marcha»; cargar horario y un producto real. Volver a la web del cliente: aparece el rubro y el local, sin estrella, sin kcal y sin foto prestada (cierra la verificación pendiente de las Olas 1 y 2). Suspender desde operaciones, recargar y confirmar que el estado persiste y se puede reactivar.

### FE-06. Alta real de repartidor y conductor, con cola de legajos

Que alguien pueda postularse a repartir desde la web o la app, subir sus documentos con la cámara y que operaciones los revise desde una cola, no fila por fila.

**Huecos:** OPS-W01 (repartidor), OPS-W02 (legajos y vehículos), DRV-10, OPS-W21 (panel de legajos)

**Cambios:**

- database/migrations/152_driver_applications.sql y rls-classification.json — solicitud por-usuario con estado.
- server/http/applications-router.js y server/driver-application-repository.js — POST /api/applications/driver; aprobar otorga el rol driver.
- server/http/driver-fleet-router.js — GET /api/admin/driver-documents?status=pending&cursor y lo mismo para vehículos, para terminar con los dos pedidos por conductor.
- src/partners/DriverApplication.tsx (nuevo) y ruta /repartir en src/App.tsx — «Repartí con Flash»: datos y teléfono verificado (/api/me/phone-verification), vehículo, documentos según el vehículo con la subida cifrada existente, estado de la solicitud.
- src/backoffice/AdminApplications.tsx — pestañas Repartidores y Vehículos: documento embebido, checklist por tipo, motivo por documento, y pasa sola a la siguiente.
- src/backoffice/AdminTrustPanels.tsx (23-167) y AdminMarketplacePanels.tsx (124-156) — sale el panel incrustado por fila; botones con type button y motivo con label y aria-describedby.
- apps/mobile/src/screens/LoginScreen.tsx — «Quiero repartir» abre la postulación.
- apps/mobile/src/screens/DriverAccountPanel.tsx y useDriverShift.tsx — lista de requisitos donde cada fila es la acción («Licencia — Falta subir / En revisión / Aprobada · vence el 12 de marzo / Rechazada: motivo»), «Sacar foto» con la compresión a 1280 px que ya existe, selector de fecha, aviso 30 días antes del vencimiento, estados y vehículos en castellano.
- src/api.ts y apps/mobile/src/api.ts — métodos nuevos.

**Servidor:** Nuevo: tabla, alta de solicitud y los dos listados transversales. La subida de documentos y la revisión por persona ya existen.

**Fuentes:** https://www.uber.com/us/en/deliver/ · https://help.uber.com/en/driving-and-delivering/article/reg%C3%ADstrate-para-hacer-entregas-con-uber%C2%A0eats-en-bicicleta-o-a-pie?nodeId=d89506e6-5d67-42cd-aa2a-64e9f30b0a42 · https://help.uber.com/en/driving-and-delivering/article/uploading-documents?nodeId=d24c406d-e470-40f1-867d-3a8db1bbfd48

**Verificación:** Abrir /repartir con una cuenta propia, completar con documentos propios, ver «Recibimos tu solicitud». Como admin: Altas, Repartidores, rechazar uno con «Foto borrosa» y aprobar el resto. Como repartidor: ver el motivo del rechazo, reemplazar el documento, quedar aprobado y poder conectarse. En la pestaña Red, la cola hace un solo pedido paginado. La cámara real se prueba en teléfono (borde de dispositivo).

### FE-07. Hablarle al cliente en su idioma: voseo, tildes, sin jerga ni estados del comercio

Que ninguna pantalla del cliente muestre tuteo, palabras sin tilde, enums en inglés, identificadores crudos ni jerga de ingeniería, y que una puerta lo impida de acá en adelante.

**Huecos:** WEB-CLI-19, MC-12, MC-13, MC-14

**Cambios:**

- src/customer/FoodCartScreen.tsx (365, 372-385), FoodCatalogComponents.tsx (23-24), src/RideHome.tsx (330, 257-259) y src/App.tsx (736-868, 1010) — «Confirmá tu pedido», «envío», «Borrar búsqueda», «Compartir», «Ubicación actual», «Aplicación»; fuera «basado en coordenadas».
- apps/mobile/App.tsx (293) — «Cargando…».
- apps/mobile/src/screens/CustomerFoodCheckoutScreen.tsx (85, 114-117, 147, 177-178, 323-324) — «Precio final · válido hasta las HH:MM», sin fila TARIFA, «Entregamos en», «Se cobra al confirmar»; se borra el párrafo de validaciones del servidor.
- apps/mobile/src/screens/CustomerFoodCartScreen.tsx (244, 255, 293) y CustomerAddressForm.tsx — «Agregá una dirección de entrega», «Elegí cómo pagás», sin «geocodificada», «tokenizado» ni «resultado firmado».
- apps/mobile/src/screens/CustomerAccountScreen.tsx (551, 661, 683, 938) — «Respondemos antes de las HH:MM» en lugar de «EN SLA».
- apps/mobile/src/format.ts — mapas en castellano para motivos de cancelación, relación del contacto y estados de devolución, siniestro y caso.
- apps/mobile/src/screens/CustomerFoodOrdersScreen.tsx (97), CustomerActivityScreen.tsx, CustomerRideScreen.tsx, CustomerShipmentScreen.tsx, CustomerScreen.tsx y ui.tsx — customerOrderStatusLabel, rideStatusLabel y shipmentStatusLabel en todo lo que ve el cliente; títulos «Pedido de {comercio}», «Viaje a {destino}», «Chat con {nombre}»; voseo y tildes («Indicá origen y destino», «Primero cotizá el viaje», «Flash Envíos», «Teléfono del destinatario»).
- server/http/maps-router.js y server/http/cancellation.js — mensajes de error que llegan al cliente, con tildes y voseo.
- scripts/customer-copy-contract.mjs (nuevo, test:customer-copy, con source-contract.mjs) — lista de formas de tuteo, palabras sin tilde y jerga vedada en src/customer, src/auth y apps/mobile/src/screens/Customer*; se falsifica y entra a ci-fast.

**Servidor:** Sólo textos de error. Sin rutas nuevas.

**Fuentes:** sin fuente oficial: regla de castellano rioplatense del proyecto

**Verificación:** Con el comercio real: hacer un pedido propio desde el móvil en el navegador y recorrer carrito, checkout, «Tus pedidos», seguimiento y Cuenta; ningún texto de la lista vedada. En «Tus pedidos» el estado dice «Preparando tu pedido», no «Nuevo · aceptar». Provocar un error de dirección y leer el mensaje con tildes. La puerta falla al reintroducir «Indica» o «PRECIO FIRMADO».

### FE-08. Elegir la dirección desde el encabezado y desde el checkout

Cambiar o agregar la dirección de entrega sin ir a Cuenta ni perder el carrito, con sugerencias al escribir, punto confirmado en el mapa y datos de acceso para quien entrega.

**Huecos:** WEB-CLI-09, MC-11, MC-07 (direcciones), WEB-CLI-04 (acción «Cambiar dirección»)

**Cambios:**

- database/migrations/153_user_address_access.sql, server de direcciones y packages/domain-contracts/src/index.ts (76-89) — unit, floor y accessInstructions en UserAddress; viajan a la etiqueta del repartidor asignado.
- server/http/maps-router.js — GET /api/maps/reverse para rotular «Usar mi ubicación» y el pin movido.
- src/customer/AddressSheet.tsx (nuevo) — guardadas con radio y la predeterminada marcada, «Usar mi ubicación», «Agregar dirección» con sugerencias (debounce de 300 ms sobre api.geocode), mapa para ajustar, Piso/Depto, «Indicaciones para llegar», etiqueta Casa, Trabajo u Otra.
- src/customer/CustomerNavigation.tsx (41-49) — «Enviar a» pasa a ser un botón que abre la hoja.
- src/customer/CustomerAddressBook.tsx, FoodFulfillmentPicker.tsx y FoodCartScreen.tsx (222) — reutilizan la hoja; el checkout ofrece «Cambiar» o «Agregar dirección» sin salir.
- src/customer/CustomerHome.tsx — SinComercios suma «Cambiar dirección».
- apps/mobile/src/AddressSearchField.tsx (nuevo) y screens/CustomerAddressForm.tsx — sugerencias al escribir, sólo un resultado elegido se guarda, campos nuevos.
- apps/mobile/src/screens/CustomerHomeScreen.tsx (155-160), CustomerFoodBrowseScreen.tsx (107-117) y CustomerScreen.tsx — «Entregar en {etiqueta}» tocable (44 px) que abre MobileTaskSheet; elegir invalida la cotización y vuelve a pedir el catálogo si etaMin depende de la dirección.
- src/api.ts, src/types.ts, apps/mobile/src/api.ts y types.ts.

**Servidor:** Migración sobre user_addresses (tabla existente, RLS por-usuario ya vigente), geocodificación inversa nueva y propagación a la etiqueta de entrega.

**Fuentes:** https://help.uber.com/en/ubereats/restaurants/article/updating-saved-addresses?nodeId=1ee5e186-5516-4b56-a187-7ad34e0de70e · selector en el encabezado: sin fuente oficial

**Verificación:** Web: tocar la dirección del encabezado, agregar la dirección propia con piso y una indicación, verla predeterminada. Armar un carrito en el comercio real, cambiar la dirección desde el checkout y confirmar que el carrito sigue y el envío se recotiza. Hacer el pedido y, como repartidor asignado, leer el piso y la indicación. Repetir en el móvil en el navegador.

### FE-09. Ficha de producto con opciones obligatorias, carrito visible y checkout en una pantalla

Que el plato se elija bien (grupos obligatorios, cantidad, aclaraciones), que el carrito diga qué se pidió y cuánto cuesta, y que el botón de pagar esté siempre a la vista.

**Huecos:** WEB-CLI-10, WEB-CLI-20, MC-03, MC-04, MC-05

**Cambios:**

- src/customer/FoodItemSheet.tsx — cada modifierGroup como sección («Obligatorio» u «Opcional · hasta N»), radio si el máximo es 1, «Agregar $X» deshabilitado con «Elegí 1 opción en Bebida»; extras del local sólo si el plato no tiene grupos; diálogo accesible (role dialog, aria-labelledby, Escape, foco inicial y retorno); label «Aclaraciones para el local»; modo edición con lo ya elegido.
- src/App.tsx y src/types.ts — el carrito guarda las opciones por grupo.
- src/customer/FoodCartScreen.tsx (367, 377-396) — cada línea nombra opciones y nota real, se toca para editar; encabezado «Agregar más de {local}»; el ícono de cupón lleva al campo de código o se quita. src/ui/panels.tsx y src/styles/customer-feed.css acompañan.
- apps/mobile/src/screens/CustomerFoodRestaurantScreen.tsx — tocar cualquier producto abre la ficha (foto propia, descripción, alérgenos, opciones, «Indicaciones para la cocina», contador); la tarjeta muestra − n + si ya está en el carrito.
- apps/mobile/src/screens/CustomerScreen.tsx y styles.ts (1155-1163) — barra fija «{n} · Ver carrito · {comercio} · $ total» sobre la barra inferior; onAddItem recibe cantidad.
- apps/mobile/src/screens/CustomerFoodCartScreen.tsx y CustomerFoodCheckoutScreen.tsx — una sola pantalla «Tu pedido»: cotiza sola al abrir y ante cada cambio, desglose con esqueleto, agregados por nombre, dirección y pago como filas que abren una hoja, barra fija «Hacer pedido · $ total»; el precio vencido se recotiza solo.

**Servidor:** Confirmar, con prueba, que la cotización del checkout rechaza un plato sin su grupo obligatorio; si no lo hace, se agrega esa validación en el servidor en este PR.

**Fuentes:** https://help.uber.com/merchants-and-restaurants/article/advanced-menu-functionality-customization-options?nodeId=871f01b4-d976-4efe-8c07-5b1ca90b2407 · https://www.uber.com/newsroom/introducing-new-features-for-consumers-with-food-allergies · barra de carrito y desglose: sin fuente oficial

**Verificación:** En el comercio real, crear desde la consola un producto con un grupo obligatorio. Web: el botón queda deshabilitado hasta elegir; Tab y Escape funcionan en el diálogo; en el carrito se leen las opciones y se pueden editar. Móvil en el navegador: la barra del carrito sigue al scroll y el total aparece sin tocar «Continuar». Forzar por la API un pedido sin el grupo obligatorio y confirmar el rechazo.

### FE-10. Comercio: el pedido nuevo avisa, cocina por etapas, cancelar y pausar

Que ningún pedido entre en silencio, que la cocina vea qué preparar y cuánto lleva, y que el local pueda cancelar con motivo o pausarse desde cualquier pantalla, en la consola web y en Flash Negocios.

**Huecos:** MERW-02, MERM-01, MERW-03, MERM-02, MERW-04, MERW-05, MERM-03 (cancelar), MERW-21, MERM-07, MERW-18, MERM-09

**Cambios:**

- src/merchant/useNewOrderAlert.ts (nuevo) — compara ids vistos; tono que se repite cada 10 s hasta abrir el pedido, título de pestaña «(2) Nuevos pedidos», Notification si hay permiso, banner «Activar sonido de pedidos» y silenciar con aria-pressed.
- src/merchant/MerchantOrderCard.tsx (nuevo) y MerchantConsole.tsx (770-788) — tres columnas Nuevos, En preparación, Listos (pestañas bajo 900 px); número corto, «Retira en el local» o «Envío», «Programado 21:30», cronómetro que se pone rojo al pasar etaMin, productos con opciones y notas, efectivo, lote; botón nombrado por paso («Empezar a preparar», «Marcar listo», «Entregar en mostrador»). Los contadores del pulso filtran.
- src/merchant/MerchantConsole.tsx (56-397) — en el detalle, «No puedo preparar este pedido» con motivos y el efecto dicho («Le devolvemos el dinero al cliente»); bloque del repartidor con nombre, vehículo y lote, y «Repartidor asignado · sin hora de llegada» mientras no haya ETA vial.
- src/merchant/MerchantPauseControl.tsx (nuevo), src/types.ts (877-885), src/adaptive.css (39-41) y src/styles.css — pausa con duración y motivo como en el móvil, banner «Pausado hasta 21:45 · Reanudar ahora», visible también bajo 900 px.
- src/labels.ts y MerchantConsole.tsx — tildes, voseo, «Repartidor», «productos», estado de conexión en castellano, fuera PostgreSQL, PostGIS, ledger y SLA; la etapa accepted se llama «Nuevo» para el comercio.
- src/api.ts — cancelar con reason merchant_issue y reasonDetail.
- apps/mobile/src/screens/MerchantScreen.tsx — modal «Pedido nuevo» a pantalla completa con vibración y sonido hasta tocarlo; sondeo cada 10 s en primer plano; secciones por etapa; tarjeta de cocina con productos; cancelar con motivo; fila del repartidor; copy sin jerga.
- apps/mobile/src/ui.tsx y variant-screen.merchant.tsx — tarjeta de cocina propia en lugar de OrderCard; «3 productos».
- server/http/catalog-router.js, cancellation.js y configuration-router.js — mensajes en voseo.

**Servidor:** Nada nuevo: la pausa con tiempo y motivo y la cancelación por merchant_issue ya existen. Rechazar con vencimiento automático exigiría un estado previo a accepted que no existe: queda fuera. La hora de llegada del repartidor depende de la API key de rutas (DSP-001).

**Fuentes:** https://merchants.ubereats.com/ar/en/resources/learning-center/uber-eats-orders-app/ · https://help.uber.com/merchants-and-restaurants/article/uber-eats-orders-user-guide?nodeId=cf66954d-a1c7-4148-a011-3c2bee00a6ad

**Verificación:** Dos ventanas: la consola del comercio real y la web del cliente. Hacer un pedido propio: la consola suena, cambia el título de la pestaña y la tarjeta aparece en «Nuevos» con sus productos y el cronómetro corriendo. Avanzarlo con los botones nombrados. Con otro pedido, «No puedo preparar este pedido · Sin stock» y confirmar el reintegro en la Wallet del cliente. Pausar 15 minutos a 800 px de ancho y ver el banner y el local cerrado para el cliente. Repetir aviso y cancelación en Flash Negocios en el navegador; el sonido en segundo plano se prueba en teléfono.

### FE-11. Repartidor: la oferta interrumpe y el trabajo se guía por etapas

Que una oferta no se pierda ni se acepte a ciegas, y que cada paso del retiro y la entrega tenga dirección, navegación y un botón que diga lo que hace, en Flash Driver y en la web.

**Huecos:** DRV-01, DRV-02, OPS-W07, DRV-03, OPS-W06, DRV-11, DRV-14, OPS-W20 (parte repartidor)

**Cambios:**

- packages/domain-contracts/src/index.ts (348-376) y server/dispatch-repository.js (342-368) — DispatchOffer suma pickupDistanceKm, pickupDurationMin, pickupLocation, destinationLocation, nombre del comercio, cantidad de productos y el neto del conductor en viajes y envíos.
- servidor, vista del pedido para el repartidor asignado — nombre y dirección del comercio.
- apps/mobile/src/screens/DriverOfferModal.tsx (nuevo) y DriverScreen.tsx (56-82) — oferta a pantalla completa en cualquier pestaña: «Ganás $X», «A 1,2 km · 5 min del retiro — {local}», «3,4 km · 11 min hasta la entrega», chips, barra de cuenta regresiva, Aceptar de 56 px, Rechazar, «1 de N»; Vibration y sonido por canal de expo-notifications; accessibilityLiveRegion.
- apps/mobile/src/screens/DriverHomePanel.tsx (630-771, 311, 351) y useDriverShift.tsx (331) — fuera la lista del fondo, el «puntaje» y la línea de historial; «Navegar» siempre visible usando el prop openExternalNavigation que hoy no se usa; con error de ruta, «Podés navegar igual con Google Maps».
- apps/mobile/src/screens/DriverJobCards.tsx, ui.tsx y format.ts — tarjeta por etapa («1 de 2 · Retirá en {local}») con «Retiré el pedido», «Salí a entregar», «Entregado», «Llegué», «Iniciar viaje», «Finalizar viaje»; número corto y lista de productos en el retiro; foto, código y PIN como checklist sobre el botón deshabilitado; estados en castellano.
- apps/mobile/src/screens/DriverEarningsPanel.tsx y DriverScreen.tsx — copy: «No tenés servicios en curso», «Conectate para recibir ofertas», «Mensajes», «Saldo disponible»; fuera PostgreSQL, ledger, runtime y snapshot.
- src/operations/DriverJobCard.tsx (nuevo), OperationsSurface.tsx (480-563) y BatchRoute.tsx — la misma oferta enfocada (una a la vez, anillo, aviso sonoro con la pestaña oculta) y la misma tarjeta por etapa con «Navegar» y «Contactar»; ganancia del pedido en lugar del total; «Activate para recibir pedidos».
- src/ui/panels.tsx y src/api.ts — OrderOpsCard deja de usarse para el repartidor; módulo compartido de enlaces de navegación tomado de apps/mobile/src/navigation-links.ts.

**Servidor:** Campos nuevos en la oferta y en la vista del pedido para el repartidor. El paso «Llegué al local» necesitaría un evento nuevo (los estados van de courier_assigned a picked_up): no se agrega en esta ola. El push a un teléfono real sigue en NOT-001.

**Fuentes:** https://help.uber.com/en/driving-and-delivering/article/upfront-fares?nodeId=bc83ed7e-6725-41de-afcb-72d263e5589f · https://www.uber.com/py/en/drive/basics/tracking-your-earnings/ · https://help.uber.com/driving-and-delivering/article/navigation-menu-faq?nodeId=36fdc048-9dc2-467d-ad11-669bdb073afb · rótulos por etapa: sin fuente oficial

**Verificación:** Con el repartidor real de la Ola 4 conectado en Flash Driver (navegador) y un pedido propio en el comercio real: la oferta aparece encima de la pestaña Ganancias con los dos tramos y el neto; aceptarla; la tarjeta dice «Retirá en {local}» con el número corto; «Navegar» abre Google Maps con el destino; cortar el proveedor de rutas y ver que el botón sigue. Completar la entrega con los botones nombrados. Repetir la oferta en la web de repartidor con la pestaña oculta y oír el aviso.

### FE-12. Seguimiento vivo: hora de llegada, repartidor, patente y chat

Que la pantalla de seguimiento se actualice sola, diga a qué hora llega, muestre quién viene y deje escribirle, y que lo que está en curso se abra con un toque.

**Huecos:** WEB-CLI-12, WEB-CLI-15, MC-01, MC-09, MC-20 (tarjeta en curso)

**Cambios:**

- servidor de pedidos — estimatedArrivalAt y latestArrivalAt recalculados en cada cambio de estado.
- src/ui/ServiceChatPanel.tsx (nuevo) y src/api.ts — hilo, respuestas rápidas del servidor, enviar, marcar leído y no leídos sobre /api/jobs/:jobId/messages.
- src/customer/OrderTrackingSheet.tsx (70, 106-108, 168-193) — título con el local, «Llega entre 21:35 y 21:45», «Llegada a más tardar 21:50», «Actualizado hace 1 min», botón «Mensaje» (deshabilitado con el motivo antes de la asignación), compartir sin el id.
- src/customer/RideTrackingSheet.tsx y ShipmentTrackingSheet.tsx — «Mensaje» y patente grande con «Verificá la patente antes de subir».
- src/customer/CustomerHomeFeed.tsx y src/labels.ts — tarjeta en curso con estado y hora.
- apps/mobile/src/screens/CustomerScreen.tsx (523) — releer cada 5 s también con trackingOrderId y trackingShipmentId.
- apps/mobile/src/screens/CustomerTrackingSheets.tsx — hoja del pedido con comercio, «Llega a las HH:MM», tarjeta del repartidor con «Chatear», resumen plegable y «Necesito ayuda con este pedido»; hoja del viaje con patente (accessibilityLabel deletreable), PIN visible en driver_assigned y arriving, SOS y compartir en una fila fija; envío titulado «Envío a {destino}».
- apps/mobile/src/screens/CustomerHomeScreen.tsx (202-220), CustomerFoodOrdersScreen.tsx (55-58), CustomerActivityScreen.tsx y ui.tsx — la tarjeta en curso y la confirmación del pedido abren el seguimiento directo.

**Servidor:** Dos campos de hora estimada en el pedido. Chat, respuestas rápidas y patente ya existen. Foto del conductor y llamada enmascarada: fuera, dependen de un tercero.

**Fuentes:** https://help.uber.com/en/ubereats/stores/article/contact-the-delivery-person?nodeId=84854032-f414-4250-aca5-791ecec9c2f1 · https://help.uber.com/en/ubereats/restaurants/article/my-order-is-taking-longer-than-expected?nodeId=eec94190-9897-481c-8f4b-dfaa1c0e47ca · https://www.uber.com/us/en/newsroom/check-your-ride/ · https://help.uber.com/h/4148ea8b-c9d8-409d-b7bf-b2fcb019a498

**Verificación:** Tres ventanas (cliente, comercio, repartidor) con un pedido propio. Con el seguimiento abierto en el móvil del navegador, avanzar el pedido desde la consola: el estado y la hora cambian solos en menos de 5 s. Escribir desde el cliente y responder desde el repartidor; ver el contador de no leídos. Pedir un viaje propio y leer la patente y el PIN sin toque extra. Desde el inicio, un toque en la tarjeta en curso abre el mapa.

### FE-13. Después del pedido: detalle, ayuda, calificar y cancelar sabiendo qué pasa

Que cada pedido, viaje o envío se pueda abrir, repetir, calificar y reclamar desde el mismo lugar en web y móvil, y que cancelar muestre antes el reintegro o el cargo real.

**Huecos:** WEB-CLI-07, WEB-CLI-11, WEB-CLI-18, MC-10, MC-18, MC-19

**Cambios:**

- servidor — GET de vista previa de cancelación por servicio (reintegro o cargo), reutilizando el cálculo de cancelMobilityJobAndRefundWallet sin ejecutarlo.
- src/customer/OrderDetailSheet.tsx (nuevo) y ActivityEntries.tsx (109-135) — la fila se toca y abre el detalle: ítems con opciones y nota, desglose, medio de pago («Efectivo · vuelto de $X»), dirección o retiro, foto de entrega, y «Ayuda», «Calificar», «Volver a pedir» (POST /api/orders/:orderId/reorder, avisando qué ya no está).
- src/customer/HelpSheet.tsx (nuevo) y CustomerActivityScreen.tsx (82-145) — motivos («Faltó algo» con casillas por ítem, «Llegó otro producto», «Llegó dañado», «Calidad», «Llegó tarde», «Otro»); diálogo «¿Cancelar tu pedido?» con el resultado de la vista previa y «Volver» por omisión.
- src/customer/CustomerSurface.tsx, FoodCheckoutSummary.tsx y src/api.ts — «Mis casos» con hilo y respuesta; métodos de tickets, incidencias, reorder y vista previa.
- apps/mobile/src/api.ts y types.ts — createRating y ratings en el estado; vista previa de cancelación.
- apps/mobile/src/screens/CustomerActivityScreen.tsx (136-147, 255, 457-556) — lista «Anteriores» paginada con comercio o destino, fecha, productos y total; acciones «Repetir pedido», «Calificar» (5 estrellas de 44 px, motivos con 3 o menos), «Ver comprobante», «Ayuda»; vacíos con «Explorar comercios» y «Pedir un viaje»; la propina deja de decir «conductor» en pedidos.
- apps/mobile/src/screens/CustomerScreen.tsx (575, 602, 629-658), CustomerServiceIssueModals.tsx y CustomerTrackingSheets.tsx — hoja de cancelación con los motivos del servidor en castellano y la línea de consecuencia; fila «Ayuda» en cada servicio; calificar al cerrar un seguimiento terminado.
- apps/mobile/src/screens/CustomerHomeScreen.tsx (281-294) — «Repetir: {resumen}» usa api.reorder.

**Servidor:** Nuevo: la vista previa de cancelación. Si no llega a tiempo, el diálogo sólo confirma y no muestra ningún monto. Tickets, incidencias, calificaciones y reorder ya existen. Verificar si order-issues-router acepta un pedido en curso.

**Fuentes:** https://help.uber.com/ubereats/restaurants/article/wrong-or-missing-items?nodeId=598f96f1-2d4f-4143-90de-dc2fdbf505cf · https://help.uber.com/h/0539e772-747c-49a7-8c26-f28c65e6f14d · https://help.uber.com/h/24e75a3b-cf44-44e4-abae-8c2dce3b07a3 · https://www.uber.com/newsroom/were-redesigning-the-uber-app-just-for-you

**Verificación:** Con un pedido propio entregado: abrir el detalle en la web, reportar «Faltó algo» marcando un ítem, calificar y «Volver a pedir» (el carrito se rearma). Con otro pedido recién hecho, «Cancelar»: el diálogo muestra el reintegro y coincide con el movimiento de la Wallet. Calificar desde el móvil en el navegador y ver «Calificaste con 5 estrellas». La incidencia queda abierta para resolverla en la Ola 12.

### FE-14. Backoffice: responder tickets, resolver incidencias y colas que llevan al caso

Cerrar el circuito de la Ola 11: que soporte lea y conteste la conversación, resuelva la incidencia con su reembolso y llegue a cada caso desde la cola.

**Huecos:** OPS-W03, OPS-W04, OPS-W14, OPS-W20 (backoffice)

**Cambios:**

- server/http/order-issues-router.js — GET /api/admin/order-issues?status=open&cursor con contrato de autorización para soporte y admin.
- src/backoffice/AdminSupportOperations.tsx (79-254) — dos columnas: cola filtrable (Míos, Sin asignar, Vencidos, Por servicio) con buscador sobre /api/operations/support-tickets?q=, y el hilo con autor y hora, notas internas rotuladas «Nota interna · no la ve el cliente», compositor Responder o Nota interna, «Respuestas rápidas»; «Resolver» pide mensaje de cierre; capacidad con botón Guardar.
- src/backoffice/AdminOrderIssues.tsx (nuevo) — sección «Incidencias»: ítems del pedido, foto de entrega, código verificado, historial del cliente, «Aprobar reembolso» con monto acotado al total (Total, Sólo el ítem, Envío) o «Rechazar», siempre con nota; usa api.resolveOrderIssue, que hoy nadie llama.
- src/backoffice/AdminServiceQuickReplies.tsx — las respuestas rápidas se pueden insertar desde el hilo.
- src/backoffice/WorkQueueBoard.tsx (99-114) y AdminConsole.tsx (68-121, 180) — cada cola es un botón a su sección con el filtro puesto; sección en la URL; nav agrupado (Operación, Personas, Dinero, Producto, Plataforma) con contadores y aria-current; «Refrescar» vuelve a pedir datos sin recargar.
- AdminConsole.tsx, AdminFinanceOverview.tsx, AdminOverviewBoards.tsx, AdminInvestorPanels.tsx, AdminReleaseControls.tsx, AdminTrustPanels.tsx y src/labels.ts — tildes y castellano («Inversión», «Conciliación», «Despacho», «Tasa de asignación»); estados con etiqueta en lugar de replaceAll.
- src/api.ts — sendSupportMessage con internal y listado de incidencias.

**Servidor:** Nuevo: el listado global de incidencias. Mensajes, notas internas, resolución con reembolso y respuestas rápidas ya existen.

**Fuentes:** https://help.uber.com/driving-and-delivering/article/3---learn-how-to-use-the-driver-app?nodeId=8b30c1f5-91f4-40c5-838f-2037bb0ca95e · interfaz interna de la competencia: sin fuente oficial; se sostiene por la regla «cableado antes que cantidad»

**Verificación:** Como soporte real: la cola «Incidencias de pedido» lleva a la incidencia creada en la Ola 11; aprobar un reembolso parcial con nota y ver el movimiento en la Wallet del cliente. Abrir el ticket del cliente, dejar una nota interna y una respuesta; en la web del cliente, «Mis casos» muestra la respuesta y no la nota. Copiar la URL de la sección, recargar y volver al mismo lugar.

### FE-15. Cuenta como menú, Wallet con movimientos y notificaciones que llevan a algún lado

Que Cuenta sea un menú con subpantallas en web y móvil, sin dirección duplicada, con perfil editable y Wallet con movimientos, y que cada notificación abra su pedido, viaje o caso.

**Huecos:** WEB-CLI-08, MC-17, WEB-CLI-17, MC-20 (notificaciones)

**Cambios:**

- servidor — PATCH /api/me acepta omitir defaultAddress; POST /api/notifications/read-all; el payload de cada notificación trae el id del servicio.
- src/customer/CustomerSurface.tsx (254-315) — encabezado con nombre, email y saldo, y filas con chevron: Datos personales, Direcciones, Pagos y Wallet, Flash Más, Perfil familiar, Preferencias alimentarias, Notificaciones, Seguridad, Ayuda, Privacidad y legales, Cerrar sesión.
- src/customer/CustomerProfileScreen.tsx (71-114) — fuera la «Dirección principal» de texto libre; guardar sólo exige el nombre.
- src/customer/WalletScreen.tsx, SubscriptionPanel.tsx, src/ui/TwoStepVerification.tsx y AccountDeletion.tsx — pasan a subpantallas con Volver; Seguridad suma «Cerrar las demás sesiones» con /api/me/sessions.
- src/NotificationCenter.tsx (56-140) y src/labels.ts — cada fila abre su destino y se marca leída; etiquetas de estado en castellano; «Por email», «En la app»; «Marcar todas como leídas»; aria-label por interruptor; encabezado con Volver; «Las notificaciones push llegan a la app móvil».
- apps/mobile/src/screens/CustomerAccountScreen.tsx (110-1097) — menú de filas de 56 px con subpantallas; Wallet con movimientos reales (walletTransactions) y vacío «Todavía no tenés movimientos»; Perfil edita nombre y teléfono; «Cerrar sesión» al final con confirmación.
- apps/mobile/src/screens/CustomerHomeScreen.tsx y CustomerScreen.tsx — campana con contador que abre la bandeja; cada notificación abre su seguimiento o su caso.
- apps/mobile/src/push-registration.ts — addNotificationResponseReceivedListener con el mismo destino.
- apps/mobile/src/api.ts y types.ts.

**Servidor:** Dos ajustes chicos (PATCH sin dirección y read-all) y el id del servicio en el payload. El push a un teléfono real sigue en NOT-001.

**Fuentes:** https://help.uber.com/en/ubereats/restaurants/article/updating-saved-addresses?nodeId=1ee5e186-5516-4b56-a187-7ad34e0de70e · https://www.uber.com/ride/how-it-works/uber-cash/ · notificaciones accionables: sin fuente oficial

**Verificación:** Web: Cuenta muestra el menú; cambiar sólo el nombre con la libreta vacía y guardar; cerrar las demás sesiones teniendo otra abierta en otro navegador. Hacer un pedido propio, abrir la campana y tocar la notificación: abre ese pedido. Móvil en el navegador: Wallet lista el reintegro real de la Ola 11; editar el teléfono; «Cerrar sesión» pide confirmación.

### FE-16. Descubrir: búsqueda real, filtros y página del local con estado y horarios

Encontrar comercios y productos con la búsqueda del servidor, filtrar por lo que importa y saber antes de entrar si el local está abierto, cuánto tarda y cuánto cuesta el envío.

**Huecos:** WEB-CLI-13, WEB-CLI-22, MC-21, MC-22 (cerrados y horarios), MC-23, MC-24 (controles sin acción)

**Cambios:**

- server/http/catalog-router.js y server/catalog-search-repository.js — matchedItems suma precio e imagen.
- src/customer/CustomerHome.tsx, FoodDiscoveryHome.tsx, src/App.tsx (501-517) y src/api.ts — Explorar con buscador, recientes en localStorage y rubros; al escribir, /api/catalog/search con debounce de 300 ms, grupos «Comercios» y «Platos», «Cargar más»; sin resultados, «No encontramos “X”. Probá con otra palabra o mirá los rubros».
- src/customer/FoodCatalogComponents.tsx (13-29) — label oculto «Buscar»; el botón derecho aparece sólo con texto; fuera el ícono de filtros que no filtra.
- src/customer/FoodRestaurantScreen.tsx (41-59) y src/styles/customer-feed.css — chips reales: «Abierto hasta 23:00» o «Cerrado · abre 12:00 · Programá tu pedido», «Envío $X · 25-35 min», «Retiro en el local», «Acepta efectivo»; «Información del local» con horarios por día; «Buscar en {local}»; categorías fijas que siguen el scroll.
- apps/mobile/src/screens/CustomerFoodBrowseScreen.tsx (178-221, 373-382, 476-519) — chips combinables («Envío gratis», «Hasta 30 min», «Retiro en el local», «Acepta efectivo», «Favoritos», «Mejor calificados» sólo con opiniones reales), «Ordenar», «Quitar filtros»; resultados por comercio y por producto con precio; recientes; placeholder por rubro; «Ver todas» abre la grilla o se quita.
- apps/mobile/src/screens/CustomerFoodRestaurantScreen.tsx — «Abierto · cierra a las 23:30» o «Cerrado · abre a las 19:00»; «Buscar en {comercio}».
- apps/mobile/src/screens/CustomerScreen.tsx (185-187, 665, 1065) y VerticalRail.tsx — los cerrados van al final, atenuados, con «Abre a las HH:MM»; agregar en un local cerrado avisa en lugar de no hacer nada.

**Servidor:** Precio e imagen en la búsqueda. Confirmar si la cotización acepta un pedido programado contra un comercio cerrado; si no, el botón «Programar para cuando abra» no se muestra.

**Fuentes:** https://www.uber.com/newsroom/ubereats-tech-update-2 · https://www.uber.com/en-GB/newsroom/ubereats-scheduled-orders · búsqueda por producto, recientes y página del local: sin fuente oficial

**Verificación:** Buscar el nombre de un producto real del comercio propio: aparece en «Platos» con su precio y abre la tienda. Buscar algo inexistente y leer el vacío. Pausar el comercio: figura al final como cerrado con su hora de apertura, y la tienda dice «Cerrado · abre a las…». Activar «Acepta efectivo» en la sucursal y ver el chip y el filtro.

### FE-17. Navegación que no expulsa: URLs en la web, Atrás en Android y avisos que no bloquean

Que Atrás vuelva a la pantalla anterior en web y Android, que un local o un pedido tengan enlace propio y que las acciones no terminen en un diálogo que hay que cerrar.

**Huecos:** WEB-CLI-14, MC-02, MC-06

**Cambios:**

- src/customer/CustomerSurface.tsx (198-236), CustomerScope.tsx (31-34), CustomerHome.tsx, src/App.tsx y src/main.tsx — rutas con history.pushState y popstate: /tienda/:id, /carrito, /checkout, /pedidos, /pedidos/:id, /explorar, /cuenta/:seccion, /viajes; abrir /tienda/:id directo carga ese local.
- servidor estático y configuración de Vite — fallback a index.html para esas rutas.
- apps/mobile/src/screens/CustomerScreen.tsx (85-110, 990-993) — BackHandler con la jerarquía checkout, carrito, tienda, rubro, inicio; RefreshControl que llama refresh() y loadActivity(false).
- apps/mobile/App.tsx (182-196) y ui.tsx — el mensaje de éxito de runAction es opcional y sale en un aviso no modal de 3 s (accessibilityLiveRegion polite); carga en el botón tocado en lugar del busy global.
- apps/mobile/src/screens/CustomerAccountScreen.tsx, CustomerRideScreen.tsx y CustomerActivityScreen.tsx — fuera los Alert de «Notificación leída», «Preferencia actualizada», «Cotización actualizada» y «Comprobante cargado».
- scripts/customer-home-contract.mjs — vigila las rutas y el BackHandler.

**Servidor:** Sólo el fallback de rutas del servidor estático.

**Fuentes:** https://developer.android.com/guide/navigation/custom-back (estándar de plataforma) · URLs por local: sin fuente oficial

**Verificación:** Web: entrar al comercio real, ir al carrito y al checkout; Atrás del navegador recorre el camino inverso sin salir del sitio; recargar en /tienda/:id mantiene la tienda; pegar esa URL en otra pestaña la abre. Móvil en el navegador: cambiar un interruptor de notificaciones no abre ningún diálogo. El botón Atrás físico se prueba en un teléfono Android (borde de dispositivo).

### FE-18. Pedir un viaje: destino elegido de una lista, precio por categoría y un solo botón

Que el viaje se cotice solo al tener origen y destino confirmados, muestre todas las categorías con precio y llegada, y se reserve con día y hora reales.

**Huecos:** WEB-CLI-16, MC-08, MC-07 (viajes y envíos), MC-24 (chip Ahora y franja de seguridad), MC-15 (texto honesto de medios de pago)

**Cambios:**

- server/http/ride-router.js — cotización que devuelve todas las categorías habilitadas en una llamada.
- src/RideHome.tsx (234-261), src/App.tsx y src/api.ts — lista de categorías con asientos, llegada, precio, chip «Más rápido» y botón «Pedir Económico · $X».
- apps/mobile/src/screens/CustomerRideScreen.tsx (206-214, 368-390, 475-504) — origen y destino con AddressSearchField (se elimina el results[0] implícito), cotización automática, un botón «Pedir {categoría} · $ precio» deshabilitado con el motivo; fuera pricingVersion; contactos de confianza pasan a Cuenta > Seguridad.
- apps/mobile/src/SchedulePicker.tsx — hoja con día (hoy más 30 días, el tope del servidor) y hora en pasos de 15 minutos, en lugar de «Mañana = ahora + 24 h».
- apps/mobile/src/screens/CustomerShipmentScreen.tsx — mismo campo de direcciones.
- apps/mobile/src/screens/CustomerHomeScreen.tsx (192-195) — el chip «Ahora» es un botón propio que abre la reserva; la franja de seguridad abre su hoja o pierde la flecha.
- apps/mobile/src/RidePaymentPicker.tsx — Wallet con saldo y «No alcanza para este viaje»; «Por ahora los viajes se pagan con saldo o en efectivo».
- apps/mobile/src/screens/CustomerAccountScreen.tsx — recibe «Contactos de confianza».

**Servidor:** Cotización multi-categoría. El pago de viajes con tarjeta y la carga real de Wallet dependen de las credenciales productivas de Mercado Pago: se dice en pantalla y no se simula. Las paradas múltiples siguen en P-07.

**Fuentes:** https://help.uber.com/en/riders/article/selecting-a-vehicle-option-for-your-ride?nodeId=53d5ef29-0fa5-4252-a48c-43ff244ce6ce · https://help.uber.com/h/67f41961-e0aa-4670-af32-58be02c7c492 · https://www.uber.com/au/en/ride/how-it-works/reserve/ · https://www.uber.com/es-AR/newsroom/alianza-uber-mercado-pago

**Verificación:** Escribir una calle con homónimos: hay que elegir de la lista y el pin lo confirma. Con origen y destino aparecen las categorías con su precio sin tocar «Cotizar». Reservar para pasado mañana a las 9:15 y verlo en Actividad. Con el conductor real conectado, pedir uno ahora y completar el viaje propio. Sin saldo, el selector dice que no alcanza.

### FE-19. Repartidor: conectarse con chequeo previo, ayuda, seguridad y perfiles según el rol

Que conectarse sea la acción principal y explique qué falta, que quien reparte tenga ayuda y emergencia a mano, y que nadie cierre sesión por accidente ni vea perfiles que no le corresponden.

**Huecos:** DRV-09, OPS-W17, DRV-05, NAV-01, OPS-W16

**Cambios:**

- apps/mobile/src/screens/DriverHomePanel.tsx (123-160, 352-377) y useDriverShift.tsx — barra de estado fija, botón «Conectarme» o «Desconectarme» de 56 px, checklist previo («Legajo aprobado», «Vehículo activo», «Ubicación: Siempre») con su acción, selector «Repartos | Viajes», confirmación al desconectarse con un servicio activo; texto del permiso sin «development build».
- apps/mobile/src/screens/DriverScreen.tsx (96-117) — escudo en la cabecera que abre «Seguridad»: «Llamar al 911», «Reportar un incidente» (api.createRideSafetyIncident, que hoy nadie llama) y «Hablar con soporte».
- apps/mobile/src/screens/DriverInboxPanel.tsx y api.ts — «Abrir un caso» con el servicio activo preseleccionado, lista de casos e hilo; «Ayuda con este servicio» en el trabajo activo.
- apps/mobile/src/screens/DriverAccountPanel.tsx, variant-screen.merchant.tsx y App.tsx (237-242) — «Cerrar sesión» al final de Cuenta en Flash Driver y Flash Negocios, con confirmación y bloqueado con un servicio activo o el local abierto.
- src/operations/OperationsSurface.tsx (400-435) y src/api.ts — botón principal de conexión con tiempo en línea, «Pedidos · Viajes», sección «Mi cuenta» con app de navegación (/api/driver/preferences), legajo y vehículo; con el GPS denegado, «Activá la ubicación en el navegador para recibir pedidos» con los pasos.
- src/shell/StaffShell.tsx (42-60, 97-113) y src/App.tsx (923-1013) — modos filtrados por user.roles, panel de métricas sólo para admin, role tab y aria-selected, sin marco de teléfono para roles reales.

**Servidor:** Nada nuevo. El incidente de seguridad existe sólo para viajes: en repartos y envíos se abre un caso con categoría safety y prioridad urgente. Waze no entra: no está en NavigationProvider.

**Fuentes:** https://help.uber.com/driving-and-delivering/article/i-cant-go-online-?nodeId=6ff4001e-511d-49b6-b2bb-3028d6342abb · https://www.uber.com/us/en/drive/safety/ · https://help.uber.com/driving-and-delivering/article/i-want-to-choose-which-types-of-trip-or-delivery-requests-to-receive?nodeId=2e6ebbdc-7ba5-4da9-9778-1fe02e0b9519 · https://www.uber.com/us/en/drive/basics/

**Verificación:** Como repartidor real con un documento rechazado: el checklist marca «Legajo» y lleva a Cuenta; al aprobarlo, «Conectarme» funciona. Con un viaje propio activo, reportar un incidente desde el escudo y verlo en el backoffice; abrir un caso y leer la respuesta de soporte. Intentar cerrar sesión con un servicio activo y leer el bloqueo. En la web, entrar como repartidor y confirmar que no aparecen «Ops» ni las métricas de la plataforma.

### FE-20. Mirar antes de registrarse: modo invitado en web y móvil

Que una persona sin cuenta elija una dirección, recorra comercios y arme el carrito, y que el acceso se pida recién al pagar.

**Huecos:** WEB-CLI-02, MC-16 (modo invitado)

**Cambios:**

- server/http/maps-router.js y catalog-router.js — geocodificación y búsqueda sin sesión, con límite de uso por IP y sin datos personales; el resto del catálogo ya es público.
- src/App.tsx (882-901) — sin sesión se monta CustomerApp en modo invitado con un estado mínimo armado del catálogo público.
- src/customer/CustomerSurface.tsx y CustomerNavigation.tsx — Inicio, Explorar, tienda y ficha funcionan; «Ir a pagar», «Pedidos», «Cuenta» y favoritos abren «Ingresá o creá tu cuenta para seguir»; campana y Actividad ocultas.
- src/api.ts — carrito del invitado en localStorage (con try y catch) y recuperación con api.saveCart al ingresar.
- src/auth/WebLogin.tsx — vuelve al punto donde se pidió el acceso.
- apps/mobile/App.tsx (265-277), LoginScreen.tsx y screens/CustomerScreen.tsx — elegir dirección y ver Pedidos y tiendas en sólo lectura; el acceso se pide al tocar «Agregar» o «Pedir viaje»; fuera «Repetir contraseña».
- apps/mobile/src/api.ts.

**Servidor:** Abrir geocodificación y búsqueda con límite de uso; fusión explícita del carrito al ingresar si ya había uno. Ingreso por SMS, Google y Apple: borde de tercero, no se construye acá.

**Fuentes:** sin fuente oficial (comportamiento observable en ubereats.com) · https://help.uber.com/h/fdfc0273-f67e-4545-9885-f89d0ca0aacf

**Verificación:** En una ventana privada: localhost:5173 muestra el inicio con el comercio real, se abre la tienda por su URL, se agrega un producto y «Ir a pagar» pide ingresar; al crear la cuenta el carrito sigue ahí. Sin sesión no hay campana ni Actividad. En la pestaña Red, la geocodificación sin sesión responde y pasa a 429 al superar el límite.

### FE-21. Comercio: editar el catálogo, agotados que vuelven solos, turnos partidos y modo ocupado

Que el local mantenga su carta, sus horarios y su demora sin llamar a operaciones, en la consola web y en Flash Negocios.

**Huecos:** MERW-07, MERW-08, MERW-09, MERM-04, MERM-06, MERW-16

**Cambios:**

- migración — available_until en ítems e inventario por sucursal, archived_at en ítems, busy_until y busy_extra_min en la sucursal, y más de una franja por día en branch_operating_hours.
- server/catalog-repository.js, catalog-router.js y server/merchant-pause-repository.js — editar nombre, descripción y categoría; archivar; disponibilidad de una opción suelta; modo ocupado con vencimiento; demorar un pedido con evento en vivo al cliente; DELETE /schedule-exceptions/:date.
- src/merchant/MerchantProductSheet.tsx (nuevo) y MerchantConsole.tsx (852-941) — «Editar» con campos rotulados, categoría por combobox, validación (nombre de 2 o más, precio mayor a 0), «Archivar producto», lista agrupada por categoría con buscador.
- src/merchant/MerchantCatalogEditors.tsx — al apagar: «Agotado por hoy» o «Agotado hasta que lo reactive»; pestaña «Agotados» con «Reponer todo»; hasta 2 turnos por día, «Copiar el lunes a todos los días», excepción con horario elegible y «Quitar»; «Hora de Buenos Aires».
- src/merchant/MerchantConsole.tsx (796-844, 1004-1037) y src/styles.css (4646-4652) — «Modo demanda alta» (+10, +15, +20 por 30, 60 o 90 minutos) con banner «Sumando 15 min hasta las 21:30 · Terminar»; «Necesito más tiempo» en el pedido; botones de 44 px.
- apps/mobile/src/screens/MerchantScreen.tsx (303-317, 406-477), MerchantPause.tsx y api.ts — «Tiempo de preparación» con Normal, Ocupado y Muy ocupado; catálogo con buscador, categorías plegables, interruptor accesible y edición; Cuenta > Horarios.
- src/api.ts y src/types.ts.

**Servidor:** Varios campos y rutas nuevas (lista arriba). El precio ya se puede editar hoy. La foto del producto necesita subida con almacenamiento, que no existe: queda fuera y la ficha sigue diciendo «Sin foto».

**Fuentes:** https://merchants.ubereats.com/ar/en/resources/learning-center/uber-eats-orders-app/ · https://help.uber.com/h/64ca9a31-7dfd-45c1-91a2-f871a2d0d2b3 · https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/

**Verificación:** En el comercio real: cambiar el precio y el nombre de un producto y verlo en la web del cliente; marcarlo «Agotado por hoy» y verlo sin stock; cargar turnos 12 a 15 y 20 a 24 y confirmar que a las 17 figura cerrado; activar «+15 min por 30 minutos» y ver la demora nueva en la tienda y el banner en la consola; demorar un pedido propio y ver la hora nueva en el seguimiento.

### FE-22. Comercio: plata legible, historial de pedidos y reseñas con respuesta

Que el local entienda sus cobros, pueda revisar lo que ya salió y vea y conteste lo que dicen sus clientes; y que el repartidor vea de dónde sale su calificación.

**Huecos:** MERW-14, MERM-05, MERM-08, MERW-06, DRV-08

**Cambios:**

- migración rating_replies y rls-classification.json; server/http/merchant-router.js y server/feedback-repository.js — GET /api/merchant/orders/history paginado, GET /api/merchant/ratings sin datos personales del autor, POST /api/merchant/ratings/:id/reply, y resumen de calificaciones recibidas para el conductor.
- src/merchant/MerchantConsole.tsx (1247, 1327-1356) y src/cash-payment.ts — «Retiro del 12/11 · $X · En revisión / Pagado el 14/11 / Rechazado: motivo» con el período; filtros y «Descargar CSV» en Movimientos; «Saldo disponible para retirar».
- src/merchant/MerchantReviews.tsx (nuevo) — promedio y distribución reales, lista con filtros, «Responder» (máximo 500) con plazo; vacío «Todavía no tenés calificaciones».
- src/merchant/MerchantConsole.tsx — pestaña «Historial» con filtro por estado y buscador por número corto.
- apps/mobile/src/screens/MerchantScreen.tsx y api.ts — «Finanzas» en Cuenta (saldo, liquidaciones, conexión con Mercado Pago, «Pedir cobro» con segundo factor); «Activos | Historial»; tarjeta «Lo que dicen tus clientes».
- apps/mobile/src/screens/DriverAccountPanel.tsx y DriverEarningsPanel.tsx — «Tu calificación»: «4,8 · 37 calificaciones», distribución, etiquetas y comentarios sin identificar al cliente.
- src/api.ts y src/types.ts.

**Servidor:** Nuevo: historial del comercio, calificaciones recibidas, respuestas y resumen del conductor. Las rutas de finanzas y cobros ya existen; el cobro real depende de Mercado Pago.

**Fuentes:** https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/ · https://merchants.ubereats.com/au/en/technology/reach-customers/customer-reviews/ · https://help.uber.com/merchants-and-restaurants/article/uber-eats-orders-user-guide?nodeId=cf66954d-a1c7-4148-a011-3c2bee00a6ad

**Verificación:** Con los pedidos propios ya entregados y calificados: Historial los lista y abre la comanda en sólo lectura; Reseñas muestra la calificación real y deja responder; la respuesta se ve del lado del cliente. Finanzas muestra el retiro con estado en castellano y el CSV coincide con Movimientos. En Flash Negocios (navegador), la sección Finanzas trae los mismos números.

### FE-23. Repartidor: ganancias por semana, efectivo con tope y cobros hasta el borde

Que quien reparte vea cuánto ganó, por qué, cuánto efectivo debe y cuándo y cómo cobra, en la app y en la web.

**Huecos:** OPS-W09, DRV-13, OPS-W18, DRV-07, DRV-06

**Cambios:**

- server/driver-earnings.js y server/http/driver-router.js — parámetro de semana, detalle por servicio, resumen semanal en CSV, tope de efectivo y margen expuestos, y rutas de cuenta de cobro y solicitud de retiro reusando la revisión de payouts del comercio.
- apps/mobile/src/screens/DriverEarningsPanel.tsx — selector de semana, movimiento que abre su detalle (tarifa, propina, comisión, neto) con «Tengo un problema con este pago», tarjeta «Efectivo» con barra «$X de $TOPE» y «Cómo rendir», tarjeta «Cobros» con CBU o alias y «Pedir retiro» deshabilitado con el motivo real mientras falten las credenciales.
- src/operations/DriverEarnings.tsx (nuevo) y OperationsSurface.tsx (446-467, 1028-1038) — pestaña «Ganancias» a la par del móvil, con la misma tarjeta de efectivo.
- src/ui/SystemStateScreen.tsx — en escritorio, el repartidor ve sus ganancias en sólo lectura y «Descargar resumen semanal».
- src/backoffice/AdminCashDeposit.tsx — los canales de rendición que operaciones habilita.
- src/api.ts y apps/mobile/src/api.ts.

**Servidor:** Nuevo: semana y detalle en /api/driver/earnings, resumen descargable, tope expuesto, y cobros del conductor. El movimiento real de dinero depende de Mercado Pago y el canal de rendición es decisión del dueño: se construye hasta ahí y se dice en pantalla. El desglose de comida sigue pendiente de RES-05.

**Fuentes:** https://help.uber.com/en/driving-and-delivering/article/understand-your-weekly-earnings-statements?nodeId=ceebe501-e329-4891-98dd-f1cc026137ad · https://www.uber.com/us/en/blog/driver-statements/ · https://help.uber.com/en/driving-and-delivering/article/cashing-out-with-instant-pay?nodeId=1287939c-a6bb-448b-8d1a-20fa887aa7cb · pantalla de efectivo: sin fuente oficial

**Verificación:** Como repartidor real, después de las entregas propias: la semana muestra los servicios hechos y cada uno abre su desglose; ir a la semana anterior y ver el vacío honesto. Tras un pedido propio en efectivo, la barra de efectivo sube; registrar la rendición desde el backoffice y verla en el historial. El CSV coincide con la pantalla. «Pedir retiro» está deshabilitado con el motivo escrito.

### FE-24. Backoffice: mapa en vivo real, detalle con línea de tiempo, búsqueda y plata por período

Que operaciones vea lo que pasa en un mapa con datos reales, abra cualquier pedido con su historia y busque sin cargar todo en memoria.

**Huecos:** OPS-W05, OPS-W08, OPS-W12, OPS-W11, OPS-W13

**Cambios:**

- servidor — GET /api/admin/ledger?from&to&cursor con exportación CSV.
- src/maps/FlashMap.tsx — varios marcadores y polígonos.
- src/backoffice/OpsLiveMap.tsx (nuevo) — capas de repartidores en línea (gris si la posición tiene más de 2 minutos), pedidos sin asignar con minutos de espera, retiros y entregas en curso y zonas por demanda; leyenda «Sin repartidores en línea en esta zona».
- src/backoffice/AdminOverviewBoards.tsx (238-308) y OperationsInterventionPanel.tsx (128-187) — la fila abre un panel con línea de tiempo y minutos entre estados, partes con nombre, desglose de cobro, evidencia y acciones con motivo («Soltar y volver a ofrecer», «Abrir ticket», «Cancelar»); «Avanzar» sale de la grilla.
- src/backoffice/AdminDataTable.tsx (nuevo), AdminMarketplacePanels.tsx y AdminTrustPanels.tsx — buscador con debounce, chips de estado, «Cargar más» por cursor y vacío con el texto buscado, sobre los getOperations* que ya existen; sección «Auditoría».
- src/backoffice/AdminFinanceOverview.tsx y AdminConsole.tsx — selector Hoy, 7 días, 30 días, Mes; tabla del ledger paginada con «Exportar CSV»; «Saldo repartidores» y «Efectivo por rendir».
- src/operations/OperationsSurface.tsx (436-447) y src/api.ts — mapa de demanda del repartidor con polígonos de /api/driver/demand-zones y el pie «Actualizado hace X min · no garantiza pedidos».

**Servidor:** Nuevo: el ledger por período. El mapa usa el estado ya cargado; un endpoint por recuadro queda para cuando haya volumen. Buscar pedidos por id necesitaría una ruta que no existe y no entra.

**Fuentes:** https://help.uber.com/en/merchants-and-restaurants/article/zarz%C4%85dzanie-dostawami?nodeId=bd42b644-e32e-45bf-a2e3-181cd00770b5 · https://help.uber.com/driving-and-delivering/article/why-are-areas-in-the-map-color-shaded?nodeId=4f676c32-f244-4084-88bc-5253071a2dc3 · https://help.uber.com/en/merchants-and-restaurants/article/view-and-download-current-and-past-weekly-pay-statements?nodeId=2dd1e1e6-96a5-4ae5-8d0b-03915aea4956

**Verificación:** Con el repartidor real conectado y un pedido propio en curso: el mapa muestra su posición y el pedido; al desconectarlo desaparece; sin nadie, la leyenda lo dice. Abrir el pedido y leer su línea de tiempo; soltarlo con motivo y ver la nueva oferta. Buscar el comercio propio por nombre. Finanzas en 7 días coincide con el CSV y no cuenta el pedido cancelado en la Ola 11.

### FE-25. Web: tokens, modo oscuro, contraste y accesibilidad de lo que quedó sin tocar

Cumplir en toda la web la regla de tokens y modo oscuro, y cerrar los huecos de accesibilidad que ninguna ola anterior tocó.

**Huecos:** WEB-CLI-23, WEB-CLI-24, MERW-19, MERW-20, OPS-W19, OPS-W21

**Cambios:**

- src/styles/foundation.css (1-24, 9, 49) — tokens semánticos y su versión oscura bajo prefers-color-scheme y data-theme; --muted para texto a 4,5:1.
- src/styles.css, src/adaptive.css y src/styles/customer-home.css, customer-feed.css, customer-scope.css, customer-desktop.css — hex literales a tokens, empezando por cliente, después .merchant-*, .branch-*, admin-*, offer-card y work-card; min-height de 44 px en botones de tarjetas y filas.
- src/customer/CustomerNavigation.tsx (76-88) — aria-current y aria-label «Secciones».
- src/customer/FoodCatalogComponents.tsx (70-126) — RestaurantCard como article con botón principal y un botón de favorito aparte de 44 px con aria-pressed; alt vacío en imágenes que repiten el nombre.
- src/merchant/MerchantConsole.tsx, MerchantCatalogEditors.tsx, MerchantCashSwitch.tsx y MerchantPickupSwitch.tsx — aria-current en la sección, aria-label en botones de ícono, diálogo del pedido con foco atrapado y Escape, role switch en los interruptores.
- src/operations/OperationsSurface.tsx (239-271) y src/backoffice/AdminSupportOperations.tsx — labels visibles en «Alta rápida»; contador de oferta en una región aparte.
- src/backoffice/AdminConsole.tsx y Cuenta del cliente — selector Sistema, Claro, Oscuro. src/maps/FlashMap.tsx — brillo reducido en oscuro.

**Servidor:** Ninguno.

**Fuentes:** sin fuente oficial: regla del proyecto (tokens, modo oscuro, accesibilidad)

**Verificación:** Emular prefers-color-scheme dark en el navegador y recorrer cliente, consola de comercio, repartidor y backoffice: sin fondos blancos fijos ni texto ilegible; medir contraste de texto secundario y chips de estado. Recorrer con teclado el inicio, una tarjeta de local con su favorito y el diálogo del pedido del comercio. test:responsive-browser a 375, 1024 y 1440 px en los dos temas.

### FE-26. Apps móviles: objetivos de 44 px, rótulos, contraste y tokens

El mismo barrido en las tres variantes móviles, que se usan con una mano y en movimiento.

**Huecos:** MC-25, DRV-15

**Cambios:**

- apps/mobile/src/styles.ts — foodAddButton, foodQuantityButton, foodSearchClear, choice, shareAction, foodMenuTabButton, proofCameraButton, driverHeaderAction, issueCategoryPill y merchantSyncButton a 44 px; rótulos de 12 px como mínimo; barra inferior a 12 px.
- apps/mobile/src/design-system.ts — tokens brand, success, danger y warning; reemplazo de #7c3cff y #ff6a21 sueltos.
- apps/mobile/src/screens/CustomerTabBar.tsx (65) — pestaña inactiva con inkSoft a 4,5:1.
- apps/mobile/src/screens/CustomerFoodBrowseScreen.tsx, CustomerFoodRestaurantScreen.tsx, CustomerFoodCartScreen.tsx y CustomerRideScreen.tsx — accessibilityRole y accessibilityLabel en volver, tarjetas, categorías (con selected) y campos de texto.
- apps/mobile/src/screens/DriverHomePanel.tsx, DriverAccountPanel.tsx, DriverEarningsPanel.tsx y DriverJobCards.tsx — hitSlop en íconos sueltos, «Activar vehículo {modelo}», «PIN del pasajero», rol radio en chips y rol button en tarjetas de reintento.
- apps/mobile/src/MerchantPause.tsx (149) — chips de 44 px.
- apps/mobile/src/screens/CustomerActivityScreen.tsx (604) y CustomerShipmentScreen.tsx (251-252) — Ionicons en lugar de emojis.
- scripts/mobile-food-design-smoke.mjs — vigila alturas mínimas y rótulos.

**Servidor:** Ninguno.

**Fuentes:** sin fuente oficial: regla del proyecto

**Verificación:** Móvil en el navegador a 375 px: inspeccionar el árbol de accesibilidad de portada, tienda, carrito, viaje y cada pestaña del repartidor; ningún botón sin nombre ni menor a 44 px. test:mobile-food-design falla al bajar un objetivo a 40. El lector de pantalla real se prueba en teléfono.

## Cola posterior

- orden: 1; ids: ['MERW-10']; que: Chat del comercio con el cliente en la consola web, reutilizando src/ui/ServiceChatPanel.tsx de la Ola 10. Sin backend nuevo.; fuente: https://merchants.ubereats.com/ar/en/resources/learning-center/uber-eats-orders-app/
- orden: 2; ids: ['MERW-11']; que: «Imprimir comanda» con hoja @media print para papel de 58 y 80 mm, sin datos personales salvo el nombre de pila. Sin backend.; fuente: https://merchants.ubereats.com/ar/en/resources/learning-center/uber-eats-orders-app/
- orden: 3; ids: ['MERW-13']; que: Rendimiento con rangos de fecha. Necesita GET /api/merchant/reports; vacío honesto sin historial.; fuente: https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/
- orden: 4; ids: ['MERW-15', 'MERM-03 (quitar un producto con reintegro parcial)']; que: Reclamos visibles para el comercio y disputa con evidencia; quitar un faltante sin reemplazo. Necesita rutas nuevas y estado de disputa.; fuente: https://merchants.ubereats.com/us/en/order-errors/
- orden: 5; ids: ['DRV-04']; que: «No encuentro al cliente»: escribir, espera con cuenta regresiva y, al vencer, dejar con foto o devolver al local. Necesita ruta de intento de entrega y regla de cierre sin código. La llamada enmascarada queda afuera.; fuente: https://www.uber.com/en-ZA/blog/using-the-countdown-timer-correctly
- orden: 6; ids: ['MERW-12']; que: Promociones financiadas por el comercio. Necesita merchant_id y funded_by en promotions, RLS, cargo al ledger y métricas. Con esto WEB-CLI-05 puede llevar cada promoción a los locales donde aplica.; fuente: https://merchants.ubereats.com/pa/en/resources/learning-center/promotions/
- orden: 7; ids: ['WEB-CLI-21', 'MC-15']; que: Tarjetas guardadas y pago de viajes con tarjeta. Bloqueado por las credenciales productivas de Mercado Pago (dueño).; fuente: https://help.uber.com/en/riders/article/updating-a-payment-method-on-your-account?nodeId=8f78dca4-9d75-44f1-bdc1-e90ca3da0319
- orden: 8; ids: ['MERW-22']; que: Equipo del comercio por rol (Cocina, Encargado, Dueño). Necesita merchant_members con RLS e invitaciones.; fuente: https://merchants.ubereats.com/gb/en/resources/learning-center/uber-eats-manager/
- orden: 9; ids: ['DRV-12']; que: Soltar un servicio aceptado antes del retiro. Sólo tiene respaldo en una página de DoorDash que la auditoría no pudo leer (403): antes de construir, conseguir una fuente oficial de Uber o PedidosYa o descartarlo por escrito.; fuente: sin fuente oficial verificada

## Lo que depende de terceros

- Mercado Pago productivo (dueño): tarjetas guardadas, carga de Wallet, pago de viajes con tarjeta, cobros de comercio y retiros del repartidor.
- Dispositivo y credenciales EAS, ticket NOT-001 (dueño): push real, sonido y vibración en segundo plano, cámara, botón Atrás físico, lector de pantalla.
- API key de rutas, tickets GEO-001 y DSP-001 (dueño): hora de llegada del repartidor al local.
- Proveedor de SMS y credenciales OAuth de Google y Apple (dueño): ingreso con celular o cuenta externa.
- Proveedor de telefonía (dueño): llamada con número enmascarado.
- Almacenamiento de archivos (decisión del dueño): foto propia de cada producto.

## Riesgos

- La Ola 1 cambia el contrato del catálogo (rating puede ser null): web y móvil tienen que salir en el mismo PR para que la app no muestre «0.0».
- Las Olas 3 y 4 crean dos tablas y otorgan roles: son las de mayor riesgo de seguridad; cada una lleva su fila en rls-classification.json y su prueba negativa antes de cualquier pantalla.
- Mientras no exista el comercio real de la Ola 3, las Olas 1 y 2 sólo se pueden verificar en pantalla en sus estados vacíos; lo demás queda cubierto por pruebas que crean y borran sus propios datos, y se reconfirma en el navegador al cerrar la Ola 3.
- docs/paridad-competitiva.md afirma «Seguimiento en vivo, chat y calificaciones» como ya a la par; las auditorías muestran que la web no tiene chat y el móvil no puede calificar. Hay que corregir esa fila en el PR de la Ola 10 y de la Ola 11.

## Descartes

- ids: ['WEB-CLI-25']; motivo: Es rendimiento interno (recarga de estado cada 15 s), sin precedente de competidor con fuente y sin cambio visible. Pasa a docs/backlog-tecnico.md; no entra en este plan de experiencia.
- ids: ['OPS-W12 (sólo Ctrl+K)', 'OPS-W02 (sólo atajos A y R)']; motivo: Sub-partes sin precedente ni fuente; el resto del hueco se mantiene.
- ids: ['MC-16 (ingreso por SMS, Google y Apple)']; motivo: No se descarta: depende de un proveedor de SMS y de credenciales OAuth que tiene el dueño. Se construye el modo invitado (Ola 18) y el ingreso por terceros queda nombrado como borde.
- ids: ['MC-09 (foto del conductor y llamada enmascarada)', 'DRV-04 (llamada enmascarada)']; motivo: Dependen de un proveedor de telefonía y de un campo de foto que no existe. Patente, chat y PIN sí entran (Ola 10).
- ids: ['MC-19 («Avisame cuando llegue a mi zona»)']; motivo: No existe la suscripción; ofrecer el botón sería un acceso a nada.
- ids: ['WEB-CLI-21', 'MC-15 (pago con tarjeta guardada en viajes y carga de Wallet)']; motivo: Borde de tercero: credenciales productivas de Mercado Pago. Ahora sólo se dice la verdad en pantalla (Ola 16); la gestión de tarjetas queda en la cola posterior.
