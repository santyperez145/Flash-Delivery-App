# Investigacion competitiva

Investigación de mercado: **14 de agosto de 2026**. Comparación contra el estado real del
producto: **28 de agosto de 2026**.

> **Por qué hay dos fechas.** La lectura del mercado envejece despacio; el estado del
> producto envejece todos los días. Hasta el 28 de agosto este documento listaba como
> faltantes cosas que ya existían —refresh tokens, observabilidad, conciliación— y eso es
> el hallazgo [H-10](auditoria-2026-08-25.md#h-10--documentación-desalineada-del-runtime)
> dentro del documento que debería guiar la comparación. La sección de paridad de abajo se
> mide contra el repositorio, no contra el recuerdo.

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

## Paridad medida contra el repositorio, al 28 de agosto

Lo que sigue se verificó contra el código y las migraciones, no contra la memoria. Cada
«sí» tiene tabla, ruta y suite; cada «no» se buscó y no está.

### Lo que ya está a la par

| Capacidad | Estado | Dónde se verifica |
| --- | --- | --- |
| Descubrimiento, búsqueda y catálogo paginado | sí | `test:catalog-pagination` |
| Carrito por comercio, extras y notas | sí | `catalog_modifiers`, `cart_items` |
| Cotización por coordenadas y ETA | sí | `test:maps`, `test:dispatch-candidates` |
| Tracking en vivo y reanudable | sí | `realtime_events`, `test:realtime-audience-runtime` |
| Enlace público de seguimiento de viaje | sí | `ride_tracking_links` |
| Programación de pedidos | sí | `jobs.scheduled_for` |
| Sustituciones y aceptación por el cliente | sí | `test:order-substitutions` |
| Reembolso total y **parcial** | sí | `payment_intents.partially_refunded` |
| Propinas con revisión y ajuste | sí | `test:tip-adjustments` |
| Chat de servicio con respuestas rápidas | sí | `service_messages`, `test:service-chat` |
| Calificaciones y favoritos | sí | `ratings`, `favorites` |
| Promociones, referidos y wallet | sí | `test:referrals`, `test:postgres` |
| Alérgenos y preferencias dietarias | sí | `test:dietary-local` |
| Sucursales por comercio y horarios | sí | `merchant_branches` |
| Envíos con protección, siniestros y devoluciones | sí | `test:shipment-claims` |
| Riesgo transaccional con revisión humana | sí | `test:transaction-risk` |
| Multi-ciudad en el modelo de datos | sí | `cities`, selector en el panel de zonas |
| Flags por rol, ciudad y rollout | sí | `test:feature-flags` |

### Lo que falta para competir, y no es técnico

Cuatro huecos con nombre. Los dos primeros **están cerrados desde el 28 de agosto**; quedan dos.

**1. ~~No hay producto de suscripción.~~ Hay uno: *Flash Más*.** Uber One, DashPass y
PedidosYa Plus son el motor de retención y de margen de la categoría, y era el hueco que
más pesaba. La migración 125 lo modela y las rutas `/api/subscription*` lo exponen; web y
móvil lo venden, lo muestran y lo dan de baja.

Tres diferencias con lo que hace la categoría, y las tres son deliberadas:

- **El beneficio vive en la fila del plan, no en el código.** Mover el umbral de envío sin
  cargo o el precio es un `UPDATE`, no un despliegue. El smoke lo demuestra corriendo el
  umbral por encima y por debajo del subtotal del mismo pedido.
- **Está dicho quién paga el beneficio.** El comercio cobra igual y el conductor cobra el
  envío completo aunque el cliente no lo pague: la diferencia sale del margen de Flash. La
  alternativa —descontarlo del reparto— financia la retención con la plata del comercio y
  del repartidor, que es exactamente lo que la categoría hace y por lo que la demandan.
- **Todavía no cobra, y la app lo dice.** El cobro recurrente depende de credenciales del
  proveedor (PAY-001). Cada período otorgado queda marcado como no cobrado y la pantalla
  muestra «Período bonificado» en lugar de simular una suscripción paga.

De los tres beneficios del plan sólo el envío sin cargo se aplica hoy. La comisión reducida
en viajes no, porque el estimador de tarifa es público y no sabe quién pregunta; la
prioridad de dispatch tampoco, porque el orden de candidatos lo decide DSP-001. Están en la
fila del plan y nombrados como pendientes, no marcados como hechos.

**2. ~~La propina sólo existe después de entregar.~~ Ahora también se deja en el checkout.**
Los competidores la piden antes de asignar porque así se deja más seguido, y la propina es
la ganancia por viaje de quien reparte — la variable con la que se compite por oferta de
reparto.

El detalle que hace difícil copiarlo es que **en el checkout todavía no hay a quién
pagarle**. Flash lo resuelve reteniéndola: se cobra junto con el pedido, en un solo cargo,
y se libera entera cuando hay conductor y el servicio se completa. Si el pedido se
reintegra, vuelve con el resto.

Dos decisiones que la categoría no siempre toma: **la propina no se reparte** —sale del
total antes de dividir entre comercio, conductor y plataforma, así que nadie se queda con
una parte— y **los porcentajes se calculan sobre el subtotal, no sobre el total**, para que
no suba cuando sube el envío o la tarifa de servicio.

**3. No hay pedidos grupales.** Uber Eats, DoorDash y Rappi los tienen. Es la vía natural
al ticket promedio alto y al pedido de oficina.

**4. Un pedido programado no se puede reprogramar.** Existe `scheduled_for` y no existe el
camino para moverlo, así que hoy la salida es cancelar y volver a pedir.

### Lo que Flash tiene y no es habitual a esta altura

Vale decirlo con la misma honestidad que los huecos, porque es lo que un due diligence
técnico mira y rara vez encuentra en una etapa temprana:

- **Partida doble obligada por la base**, no por convención de código: un `CONSTRAINT
  TRIGGER` diferido rechaza al commit toda transacción contable que no cuadre.
- **Los registros de dinero y de eventos son append-only para el runtime**: el rol que
  atiende el tráfico no puede modificar ni borrar un asiento posteado, un mensaje enviado o
  el registro de migraciones aplicadas.
- **Row-Level Security sobre 91 tablas con 175 políticas**, con pruebas negativas por rol.
- **Ensayo de restore en cada PR**: se vuelca y se restaura de verdad, y se verifica que el
  esquema, las políticas y los permisos sobrevivan al viaje.
- **Toda decisión operativa registra actor y motivo** en un log append-only.
- **Ninguna ruta queda construida y sin cablear**: una puerta lo impide, con línea base en
  cero.

La lectura para un inversor no es «está terminado». Es: **el sustrato operativo y
financiero está por encima de la etapa, y los huecos que quedan son de producto comercial y
de habilitaciones externas**, que son los que se cierran con plata y con acuerdos, no con
refactors.

### Lo que depende de terceros y no de decidir

| Bloqueo | Qué destraba |
| --- | --- |
| Credenciales de Mercado Pago con sellers de prueba | validar el marketplace de punta a punta (PAY-001) |
| API key de mapas comercial | ETA vial real en el scoring y direcciones validadas (GEO-001) |
| Un Android y un iPhone físicos, y credenciales de EAS | push real y background location (NOT-001, MOB-001) |
| Un entorno desplegado | todo lo que hoy dice `PROV`, `STG` o `PROD` en cero |
| Un segundo revisor en GitHub | las dos aprobaciones en pagos y seguridad (CI-001) |

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
- [Seguridad para pasajeros de Uber](https://www.uber.com/us/en/ride/safety/tips/)
- [Safety Toolkit de Uber](https://www.uber.com/us/en/newsroom/ubers-new-safety-toolkit/)
- [Modalidades de viaje de Lyft](https://help.lyft.com/hc/en-ca/all/articles/115012927427-Lyft-ride-modes-overview)
- [Live Order Tracking FAQ de Uber Eats](https://help.uber.com/en/merchants-and-restaurants/article/live-order-tracking---faq?nodeId=d006582e-113f-4423-9d33-e938de34b3a2)
- [Support de Uber Eats](https://help.uber.com/merchants-and-restaurants/article/support?nodeId=a467254f-b6b2-4e11-a88b-d96653ca1f81)
- [Uber Courier: entrega local de paquetes](https://www.uber.com/us/en/item-delivery/)
- [Uber Courier: preguntas frecuentes de paquetes](https://help.uber.com/riders/article/courier-package-delivery-faq?nodeId=2f234df8-cdf6-4bf9-81da-8f68b79b35f5)
- [Uber Connect: seguimiento y comunicación de paquetes](https://www.uber.com/us/en/newsroom/uber-connect-holiday/)

## Pricing y rutas competitivas

El cotizador de movilidad adopta el patron de precio adelantado: el servidor combina distancia y duracion previstas, modalidad, oferta/demanda, tarifa de servicio y peajes estimados. La cotizacion se firma y conserva durante cinco minutos; al solicitar, la API valida el token para impedir que el cliente modifique el precio.

La navegacion separa dos responsabilidades, como recomiendan los proveedores de mapas: matriz/estimacion para comparar alternativas y ruta detallada para polyline y maniobras. Flash usa OSRM/OpenStreetMap en desarrollo y deja los proveedores configurables para migrar a trafico predictivo, peajes y SLA comercial.

### Decisión 22 de agosto de 2026 — tracking web de pedidos

La referencia oficial de Uber Eats confirma que el cliente espera progreso y ubicación del repartidor durante la entrega, pero que esa visibilidad depende de señales reales del comercio/repartidor; también ubica la ayuda dentro de la ventana de tracking o del historial. Por eso la PWA web de Flash ahora abre un seguimiento dedicado desde Actividad, consume la ruta autenticada existente, muestra el repartidor sólo cuando el backend lo asignó y conserva timeline/ETA cuando el proveedor de mapas no responde. No se agregó una posición interpolada ni un enlace público ficticio.

### Decisión 22 de agosto de 2026 — viaje activo y seguridad

Uber concentra en el viaje activo compartir ubicación, verificación por PIN, acceso a ayuda y reporte de incidentes. Flash lleva ese patrón a la PWA con contratos ya persistidos: la persona autenticada puede solicitar un PIN, crear un enlace temporal revocable con vista pública móvil y registrar un incidente con tipo, detalle y ubicación disponible. No se implementan llamadas automáticas a emergencias ni SMS como si estuvieran habilitados: esas funciones requieren jurisdicción, proveedor, procedimiento operativo y prueba física antes de pasar a producción.

- [Precio adelantado de Uber](https://www.uber.com/us/en/ride/how-it-works/upfront-pricing/)
- [Google Routes: matriz de distancia y duracion](https://developers.google.com/maps/documentation/routes/compute_route_matrix)
- [Google Routes: trafico, peajes y rutas detalladas](https://developers.google.com/maps/documentation/routes/reference/rpc/google.maps.routing.v2)

### Decisión 22 de agosto de 2026 — seguimiento de envíos en web

Las referencias oficiales de Uber Courier y Uber Connect consolidan tres expectativas para una entrega local: seguimiento durante el trayecto, visibilidad controlada para la persona destinataria y verificación de entrega mediante PIN. Flash ya tenía estas capacidades en mobile; esta entrega las lleva a la Actividad web autenticada con ruta OSRM, estado persistido, conductor sólo cuando está asignado, PIN bajo demanda y metadatos de evidencia. La PWA no publica la ubicación ni el teléfono del destinatario y no presenta una posición interpolada si no existe una señal del backend.

Antes de esta entrega la creación web quedó deliberadamente separada: primero había que trasladar el cotizador firmado, restricciones de categoría, protección/valor declarado, términos e idempotencia a un flujo equivalente al mobile. Esto evitó habilitar una pantalla visualmente completa con un contrato de precio incompleto.

La decisión se actualizó después de implementar el flujo web: Flash ahora sí traslada la cotización y solicitud porque el formulario usa los mismos controles del backend, geocodificación, token firmado, términos e idempotencia. El alcance de pago queda limitado a Flash Wallet hasta disponer de captura externa y conciliación para envíos.

### Decisión 22 de agosto de 2026 — revisión y pago web de comida

La ayuda oficial de Uber Eats permite seleccionar la forma de pago antes de
confirmar y deja claro que cambiar la dirección puede modificar tarifa o incluso
dejar el comercio fuera de cobertura. Flash adopta esa expectativa sin copiar su
interfaz: el checkout web muestra únicamente direcciones geocodificadas de la
cuenta, permite elegir Wallet o el proveedor externo realmente habilitado y
recalcula en servidor ante cualquier cambio de dirección, pago, cupón o carrito.

El total visible incluye distancia, ETA, versión tarifaria y vencimiento; el
pedido reutiliza exactamente el JWT cotizado en vez de generar silenciosamente
otro total al confirmar. Una cotización vencida, fallida o sin dirección bloquea
la compra con un estado explícito. La tarjeta continúa tokenizándose en el Brick
oficial de Mercado Pago y nunca entra PAN/CVV al backend de Flash.

- [Uber Eats: cambiar método de pago antes de confirmar](https://help.uber.com/ubereats/restaurants/article/node?nodeId=44c3136d-1dd4-431a-b44a-ceabf5e1e1f3)
- [Uber Eats: impacto de cambiar dirección](https://help.uber.com/en/ubereats/restaurants/article/%E6%9B%B4%E6%94%B9%E6%88%91%E7%9A%84%E5%9C%B0%E5%9D%80?nodeId=f2e3c07a-09dd-4c63-aa57-8a13789cbb7e)

### Decisión 22 de agosto de 2026 — inicio de Viajes web

Uber y Lyft documentan el mismo orden: proponer el punto de retiro desde GPS,
permitir corregirlo, elegir un destino real y recién entonces comparar modalidad
y precio. Flash eliminó la ruta precargada de demostración en desktop/PWA. Al
entrar, usa una sola vez la dirección principal geocodificada de la cuenta si
existe; de lo contrario presenta un estado vacío y la acción de GPS.

Los destinos guardados conservan sus coordenadas, la vista previa solicita la
ruta vial a la API y dibuja teselas OpenStreetMap con atribución. Escribir texto
libre invalida las coordenadas anteriores y toda variación invalida el precio
firmado. No se anima un vehículo ni una ruta inexistentes.

- [Uber: cómo solicitar un viaje](https://help.uber.com/riders/article/how-to-request-a-ride-?nodeId=e9862b49-81c6-4c6a-a9d3-3c05bf42e82e)
- [Lyft: cómo solicitar un viaje](https://help.lyft.com/hc/en-us/all/articles/115013079988-How-to-request-a-ride.3)

### Decisión 22 de agosto de 2026 — interacción y jerarquía visual del mapa

Las guías oficiales de [Uber para corregir el pickup](https://www.uber.com/us/en/ride/how-it-works/change-location/) y [seleccionar puntos de encuentro](https://www.uber.com/us/en/ride/how-it-works/pickup-spots/) confirman que el mapa no es una captura decorativa: permite arrastrar el pin, explorar un radio y confirmar una ubicación. Su explicación general también indica que el pasajero [sigue la llegada del conductor en el mapa](https://www.uber.com/us/en/ride/how-it-works/). Lyft documenta el mismo orden de decisión: GPS inicial, destino, categoría y confirmación o corrección del pickup en [How to request a ride](https://help.lyft.com/hc/en-us/all/articles/115013079988-How-to-request-a-ride). Para seguridad, Lyft comparte [ubicación aproximada, ruta e identidad del vehículo](https://help.lyft.com/hc/en/all/articles/360051084234-Sharing-your-ride-location-with-friends-and-family), siempre vinculadas a un viaje real.

Decisión derivada: Flash migra desde teselas HTML fijas a un viewport GPU interactivo con pan/zoom, reencuadre, origen oscuro, destino verde, ruta violeta con casing y conductor naranja sólo cuando existe una coordenada persistida. Se preservan atribución y fallback. Todavía no se habilita edición libre del pickup tras solicitar, navegación giro a giro ni zonas prohibidas: requieren reglas operativas, routing/traffic con SLA y validación de seguridad. Tampoco se copian colores, íconos, texto o activos propietarios de Uber/Lyft.

La selección técnica usa [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) por su renderer TypeScript/WebGL, estilo abierto y sustituibilidad. La cartografía raster pública queda sólo como fallback local; un mapa de marca comparable en producción necesita estilo vectorial y tiles habilitados, configurados mediante URL/orígenes públicos explícitos.

Para mobile se evaluó el módulo [Expo Maps](https://docs.expo.dev/versions/latest/sdk/maps/), pero su documentación vigente lo mantiene en alpha y fuera de Expo Go. Flash adopta [react-native-maps](https://github.com/react-native-maps/react-native-maps), mantenido bajo MIT y compatible con el runtime React Native actual, porque permite usar los SDK nativos maduros de Google Maps y Apple MapKit sin introducir un segundo motor JS. El estilo, marcadores, casing y reencuadre son propios; no se copian mapas, activos ni identidad de un competidor. La clave Google se inyecta sólo en builds Android y debe estar limitada por package/certificado.

La navegación del conductor conserva una vista operacional dentro de Flash y delega la guía completa al proveedor del dispositivo. La documentación vigente de [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) define una URL universal sin API key, exige `api=1` y permite `dir_action=navigate`; [Apple Map Links](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html) admite `daddr` y `dirflg=d`, usando “aquí” cuando se omite el origen. La decisión evita construir prematuramente un navegador crítico propio sin tráfico, voz, cierres viales ni validación física, pero mantiene mapa, estado, ETA y destino dentro del flujo Flash.

### Decisión 22 de agosto de 2026 — shell y cockpit de Flash Driver

La guía oficial de [Uber Driver](https://www.uber.com/us/en/drive/driver-app/) divide la aplicación en Home, Earnings, Inbox y Menu. Dentro de Home, el mapa y el control Online dominan; una oferta exclusiva informa pago, pickup y recorrido con vencimiento. Después de aceptar, pickup, espera, inicio y cierre son estados operativos separados. [Lyft Upfront Pay](https://help.lyft.com/hc/en-us/driver/articles/8668928544-Upfront-pay) confirma que pago, ruta y traslado al pickup forman parte de la decisión previa del conductor.

[DoorDash In-App Navigation](https://help.doordash.com/dashers/s/article/In-app-Navigation) mantiene ruta, datos del comercio/cliente y contacto dentro de la app, con navegación externa configurable. Su [rediseño oficial](https://dasher.doordash.com/en-us/blog/new-doordash-dasher-app) prioriza mapa, ganancias, Inbox, preferencias y acciones grandes, retirando configuración secundaria del home.

Decisión derivada: Flash Driver se segmenta como producto propio. Home concentra disponibilidad, ofertas y trabajo activo; Ganancias sólo muestra importes derivados del backend; Cuenta aloja legajo y flota. La navegación abre un cockpit exclusivo del conductor con mapa, siguiente maniobra, ETA, etapa y contacto, conservando Google/Apple Maps como guía completa hasta contratar tráfico/voz y probar un build en movimiento. Las pantallas del cliente dejan de exponer maniobras OSRM y mantienen únicamente seguimiento, ETA y seguridad.

### Decisión 22 de agosto de 2026 — ganancias Driver sin proyecciones

La guía oficial de [Uber sobre ganancias de conductores](https://www.uber.com/us/en/drive/how-much-drivers-make/) organiza los importes por viaje, día/semana, propinas y promociones, y distingue lo ganado de mecanismos de retiro. Flash adopta esa jerarquía pero no su terminología ni activos: hoy/semana, servicios, propinas, ajustes y movimientos se calculan desde el ledger de doble partida y la zona horaria de la identidad autenticada. Metas, horas, promociones y retiro no aparecen como disponibles hasta existir campañas, telemetría laboral y proveedor habilitado verificables.

### Decisión 22 de agosto de 2026 — proveedor de navegación elegido por Driver

[Lyft Driver](https://help.lyft.com/hc/en-us/all/articles/115012926147) y [DoorDash In-App Navigation](https://help.doordash.com/dashers/s/article/In-app-Navigation) documentan selección o cambio del navegador desde la experiencia del conductor. Flash incorpora esa decisión en Cuenta, no en el cliente: `system`, Google Maps o Apple Maps se persisten por conductor y sólo modifican el handoff del botón de guía completa. La ruta, próximo hito y trabajo siguen siendo autoritativos en Flash; Apple sólo aparece en iOS y no se declara voz/tráfico propio.
