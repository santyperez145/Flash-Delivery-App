# Inventario rector de superficies y estados

Fecha de verificación: 22 de agosto de 2026.

Este inventario es el contrato de producto para evitar una app plana o una colección de homes. Cada fila representa una pantalla, hoja, modal o estado que necesita composición visual propia. Los datos, acciones y permisos deben provenir del backend; una pantalla no se considera terminada por existir solamente en Figma.

Estados: `[x]` funcional; `[~]` funcional con paridad visual/operativa pendiente; `[ ]` pendiente o bloqueado por proveedor/habilitación.

## Principios derivados de competidores

- [Uber Driver](https://www.uber.com/us/en/drive/driver-app/) separa Home, Earnings, Inbox y Menu. Home prioriza mapa, disponibilidad, demanda, preferencias, seguridad y ofertas; la documentación muestra pickup, espera, inicio y cierre como estados distintos del viaje.
- [Uber Driver: ganancias](https://www.uber.com/us/en/drive/how-much-drivers-make/) separa resumen de sesión, semana, detalle por servicio y liquidación. Flash no presentará retiros ni gráficos inventados mientras el ledger del conductor no exponga esos contratos.
- [Lyft: pago adelantado](https://help.lyft.com/hc/en-us/driver/articles/8668928544-Upfront-pay) confirma que una oferta debe explicar pago total, pickup y recorrido antes de aceptar.
- [Lyft: navegación del conductor](https://help.lyft.com/hc/en-us/all/articles/115012926147) trata pickup, espera, cambios de destino y viaje como un flujo del conductor, no del cliente.
- [DoorDash: navegación dentro de la app](https://help.doordash.com/dashers/s/article/In-app-Navigation) mantiene mapa, instrucciones de retiro/entrega y contacto en una sola superficie y permite elegir un navegador externo.
- [DoorDash: rediseño Dasher](https://dasher.doordash.com/en-us/blog/new-doordash-dasher-app) prioriza claridad, botones grandes, mapa, ganancias vigentes, Inbox y preferencias, retirando controles secundarios del home.

Flash adopta jerarquía y estados comparables, no texto, activos, colores ni identidad propietaria. Safety, tráfico, voz, llamadas anonimizadas, seguros, impuestos y pagos externos sólo se habilitan con proveedor y operación verificables.

## Cliente — shell compartido

| Estado | Superficie | Estado Flash |
|---|---|---|
| Arranque | Splash, actualización obligatoria, mantenimiento, offline | [~] splash/offline; faltan actualización y mantenimiento remotos |
| Identidad | bienvenida, login, registro, OTP, recuperar/restablecer contraseña | [~] contratos reales; falta deep link universal físico |
| Permisos | ubicación, notificaciones, cámara sólo al necesitarla | [~] ubicación/cámara reales; push físico pendiente |
| Navegación | Comidas/Viajes/Envíos + Inicio/Buscar/Actividad/Cuenta | [x] |
| Cuenta | perfil, direcciones, pagos tokenizados, wallet, notificaciones, favoritos, seguridad, sesiones, soporte, legal | [~] funcional; falta dividir la vista monolítica |
| Estados transversales | loading, vacío, error, offline, reintento, contenido largo, accesibilidad | [~] base; requiere auditoría visual sistemática |

## Cliente — Comidas

| Momento | Pantallas/hojas necesarias | Estado Flash |
|---|---|---|
| Descubrimiento | home, ubicación, categorías, promos, carruseles, favoritos, búsqueda, recientes, filtros | [~] funcional; paridad visual fina pendiente |
| Comercio | listado, detalle, horarios, ETA, costos, menú por sección, sin stock/cerrado | [x] |
| Producto | foto, descripción, dieta/alérgenos, modificadores, nota, cantidad | [x] |
| Compra | carrito persistente, promoción, dirección, pago, cotización, desglose, confirmación | [x] |
| Ejecución | confirmado, preparando, sustitución, courier asignado, tracking, entrega | [x] |
| Posterior | comprobante, propina, rating, incidencia/refund, pedir otra vez | [~] fiscalidad externa pendiente |

## Cliente — Viajes

| Momento | Pantallas/hojas necesarias | Estado Flash |
|---|---|---|
| Planificación | mapa/origen, corregir pickup, buscar destino, guardados/recientes, programación | [~] falta edición de pin y zonas de pickup operativas |
| Decisión | ruta previa, modalidades, capacidad, pickup ETA, precio/desglose, método de pago | [x] |
| Matching | confirmación, buscando, sin conductores, tarifa vencida, cancelación | [x] base; falta acabado visual por estado |
| Pickup | conductor/vehículo, llegada, contacto, PIN, espera/no-show | [~] PIN y llegada listos; waiting/no-show bloqueado |
| En viaje | mapa/ETA/progreso para cliente, compartir, contactos, soporte/SOS | [~] no debe mostrar maniobras de conducción; emergencias externas pendientes |
| Cierre | llegada, recibo, propina, rating, objeto perdido/incidencia | [~] base funcional; objeto perdido pendiente |

## Cliente — Envíos

| Momento | Pantallas/hojas necesarias | Estado Flash |
|---|---|---|
| Cotización | origen/destino, destinatario, tamaño/peso/contenido, SLA, protección, restricciones | [x] |
| Confirmación | precio firmado, términos, pago, resumen y creación | [x] |
| Ejecución | asignación, retiro, tránsito, tracking, chat, PIN | [x] |
| Entrega | foto/firma contratada, recepción, comprobante | [x] |
| Posterior | devolución, reclamo, evidencia, resolución | [~] liquidación regulada pendiente |

## Flash Driver — segmentación obligatoria

### Home / mapa

- [~] estado Offline/Online dominante y GPS/background explícito.
- [x] mapa de demanda/zonas con trabajos y oferta elegible agregados por PostGIS; reemplaza el mapa libre por ruta al aceptar y nunca inventa hotspots, forecast o surge.
- [x] selector de vertical compatible con vehículo aprobado.
- [x] ofertas exclusivas con expiración, pago, pickup, destino, distancia y duración.
- [ ] Trip Radar/múltiples ofertas sólo cuando dispatch soporte matching no exclusivo.
- [~] trabajo activo con mapa, próxima etapa, contacto y acción primaria contextual.

### Navegación y trabajo activo

- [x] ruta desde GPS vigente al próximo pickup/destino y maniobras OSRM.
- [x] cockpit dedicado del conductor: instrucción dominante, ETA/distancia, mapa, destino, chat y apertura de Google/Apple Maps.
- [ ] voz, tráfico, cierres, velocidad y reportes viales: proveedor/SLA/prueba física obligatorios.
- [~] Viajes: pickup, llegada, espera, PIN, inicio, destino y cierre; falta no-show/waiting fee regulado.
- [x] Comida: ir al comercio, retiro, ir al cliente, entrega y chat.
- [x] Envío: retiro, tránsito, foto, firma/PIN y cierre.

### Ganancias

- [x] día, semana, detalle por servicio, propinas, ajustes, saldo Wallet y movimientos provienen del ledger dedicado, sin proyectar datos ausentes.
- [x] tiempo conectado y activo diario/semanal desde sesiones PostgreSQL, con procedencia y solapamientos unidos; no implica pago horario.
- [~] liquidación externa permanece bloqueada por proveedor, KYC/habilitación y prueba productiva.
- [ ] objetivos/promociones sólo con campañas reales, elegibilidad y términos.

### Inbox

- [~] Inbox Driver segmenta chats activos y notificaciones privadas persistentes; falta clasificación específica de incidentes/documentos en backend.

### Cuenta / operación

- [x] legajo, documentos, vencimientos, revisión y rechazo.
- [x] flota, compatibilidad, aprobación y vehículo activo.
- [~] proveedor de navegación externa ya es una preferencia persistida y funcional; accesibilidad, privacidad, seguridad y ayuda todavía requieren subsecciones propias.
- [ ] CarPlay/Android Auto no se declara hasta tener build, entitlement y prueba vehicular.

## Comercio desktop

| Segmento | Superficies | Estado Flash |
|---|---|---|
| Hoy | estado abierto/pausado, cola, SLA de preparación, atrasos, ventas del día e incidencias | [~] backend PostgreSQL local-time listo; falta conectar y verificar desktop/mobile |
| Pedidos | nuevos, aceptados, preparación, listos, sustituciones, detalle | [x] |
| Catálogo | categorías, productos, modificadores, dieta/alérgenos, stock por sucursal | [x] |
| Operación | sucursales, horarios, excepciones, zonas, capacidad/ETA | [x] |
| Clientes | incidencias y soporte ligado al pedido | [~] |
| Finanzas | ventas, comisiones, conciliación, payouts, documentos | [~] PSP/fiscalidad productivos pendientes |
| Cuenta | equipo/permisos, integraciones, seguridad, auditoría | [~] |

## Operaciones / administración

- [x] usuarios, comercios, conductores, KYC, vehículos, soporte, auditoría y configuración.
- [~] despacho vivo, fraude/riesgo, pagos/conciliación, reclamos y salud de proveedores.
- [ ] playbooks de incidentes, seguros, habilitación, fiscalidad, paging y staging administrado.

## Regla de cierre visual

Una superficie sólo pasa a `[x]` visual cuando fue probada en ancho angosto y amplio, con loading/vacío/error/offline, texto largo, teclado, safe areas, contraste, tamaño táctil y datos reales. Para mapas se agregan permisos denegados, coordenadas ausentes/stale, ruta caída y proveedor sin credenciales.
