# Flash Delivery App Roadmap

## Roadmap rector adoptado — 21 de agosto de 2026

Fuente de producto: `C:\Users\santiago\Desktop\FlashAPP.txt`. Se adopta su estrategia **delivery/courier primero, B2B después y movilidad pública sólo tras safety y habilitación local**. La auditoría describe una versión anterior; sus EPICs se mantienen, pero estos checks reflejan el runtime actual y sustituyen sus puntuaciones históricas.

Leyenda: `[x]` verificado localmente, `[~]` operativo con deuda concreta, `[ ]` pendiente o dependiente de proveedor/operación externa.

### Estado ejecutivo de bloqueadores

- [x] **P0-01 / SEC-001 — aislamiento.** Ownership, serializers por rol, RLS físico y tests cross-tenant funcionan. Web, mobile y suites migraron a bootstrap y recursos segmentados; `/api/state` responde permanentemente `410 Gone`.
- [x] **P0-02 / DAT-001 — PostgreSQL/PostGIS.** Runtime principal, migraciones, índices, transacciones por operación, auditoría append-only, backup y restore drill operativos; SQLite está aislado como fallback de tests.
- [~] **P0-03 / IAM-001 — identidad.** Access/refresh rotativo, refresh web en cookie HttpOnly con defensa de origen, respuestas autenticadas `no-store`, sesiones remotas, recuperación, email OTP, MFA admin y suspensión funcionan. Teléfono E.164 tiene OTP y adaptador Twilio; payouts exigen step-up WYSIWYS de un solo uso ligado a comercio/importe. Falta ejecutar las migraciones/pruebas PostgreSQL tras reiniciar Docker y prueba física SMS.
- [~] **P0-04 / PAY-001 — dinero.** Payment intents, Wallet sandbox, ledger, reservas, conciliación y riesgo existen. Mercado Pago suma OAuth seller con PKCE S256, tokens cifrados y rotación automática, Card Payment Brick web oficial cargado bajo demanda, readiness por comercio, tokenización sin PAN/CVV, creación idempotente con `application_fee`, saga sin despacho hasta `approved`, conciliación estricta por webhook, captura balanceada y refund real previo a cancelar con reserva contra carreras. El split del seller queda fuera del saldo retirable interno para no duplicar fondos. Falta Core Methods nativo mobile, scheduler/alertas productivas del worker OAuth, alta comercial/credenciales, conciliar tasas del reporte del PSP, ejecutar migraciones hasta `105` y prueba sandbox/visual física.
- [x] **P0-05 / IDEM-001 — concurrencia.** Idempotencia, constraints, locks, ofertas privadas, TTL, aceptación atómica, dedupe y prune acotado/concurrente de claves vencidas cubiertos.
- [x] **P0-05b / API-001 — contratos de escritura.** Las mutaciones con cuerpo exigen JSON, rechazan media types ambiguos con `415` y validan payloads tipados antes de escribir.
- [~] **P0-06 / GEO-001 — mapas.** Geocoding, PostGIS, zonas, OSRM, polylines, caché, quotes firmados, circuit breaker, stale controlado, presupuesto y métricas funcionan. Faltan tráfico/Route Matrix productivo y cuota distribuida.
- [~] **P0-07 / RT-001/MOB-001 — ubicación y push.** Background nativo, stale-location gate, outbox, worker, reintentos y dead-letter operativos. Faltan FCM/APNs, builds firmados y ensayo físico.
- [~] **P0-08 — safety/regulación.** KYC, vehículos, PIN, trusted contacts, share trip, SOS y soporte prioritario funcionan. Viajes públicos siguen bloqueados hasta seguros, habilitación, anomalías y procedimientos reales.

### Secuencia de ejecución vigente

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
- [~] Bundle web con React e iconos en chunks cacheables y presupuesto CI: entry propio reducido de 718 KiB a 327 KiB; falta extraer Customer, Negocios y Operaciones del `App.tsx` monolítico y medir Core Web Vitals con tráfico real.
- [x] Entrega web productiva con gzip dinámico, assets versionados inmutables por un año, HTML revalidable y SSE excluido de compresión para evitar buffering; contrato HTTP bloqueante en CI.
- [x] CSP activa por defecto: scripts same-origin, sin `unsafe-eval`, objetos/iframes bloqueados y allowlist explícita para API, mapas, imágenes, workers y estilos necesarios; contrato bloqueante sobre el HTML real.
- [x] Viajes exige cotización JWT vigente en PostgreSQL igual que comida/envíos; desktop consume opciones firmadas, invalida tarifa al cambiar ruta/categoría y bloquea confirmación sin recotizar. El endpoint legacy también firma su respuesta.
- [x] PostgreSQL/PostGIS, 91 migraciones, idempotencia, locks, auth, MFA, outbox, métricas, backup y restore.
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
- [~] Payout/conciliación interna; falta adaptador bancario/PSP.
- [~] Feature flags, analytics first-party y go/no-go de zona basado en supply/comercios/volumen/cancelaciones/soporte listos; faltan instrumentar todas las pantallas y prep-time predictivo.

#### Fase 4 — piloto de movilidad

- [x] KYC, vehículos, PIN, contactos, compartir recorrido, SOS y chat cifrado.
- [ ] Seguros/habilitación local, anomalías, privacidad telefónica, no-show/waiting fees, accidentes y aseguradora.

#### Fases 5/6 — B2B y multiciudad

- [~] Referidos y jobs programados existen; faltan Flash Business, centros de costo, POS, logística híbrida, multi-stop y suscripción.
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
- [~] Comidas: discovery, detalle personalizable, carrito persistente, checkout visual y actividad funcionales; faltan restricciones alimentarias estructuradas y paridad visual fina de confirmación.
- [~] Comidas: total firmado, pago Wallet, promociones, OTP de email, soporte y comprobante de servicio funcionales; faltan factura fiscal, PSP externo y completar tracking visual.
- [~] Viajes: mapa, ruta, modalidades, precio, solicitud, asignacion y guia funcionales.
- [~] Viajes: matching, estados, rating, reservas, propina y comprobante funcionan; falta seguridad dedicada.
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
- [~] Comidas: onboarding real, favoritos persistentes, cupones y checkout con Wallet funcionan; falta tracking dedicado en mapa.
- [ ] Viajes: replicar el flujo completo del Figma Lyft (destino, mapa, selector, confirmacion, matching y viaje activo).
- [ ] Envios: adaptar el mismo sistema visual con paquete, destinatario, cotizacion, PIN y tracking ya operativos.
- [ ] Actividad, wallet, perfil, soporte y notificaciones como navegacion compartida.
- [ ] Paridad de estados vacios, errores, carga, offline y accesibilidad en todos los flujos.

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
- Crear pitch demo mode con datos de crecimiento historico.
