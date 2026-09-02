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

Cuatro huecos con nombre. **Los cuatro están cerrados al 28 de agosto.** Lo que queda es comercial —precio, oferta, medición—, no de ingeniería.

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

**3. ~~No hay pedidos grupales.~~ Los hay, en web y en móvil.** Es la vía natural al ticket
promedio alto y al pedido de oficina, donde un pedido reemplaza a diez.

Tres decisiones que la categoría no siempre toma:

- **El grupo confirmado se vuelve un pedido normal.** No hay una segunda tubería de pedidos,
  así que la propina, la suscripción, el horario reservado y la liquidación no necesitan un
  caso especial de grupo. Es lo que evita que la mitad de las funciones nuevas se olviden
  del camino grupal seis meses después.
- **El tope de gasto se verifica contra los precios de la base.** Un tope que se pueda
  esquivar mandando precios inventados no es un tope, y es la diferencia entre un pedido
  entre amigos y uno de oficina con presupuesto.
- **El código para sumarse no da lectura por sí solo.** Primero se entra, después se ve. Al
  revés, cualquiera con un código filtrado leería quién pidió qué en una oficina.

**4. ~~Un pedido programado no se puede reprogramar.~~ Ahora se programa y se mueve.** El
hueco era más grande de lo que decía su nombre: **un pedido de comida no se podía programar
en absoluto.** `scheduled_for` existía desde la primera migración y sólo lo escribía el alta
de viajes, mientras la portada prometía «Programar · Food o taxi».

Hoy el checkout reserva horario en las dos plataformas, y `PATCH /api/jobs/:id/schedule` lo
mueve —pedido o viaje, la misma ruta— mientras nadie haya empezado. Después no: mover la
hora cuando el comercio ya está cocinando tira comida, y con conductor asignado le hace
perder el viaje a alguien que se comprometió. Ahí la salida correcta es cancelar con su
política, no mover la hora como si no hubiera costado nada.

El detalle que la categoría suele resolver mal: **una reserva no es trabajo activo.** Las
reservas fuera de ventana salen de la cola del comercio y de su métrica de demora, y se
cuentan aparte para que pueda planificar el turno.

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

**Decisión de seguridad comparada, 29 de agosto.** La documentación vigente de
[PostgreSQL](https://www.postgresql.org/docs/current/ddl-priv.html) separa
`INSERT`, `UPDATE` y `DELETE` como privilegios distintos y permite revocarlos por
objeto; por eso Flash mide pares tabla/operación en lugar de declarar una tabla
genéricamente “escribible”. Uber publica un modelo todavía más maduro: políticas
por actor, acción y recurso, más un
[simulador que compara accesos antes y después de un cambio](https://www.uber.com/en-BR/blog/adding-determinism-and-safety-to-uber-iam-policy-changes/).
Flash queda por debajo: no tiene un PAP central ni replay de tráfico productivo.
La decisión viable para esta fase es incremental y verificable: la migración 131
retira 11 `DELETE` de sesiones, MFA, dispositivos, verificaciones y tokens, y la
132 extiende el mismo límite a seis registros de evidencia financiera —webhooks,
conexión PSP, conciliación, payouts y riesgo—. La 133 protege diez registros del
historial operativo: jobs, ofertas, incidencias, sustituciones, notificaciones,
evidencias, reclamos y devoluciones. La 134 recorta nueve operaciones del control
plane: no permite mutar una asignación de rol ni crear/borrar flags, comercios,
zonas o perfiles de soporte desde el proceso de tráfico. CI reproduce los flujos
como `flash_runtime` además de comprobar las restricciones por nombre y operación.
La 135 completa el mismo proceso sobre catálogo, carrito, preferencias,
sesiones de conductor y configuración: conserva cada operación observada y
lleva los permisos DML sin uso de 114 a **cero**. Flash todavía queda por debajo
de Uber porque la simulación se alimenta del código y de pruebas, no de replay de
tráfico productivo ni de un PAP central. Una revocación masiva sin esta
simulación habría sido menos segura, no más.

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

Revalidación del 2 de septiembre de 2026 para la consola de comercio:

- DoorDash Merchant Portal y Uber Eats Manager separan live orders, missing item / 86, menú, store hours y payouts. Flash adopta esa frontera en web y en Merchant App: cocina/Hoy, detalle/sustituciones, catálogo, sucursales, analítica y liquidaciones son módulos; el shell sólo navega y hace polling.
- En el phone-stage web, comercio, conductor y ops dejan de compartir archivo y chunk: Uber/DoorDash empaquetan por audiencia. Flash iguala esa frontera; el riel contextual sigue siendo forma compartida, no dominio.
- Cuenta mobile adopta la misma partición que Uber/DoorDash Account: seguridad, pagos, direcciones, dieta, inbox y ayuda son módulos; el shell sólo carga y muestra perfil/suscripción.
- La extracción no crea paridad ficticia. Flash sigue por debajo en POS, prep-time por ítem, evidencia fotográfica de faltantes y liquidación marketplace contra el proveedor real.

Fuentes oficiales:

- [DoorDash Merchant Portal](https://merchants.doordash.com/en-us/products/merchant-portal)
- [DoorDash Business Manager](https://merchants.doordash.com/en-us/learning-center/business-manager-app)
- [Uber Eats — live order tracking](https://help.uber.com/en/merchants-and-restaurants/article/live-order-tracking---faq?nodeId=d006582e-113f-4423-9d33-e938de34b3a2)

Revalidación del 30 de agosto de 2026 para la segmentación de Comidas:

- La guía oficial de Uber Eats mantiene una secuencia explícita de dirección → restaurante → productos → carrito/checkout → revisión → confirmación → tracking. Flash conserva esos límites como módulos de tarea y comparte sólo el estado que cruza Cuenta y Actividad.
- DoorDash mantiene el pedido activo en una superficie de Pedidos con ETA, estados de confirmación/preparación/entrega y mapa cuando existe Dasher. Flash conserva esos datos en Pedidos y en la hoja común de tracking; no los duplica dentro de cada pantalla.
- La extracción es arquitectónica y no crea paridad ficticia. Flash todavía queda por debajo en push probado físicamente, mapas con SLA comercial, pagos marketplace conciliados, cobertura operativa y soporte habilitado.

Fuentes oficiales revalidadas:

- [Uber Eats — cómo realizar un pedido](https://help.uber.com/en/ubereats/restaurants/article/how-to-place-an-order-on-uber-eats?nodeId=509d1b2f-087c-4dac-9e94-6ab248e87491)
- [DoorDash — estados y tracking de un pedido](https://help.doordash.com/en-us/consumers/article/customer-where-is-my-order)

Revalidación de soporte del 30 de agosto de 2026:

- DoorDash abre Ayuda desde el pedido, pide elegir el problema y condiciona crédito, reembolso o reentrega a las circunstancias y evidencia. Uber Eats separa ítems faltantes o incorrectos y puede solicitar imagen antes de evaluar elegibilidad.
- Flash mantiene el acceso contextual desde Actividad, categorías explícitas y revisión operativa antes del reintegro. Los formularios se extrajeron a un estado discriminado único para que cerrar un caso no deje datos de otro modal en memoria.
- Flash queda por debajo en evidencia fotográfica para incidencias de comida, plazos/política aprobados y soporte humano habilitado. La evidencia cifrada existe sólo para siniestros de Envíos y no se presenta como cobertura general.

Fuentes oficiales:

- [DoorDash — reportar un ítem faltante o incorrecto](https://help.doordash.com/en-us/consumers/article/my-order-was-missing-an-item-incorrect-order)
- [Uber Eats — ítems incorrectos o faltantes](https://help.uber.com/en/ubereats/restaurants/article/wrong-or-missing-items?nodeId=6a92ef28-0f96-433b-971a-4f87c23c21af)

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

### Decisión 29 de agosto de 2026 — identidad verificable de la dirección

La guía técnica oficial de Uber Direct indica que la plataforma vuelve a geocodificar el destino incluso cuando el integrador envía latitud y longitud, porque una coordenada aportada por el cliente no prueba por sí sola que la dirección sea entregable. Google documenta el `place_id` como identidad reutilizable entre APIs y separa la geocodificación de Address Validation, que agrega veredicto de calidad y deliverability.

Flash adopta esa frontera sin declarar una integración que todavía no existe: `/api/maps/geocode` emite una validación JWT corta, con audiencia propia y ligada al usuario; web y mobile obligan a elegir una coincidencia; y PostgreSQL guarda proveedor, `place_id`, tipo y fecha desde el token, no desde los campos repetidos por el cliente. El checkout de comida rechaza registros legacy y la cotización firmada conserva esa identidad para forzar una recotización si cambia.

La brecha competitiva queda explícita. En desarrollo, OpenStreetMap puede no devolver identidad estable; en producción el arranque y la escritura exigen proveedor comercial y `place_id`. Todavía faltan una API key habilitada, una prueba de calidad/costo en la zona real y el veredicto postal de Address Validation. Por eso la capacidad permanece en `CI`, no en `PROV`.

- [Uber Direct: geocoding de destinos](https://developer.uber.com/docs/deliveries/guides/geocoding)
- [Google Maps Platform: Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id)
- [Google Address Validation API](https://developers.google.com/maps/documentation/address-validation/reference/rest/v1/TopLevel/validateAddress)

### Decisión 29 de agosto de 2026 — Cuenta como límite sensible

La documentación oficial de Uber ubica las direcciones guardadas dentro de Cuenta y
protege cambios de teléfono con OTP. Su postura va más lejos: ofrece segundo factor por
SMS o aplicación autenticadora, códigos de respaldo y vinculación entre teléfono y
dispositivo para detectar accesos o fraude. El patrón relevante no es la estética de una
pantalla, sino que identidad, sesiones, direcciones y pagos formen un límite auditable que
no quede mezclado con el flujo transaccional de pedir un servicio.

Flash separa ahora ese límite en `CustomerAccountScreen.tsx` y conserva sus operaciones
persistidas de OTP telefónico, cierre de sesiones, direcciones validadas y métodos
tokenizados. Sigue por debajo: no hay TOTP, códigos de respaldo ni verificación de identidad,
y SMS y PSP productivos continúan bloqueados por proveedor y prueba física. Ninguna de esas
deudas se presenta como cerrada por haber modularizado la interfaz.

- [Uber: activar verificación en dos pasos](https://help.uber.com/riders/article/node-title?nodeId=b8bb9152-8c91-4f49-83c4-35cf2e1dcf72)
- [Uber: protección de cuenta y dispositivo](https://help.uber.com/riders/article/how-does-uber-protect-my-account?nodeId=03ec28e4-9049-4fe2-a60c-1a7d0334891e)
- [Uber: agregar o quitar lugares guardados](https://help.uber.com/riders/article/how-to-addremove-saved-places?nodeId=92f13cb2-bab2-4c88-a19e-9d52533496c3)

### Decisión 30 de agosto de 2026 — Envíos como límite transaccional propio

La documentación técnica vigente de Uber Direct separa el flujo en cotización y creación:
primero valida cobertura, costo y ETA; luego crea la entrega con el identificador de esa
cotización. Su modelo operativo continúa con despacho, tracking por estados y verificación de
entrega. La prueba de entrega puede combinar firma, foto, barcode, identidad y PIN según el
riesgo del artículo. El patrón relevante para ARC-001 es que cotización, confirmación y
verificación formen un dominio cohesivo, no que sean condicionales dentro de un home general.

Flash mueve ese límite a `CustomerShipmentScreen.tsx` sin cambiar el contrato real existente:
geocodifica retiro y destino, pide la cotización firmada al servidor, carga la ruta vial de
forma degradable, crea con el mismo `quoteToken` y conserva PIN, firma, cancelación y
seguimiento. La pantalla permanece montada al navegar y consume un único evento de dirección
desde Cuenta, por lo que el refactor no descarta trabajo ni vuelve a filtrar setters por el
coordinador.

La brecha no se oculta: Flash no está conectado a una red courier productiva ni demuestra aún
tráfico con SLA, barcodes, identidad regulada, política de retención, cobertura asegurada o
pruebas físicas de entrega. La extracción mejora mantenibilidad y testabilidad; no convierte
esas dependencias externas en capacidades verificadas.

- [Uber Direct: cotizar y crear una entrega](https://developer.uber.com/docs/deliveries/get-started)
- [Uber Direct: ciclo operativo de una entrega](https://developer.uber.com/docs/deliveries/direct/guides/overview)
- [Uber Direct: prueba de entrega](https://developer.uber.com/docs/deliveries/guides/proof-of-delivery)

### Decisión 30 de agosto de 2026 — tarifa cliente y navegación Driver son límites distintos

Uber y Lyft documentan que el pasajero decide con precio adelantado antes de solicitar. El
cálculo incorpora ruta, tiempo, tipo de vehículo, disponibilidad o demanda, tráfico, peajes y
cargos; ambos advierten que cambiar origen, destino o recorrido puede cambiar el importe. La
documentación de Uber Driver ubica las instrucciones giro a giro, carriles, tráfico y selección
del navegador dentro de la aplicación del conductor después de aceptar o iniciar un viaje.

Flash separa ahora esos límites en código. `CustomerRideScreen.tsx` conserva mapa de vista
previa, distancia, ETA, alternativas, desglose y `quoteToken`, pero invalida ruta, opciones y
precio si cambia el origen por texto, GPS o Cuenta. También deja de convertir el preview del
pasajero en una guía paso a paso. El cockpit Driver sigue siendo el único dueño de maniobras y
handoff a un navegador soportado.

La brecha competitiva sigue abierta: el desglose Flash es lógica de servidor probada en CI,
pero no usa todavía tráfico comercial con SLA ni una oferta de conductores productiva; el
navegador Driver no tiene evidencia de build físico en movimiento, voz, tráfico o cierres
viales propios. Por eso el refactor corrige integridad y segmentación sin promover Viajes a
`PROV`.

- [Uber: precio adelantado para pasajeros](https://www.uber.com/us/en/ride/how-it-works/upfront-pricing/)
- [Lyft: precio y cargos del viaje](https://help.lyft.com/hc/en-us/rider/articles/115012925707)
- [Uber Driver: navegación y etapas del viaje](https://www.uber.com/us/en/drive/driver-app/)
- [Uber Driver: funciones de navegación](https://help.uber.com/driving-and-delivering/article/uber-driver-app-navigation-features?nodeId=d6da8da9-cad5-402f-a722-86307b01a1fd)

### Decisión 30 de agosto de 2026 — Wallet web como límite financiero auditable

Mercado Pago documenta saldo, movimientos aprobados, ingresos, reintegros, contracargos y
disputas como eventos financieros conciliables. También diferencia el importe bruto del
impacto neto y aclara que una cuenta de prueba puede ejecutar el flujo de reportes sin poblar
datos reales. El patrón relevante para ARC-001 es que Wallet sea un límite financiero con
historial trazable, no una tarjeta decorativa mezclada con el home.

Flash mueve saldo, carga sandbox, movimientos y promociones a `WalletScreen.tsx`. Conserva
el ledger autenticado y sus topes actuales; la extracción no cambia el modelo de custodia ni
afirma que la recarga simulada sea dinero productivo. La puerta responsive impide volver a
enterrar ese límite en `CustomerSurface.tsx`.

Flash sigue por debajo de la referencia: la vista no separa todavía saldos disponible,
pendiente o retenido, ni ofrece filtros, exportación o una conciliación visible contra el PSP.
Esas capacidades requieren credenciales, operación productiva, revisión legal/regulatoria y
evidencia del proveedor; no se cierran desde código.

- [Mercado Pago: reporte de dinero en cuenta](https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/introduction)
- [Mercado Pago: tipos e impacto neto de las transacciones](https://www.mercadopago.com.ar/developers/en/docs/reports/account-money/how-to-use)

### Decisión 30 de agosto de 2026 — Cuenta web como límite reutilizable

Uber ubica Casa, Trabajo y otros lugares guardados dentro de Cuenta y permite etiquetar,
editar y eliminar destinos frecuentes. Uber Eats diferencia el filtro dietario del catálogo
de una solicitud de alergia asociada al producto, y advierte que una instrucción no garantiza
por sí misma que el comercio pueda cumplirla. El patrón útil es una Cuenta persistente que
reutiliza destinos y preferencias sin degradar una declaración de seguridad alimentaria a un
simple filtro visual.

Flash separa perfil, libreta y dieta en `CustomerProfileScreen.tsx`,
`CustomerAddressBook.tsx` y `CustomerDietaryPreferences.tsx`. Conserva geocoding, token de
validación, ownership y selección predeterminada; editar texto invalida coordenadas y token
hasta elegir otra coincidencia. Conserva también preferencias persistidas y la advertencia
explícita sobre contaminación cruzada. La prueba Chromium sólo lee la superficie: no modifica
el perfil de la cuenta de prueba.

Flash sigue por debajo porque no ofrece todavía solicitudes de alergia por ítem con aceptación
o rechazo del comercio, ni prueba física el circuito. La extracción mejora el límite técnico,
pero no transforma etiquetas declaradas por el comercio en garantía médica.

- [Uber: agregar o quitar lugares guardados](https://help.uber.com/riders/article/how-to-addremove-saved-places?nodeId=92f13cb2-bab2-4c88-a19e-9d52533496c3)
- [Uber Eats: instrucciones de alergias y filtros dietarios](https://help.uber.com/en/ubereats/restaurants/article/about-allergies?nodeId=8b473a3d-8341-4369-9287-7febe2fe0b7b)

### Decisión 30 de agosto de 2026 — Actividad y tracking web por vertical

DoorDash mantiene el pedido activo dentro de Pedidos y, cuando un Dasher aceptó,
muestra ETA, etapas, mapa relativo al comercio/destino y contacto. Uber Eats expone
`Track Order` desde la lista y conserva confirmación, preparación y entrega como
estados legibles. Para viajes, Uber comparte por enlace nombre, vehículo y ubicación
en tiempo real; en paquetería, DoorDash Drive expone URL de tracking y POD por foto o
firma. El patrón común no es una tarjeta decorativa: Actividad abre una superficie
operativa específica y los datos ausentes se declaran.

Flash separa `CustomerActivityScreen`, la tarjeta de estado y cada hoja de tracking.
Las tres cargan ruta autenticada y mapa sólo con coordenadas reales. Pedido conserva
estado y ETA; Viaje conserva PIN, enlace con vencimiento e incidente de seguridad;
Envío conserva PIN y evidencia cifrada. Un error al consultar POD queda visible sin
derribar la ruta. Chromium abre las tres hojas a 390 × 844 y, si falta el caso de
Envío, lo crea por la cotización y solicitud públicas reales con firma e idempotencia.

Flash sigue por debajo: no hay tráfico comercial con SLA, telefonía/mensajería
anonimizada, push probado en dispositivos, operación de safety 24/7 ni retención de
POD acordada con proveedor y marco legal. La prueba demuestra código y runtime local;
no demuestra red productiva, habilitación, seguros ni atención humana.

- [DoorDash: estados, ETA, mapa y contacto del pedido](https://help.doordash.com/en-us/consumers/article/customer-where-is-my-order)
- [Uber Eats: seguimiento desde la lista de pedidos](https://help.uber.com/ubereats/restaurants/article/node-title?nodeId=0341399a-092f-4012-b4c6-478b9906700d)
- [Uber: compartir ETA, conductor, vehículo y ubicación](https://help.uber.com/riders/article/sharing-eta-and-trip-status?nodeId=20e8c951-36ac-450a-90aa-738d467d023a)
- [DoorDash Drive: URL de tracking y prueba de entrega](https://developer.doordash.com/en-US/docs/drive/how_to/Parcel/webhooks_payload_fields/)

### Decisión 30 de agosto de 2026 — Envíos web como frontera cotizar → confirmar → crear

La guía vigente de Uber Direct recomienda cotizar antes de crear: la quote valida
entregabilidad y costo, devuelve tarifa, ETA e identidad con vencimiento, y esa identidad
se conserva al solicitar la entrega. DoorDash Drive modela el mismo límite como crear y
aceptar una quote antes de la delivery. Para ARC-001, la consecuencia es estructural:
Envíos debe poseer formulario, opciones, quote y consentimiento; el shell sólo conserva
el callback que integra el alta con el estado global.

Flash mueve esa frontera a `ShipmentHome.tsx`. Las categorías y niveles siguen viniendo
del backend, ambas direcciones se geocodifican, cualquier cambio invalida el precio, y la
creación exige el `quoteToken` vigente. El navegador sólo recorre el formulario en este
corte; la persistencia, ownership, riesgo, idempotencia y captura Wallet continúan
verificados contra PostgreSQL por las puertas existentes.

La similitud termina en el contrato: Flash no está conectado a la red Uber Direct ni
DoorDash Drive, no tiene sus credenciales/OAuth, cobertura, SLA o aprobación comercial y
no debe presentarse como homologado. La quote local es lógica Flash probada en CI, no una
cotización de proveedor productivo.

- [Uber Direct: crear quote y usar su identidad al crear delivery](https://developer.uber.com/docs/deliveries/get-started)
- [Uber Direct: secuencia operativa quote → confirmación → delivery](https://developer.uber.com/docs/deliveries/direct/guides/overview)
- [DoorDash Drive API: crear y aceptar quote](https://developer.doordash.com/en-US/api/drive/)

### Decisión 30 de agosto de 2026 — Carrito y pago web como una tarea verificable

La guía vigente de Uber Eats conserva una secuencia explícita: dirección, restaurante,
productos, carrito/finalización, revisión, confirmación y tracking. Mercado Pago separa
además la responsabilidad de seguridad: Card Payment Brick obtiene un token de tarjeta en
cliente y el backend debe validar el contexto de compra y enviar el pago con su credencial
privada. Esa frontera evita que el coordinador de Cliente sea dueño de la captura de pago o
que el navegador invente el importe final.

Flash mueve carrito y checkout a `FoodCartScreen.tsx`. La pantalla elige una dirección
geocodificada, consulta la configuración pública del proveedor, pide una quote firmada con
versión y vencimiento, y recién después habilita Wallet o el Card Payment Brick. El callback
devuelve token, método y cuotas al flujo de creación existente; no maneja PAN ni CVV. Propina
y horario siguen dentro de la selección confirmada, y cualquier cambio relevante obliga a
recotizar.

Esto demuestra el límite de código y el runtime local, no dinero productivo. Faltan
credenciales productivas, onboarding marketplace de comercios, webhooks y conciliación
externa, 3DS probado en dispositivos, gestión de contracargos, revisión PCI/legal y una
operación financiera aprobada. La carga Wallet continúa siendo sandbox y se presenta como
tal.

- [Uber Eats: secuencia oficial para realizar un pedido](https://help.uber.com/es/ubereats/restaurants/article/c%C3%B3mo-hacer-un-pedido-en-uber-eats?nodeId=509d1b2f-087c-4dac-9e94-6ab248e87491)
- [Mercado Pago: Card Payment Brick y alcance PCI del formulario](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/card-payment-brick/introduction)
- [Mercado Pago: envío server-side, validación y credencial privada](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/card-payment-brick/payment-submission)

### Decisión 30 de agosto de 2026 — Restaurante, modificadores y notas por producto

Uber Eats y DoorDash colocan la personalización dentro del producto: modificadores con
precio y una instrucción especial viajan con esa línea, antes del carrito. La documentación
vigente distingue además una nota común de una solicitud estructurada de alergia. Esa
separación importa porque el comercio puede rechazar una instrucción y una alergia requiere
selección, respuesta y trazabilidad más fuertes que un texto libre.

Flash separa el detalle de restaurante, los componentes compartidos de catálogo y la hoja de
producto. La hoja conserva extras tarifados, nota, cantidad y total; el restaurante filtra
productos sólo con las declaraciones dietarias persistidas y muestra una advertencia honesta.
El shell global abre el personalizador directamente, mientras el coordinador conserva sólo el
estado que cruza detalle, carrito y Actividad.

Flash todavía no implementa una solicitud de alergia por ítem con confirmación del comercio,
ventana de respuesta y cancelación. Tampoco prueba contaminación cruzada, exactitud nutricional
o sincronización de menú contra un proveedor externo. Una nota libre no se presenta como
garantía médica ni como aceptación del restaurante.

- [Uber Eats: instrucciones especiales por producto](https://help.uber.com/es/ubereats/restaurants/article/c%C3%B3mo-puedo-hacer-una-instrucci%C3%B3n-especial-para-un-pedido?nodeId=6cae92ca-edd0-49fc-aa50-5b46366626dd)
- [Uber Eats: filtros dietarios y solicitud de alergia diferenciada](https://help.uber.com/en/ubereats/restaurants/article/about-allergies?nodeId=8b473a3d-8341-4369-9287-7febe2fe0b7b)
- [DoorDash: instrucciones especiales y posibles cargos adicionales](https://help.doordash.com/en-us/consumers/article/can-i-specify-special-instructions-for-my-order)

### Decisión 30 de agosto de 2026 — Descubrimiento desde catálogo y señales honestas

Uber Eats permite buscar restaurante, cocina y plato, y presenta tiempo de preparación,
distancia, precio y rating como señales de decisión. Sus superficies también distinguen
filtros editoriales como Highest Rated y recomendaciones personalizadas. DoorDash documenta
que etiquetas dietarias, alérgenos y cocina deben ser confirmadas por el comercio y pueden
alimentar búsqueda, badges y carruseles.

Flash separa home/descubrimiento y conserva la búsqueda, categorías, restaurantes, productos
y favoritos conectados al estado autenticado. La portada dejó de usar una foto promocional
fija ajena al catálogo: elige el primer comercio abierto y usa su portada/imagen; si no hay
datos, no inventa una campaña. Flash Más también sigue leyendo nombre, precio y beneficios
del backend y se oculta ante una suscripción activa.

La comparación deja una brecha explícita: Flash no tiene todavía ranking offline/online
medido, personalización explicable, experimentación de relevancia, inventario con SLA ni
etiquetas confirmadas por el comercio. Tampoco existe un producto publicitario cuya
priorización y disclosure estén gobernados. Las secciones actuales son composición del
catálogo, no una afirmación de recomendación algorítmica validada.

- [Uber Eats: búsqueda por restaurante, cocina o plato y señales de decisión](https://help.uber.com/ubereats/restaurants/article/pick-up-order-faq?nodeId=a58f21e8-fc3e-42cb-adfd-92db5024faf5)
- [Uber Eats: filtro Highest Rated y recomendaciones personalizadas](https://help.uber.com/ubereats/restaurants/article/what-is-highest-rated?nodeId=aa4408c6-c7e5-4752-bb18-3f637b93270e)
- [DoorDash: etiquetas confirmadas que alimentan descubrimiento](https://help.doordash.com/en-us/merchants/article/how-to-manage-food-and-store-labels-in-merchant-portal)

### Decisión 30 de agosto de 2026 — Servicios separados, identidad y Actividad comunes

Uber permite usar las credenciales de Rides en Eats y expone Courier como una opción de la
misma experiencia; su documentación de Courier también describe un hub de actividad con los
viajes activos. La consecuencia útil no es copiar una barra concreta, sino mantener una
identidad y un historial comunes mientras cada servicio conserva su tarea especializada.

Flash mantiene Comida, Taxi y Envíos como superficies distintas y conserva Inicio,
Actividad, Wallet y Perfil como navegación estable. `public_rides` y `shipment_beta` siguen
viniendo de operaciones: ocultar una vertical es una decisión remota real, mientras una carga
fallida de flags no se convierte silenciosamente en un apagado. El coordinador sólo integra
estado y callbacks; la navegación es una frontera verificable.

Quedan brechas de producción: elegibilidad por país/zona/proveedor, explicación visible de
por qué un servicio no está disponible, medición de journeys entre verticales, deep links y
push verificados en builds físicos. La existencia de una pestaña local no demuestra oferta,
seguro ni habilitación comercial.

- [Uber Eats: una identidad existente de Rides también accede a Eats](https://help.uber.com/ubereats/restaurants/article/how-do-i-create-an-uber-eats-account?nodeId=13daba70-cc3d-4204-9981-1591d7942042)
- [Uber Courier: opción de paquetes y hub de actividad común](https://help.uber.com/en/riders/article/node-title?nodeId=8fa2306b-c14d-4f0b-9395-4c4523a81e85)

### Decisión 2 de septiembre de 2026 — sesión de Comidas mobile como máquina de estado propia

La guía vigente de Uber Eats conserva una secuencia explícita: descubrir, restaurante,
personalizar, carrito, revisión con precio autoritativo y confirmación. El patrón relevante
para ARC-001 no es otra pantalla, sino que esa máquina de estado no viva mezclada con
Viajes, Envíos, Actividad y Cuenta.

Flash mueve catálogo, favoritos, carrito persistido, quote firmada, propina, horario y
checkout de grupo a `useCustomerFood`. El coordinador sólo navega verticales y comparte
dirección/dieta con Cuenta. Sigue por debajo: sin POS, prep-time por ítem, evidencia
fotográfica de faltantes ni push físico. Ninguna de esas deudas se presenta como cerrada
por haber extraído el hook.

- [Uber Eats: recorre restaurantes, platos y checkout con precio final](https://help.uber.com/ubereats/restaurants/article/pick-up-order-faq?nodeId=a58f21e8-fc3e-42cb-adfd-92db5024faf5)
- [Uber Eats: seguimiento desde la lista de pedidos](https://help.uber.com/ubereats/restaurants/article/node-title?nodeId=0341399a-092f-4012-b4c6-478b9906700d)
