# Flash Delivery Mobility

Plataforma para operar comida, delivery y viajes tipo taxi/conductor en una sola base: cliente, comercio, conductor y operaciones.

## Estado de madurez

**Preproducción avanzada.** No es un MVP visual ni una maqueta, y tampoco es una plataforma pública madura.

La [auditoría integral del 25 de agosto de 2026](docs/auditoria-2026-08-25.md) evalúa el proyecto en **6,2/10** y lo declara apto para demo a inversores, desarrollo interno, staging serio y prueba cerrada de delivery una vez resueltos los P0. **No** está aprobado para lanzamiento público irrestricto, custodia de saldo real, pagos masivos sin supervisión, transporte público de pasajeros ni operación multiciudad.

De 91 capacidades inventariadas en [`docs/matriz-madurez.md`](docs/matriz-madurez.md), el **30%** de las que existen no está protegido por una puerta CI — eran el 81% el 25 de agosto — y **ninguna fue probada todavía contra un proveedor real**.

La Fase 0 está en marcha: ver el [plan de acción](docs/plan-de-accion.md) y el [backlog técnico](docs/backlog-tecnico.md).

### Bloqueadores P0

| Hallazgo | Ticket | Resumen |
| --- | --- | --- |
| H-01 | CI-001 | **En curso.** Cuatro workflows, 106 de 109 suites con puerta, 104 bloqueantes; `test:k6-local` listo (falta cablear nocturno con scope `workflow`); falta segundo revisor |
| H-02 | NOT-001 | **En curso.** Proveedor Expo implementado y con puerta CI; falta la entrega en un dispositivo físico |
| H-03 | SEC-001 | **Corregido.** Default-deny activo y con puerta CI; queda la verificación de runtime contra PostgreSQL |
| H-04 | DAT-001 | **En curso.** 109 tablas clasificadas y **69 de 69 `por-usuario` con política**; quedan `FORCE ROW LEVEL SECURITY` en cero y la cola larga de privilegios excedentes |
| H-05 | INF-001 | **Corregido.** Imagen multi-etapa, `uid=999(flash)` verificado en build real, mismo entrypoint que Compose |
| H-06 | DSP-001 | **En curso.** Recorte espacial y KNN activos; falta medir el plan y el ETA vial |
| H-07 | GEO-001 | **En curso.** Adapter con proveedor comercial y producción bloqueada para instancias públicas; falta una API key |
| H-08 | ARC-001 | **En curso.** Los dos `App.tsx` cumplen el techo de 1.500, `server/index.js` bajó a 33 KB y hay 32 grupos de rutas extraídos sobre 118 módulos de servidor; faltan los entrypoints separados por audiencia |
| H-09 | PAY-001 | Mercado Pago integrado pero nunca validado contra el proveedor |

Fuera de los P0, al 28 de agosto **GTM-001 y OPS-001 están cerrados**: los cuatro huecos comerciales medidos contra la competencia, y la operación sin SQL manual. El destino de despliegue quedó decidido en [`docs/despliegue.md`](docs/despliegue.md) y espera una cuenta de nube.
| H-11 | — | **Corregido.** Una base desde cero no equivalía a una migrada y las cuentas sembradas no podían iniciar sesión: `db:seed:derived` reaplica los backfills |

**Congelamiento activo:** hasta el 20 de septiembre de 2026 no se agregan capacidades nuevas. Ver [`docs/plan-de-accion.md`](docs/plan-de-accion.md).

---

Cada entrega se rige por [`AGENTS.md`](AGENTS.md) y [`docs/product-execution-guidelines.md`](docs/product-execution-guidelines.md): investigación competitiva verificable, backend autoritativo, cero capacidades productivas hardcodeadas, experiencia visual completa y checks honestos en el roadmap.

Los tres verticales comparten ahora chat operacional real por servicio: mensajes, confirmaciones y adjuntos persistidos en PostgreSQL, con contenido AES-256-GCM y acceso exclusivo para cliente, conductor asignado y comercio participante. Detalles y garantías en `docs/service-chat.md`.

Los envíos protegidos incluyen apertura y seguimiento de siniestros, cálculo de franquicia, evidencia JPEG/PNG/PDF cifrada y cola operativa auditable. La liquidación externa no se simula: queda en `settlement_pending` hasta integrar un proveedor habilitado. Ver `docs/shipment-protection-claims.md`.

Flash Admin incorpora conciliación persistente de intentos, capturas, reintegros y webhooks, con excepciones idempotentes y resolución auditada. Ver `docs/payment-reconciliation.md`.

Comidas, viajes y envíos pasan por scoring transaccional persistente antes del cobro; el riesgo crítico bloquea la operación y la cola administrativa conserva revisión explicable. Ver `docs/transaction-risk.md`.

Los retiros de comercios requieren revisión administrativa independiente; rechazar libera la reserva mediante ledger balanceado y aprobar sólo avanza a procesamiento. Ver `docs/payout-review.md`.

Las propinas tienen correcciones operativas reales con cuatro ojos: solicitud fundada, aprobación independiente, límite concurrente contra el importe original y transferencia balanceada conductor→cliente. Ver `docs/service-tips.md`.

Soporte distribuye casos por especialidad y capacidad, conserva el historial de responsables y escala incumplimientos SLA mediante un worker idempotente. Ver `docs/support-sla.md`.

En escritorio, cada rol recibe su superficie autorizada: Flash Operaciones para administración y Flash Negocios para comercios. Cliente y conductor/repartidor usan apps mobile/PWA separadas; Flash Negocios también dispone de variante mobile propia.

## Levantar la app

```bash
npm install
npm run dev
```

- Frontend: http://127.0.0.1:5173/
- Backend: http://127.0.0.1:4000/api/health
- Readiness: http://127.0.0.1:4000/api/ready
- Realtime: http://127.0.0.1:4000/api/events (requiere JWT en Authorization)
- PostgreSQL/PostGIS local: `127.0.0.1:55432/flash`

Produccion local con Docker:

```bash
docker compose up --build
```

Luego abrir http://127.0.0.1:4000/

El compose incluye PostgreSQL 17 + PostGIS, espera su healthcheck y ejecuta las
migraciones versionadas antes de iniciar la API. Para validar una instancia
configurada manualmente:

```bash
npm run db:migrate
npm run db:check
npm run db:seed:auth
npm run db:seed:commerce
npm run db:seed:orders
npm run db:seed:derived
```

`DATABASE_URL` y `DATABASE_SSL` se documentan en `.env.example`. El esquema
productivo vive en `database/migrations` e incluye identidad, catalogo
multivertical, jobs de delivery/viajes/compras, dispatch, ledger, outbox e
idempotencia. SQLite se conserva temporalmente como fallback del demo local
mientras se completa el cambio de repositorios del runtime.

La instancia nativa de desarrollo configurada en Windows se inicia y valida con:

```bash
npm run db:start
npm run db:migrate
npm run db:check
```

Los binarios y datos viven fuera del repositorio en
`%LOCALAPPDATA%\FlashDelivery`; `.env.local` contiene únicamente credenciales
locales y está ignorado por Git. La instalación reproducible y las limitaciones
actuales están en `docs/local-database.md`.

## Verificacion

```bash
npm run build
npm run test:security
npm run test:postgres
npm run test:rls
npm run test:sensitive-data
npm run test:mfa
npm run test:performance
npm run check
npm run db:backup
npm run db:backup:verify
npm run db:restore:drill
```

`test:security` levanta una API aislada en otro puerto y prueba JWT/RBAC/ownership.
`test:postgres` valida la API activa contra PostgreSQL: auth, catálogo, agregación
de estado, carrito e idempotencia de pedidos, viajes y envíos. Las tres verticales
capturan Flash Wallet dentro de la transacción de creación, rechazan fondos
insuficientes sin residuos y reintegran cancelaciones con ledger balanceado.
También prueba webhooks HMAC deduplicados, verifica que el PIN de entrega sólo
se persista como hash bcrypt y recorre soporte/notificaciones con aislamiento
entre usuarios, notas internas de operaciones y limpieza de datos temporales.
También cubre reservas de viaje persistentes, tarifa firmada con coordenadas,
recordatorios, ventana previa de dispatch y cancelación de ofertas. El contrato
operativo está en `docs/scheduled-rides.md`.
También valida redención promocional transaccional, administración RBAC de campañas
y zonas PostGIS cuyos multiplicadores afectan las cotizaciones reales. El smoke
calcula una huella del estado SQLite y falla si el runtime PostgreSQL intenta
escribir allí. Además consulta el diagnóstico de readiness al inicio y al final
para garantizar cero lecturas del fallback SQLite durante la suite integral;
también cubre favoritos, ratings y auditoría operacional.
`test:rls` conecta con un rol auditor sin ownership ni `BYPASSRLS`, comprueba
denegación sin contexto y aislamiento de usuarios, jobs, tickets y notificaciones.
También demuestra que una nota interna de soporte no es visible al cliente.
`test:mfa` verifica el enrolamiento TOTP administrativo, cifrado/hashing en reposo,
step-up de sesión, bloqueo del token previo y recuperación de un solo uso. El diseño
y las variables operativas se documentan en `docs/admin-mfa.md`.
La moderación de cuentas está documentada en `docs/account-moderation.md`: suspensión
transaccional, revocación de sesiones, desconexión de conductores, retiro de ofertas,
auditoría y reactivación segura desde el superadmin.
El ranking de dispatch incorpora historial real de aceptación y respuesta, conserva
el desglose que explica cada score y está documentado en `docs/dispatch-ranking.md`.
El checkout de comida usa direcciones propias geocodificadas, persiste el dropoff
PostGIS real y se documenta en `docs/food-delivery-geospatial.md`.

## Ver las apps mobile

La base nativa vive en `apps/mobile` y tiene tres superficies dentro de la misma app: Cliente, Comercio y Driver.

### Preview en navegador

Con el backend activo en el puerto `4000`, ejecutar:

```bash
npm --prefix apps/mobile run web -- --port 8081
```

Abrir http://127.0.0.1:8081/ y usar las pestanas de rol. Esta vista sirve para validar layout y flujos; los permisos GPS se validan mejor en un dispositivo o emulador.

### Android/iOS real

```bash
cd apps/mobile
npm install
set EXPO_PUBLIC_API_URL=http://IP_DE_TU_PC:4000/api
npm run start
```

Escanear el QR con Expo Go o ejecutar un dev build. El telefono y la PC deben estar en la misma red. En emulador Android usar `http://10.0.2.2:4000/api`; en simulador iOS, `http://127.0.0.1:4000/api`.

El rol Driver solicita permiso de ubicacion foreground y envia posicion al backend cuando esta online. Para produccion se debe completar tracking background, push y builds EAS.

## Configuracion

Copiar `.env.example` como referencia para ambientes reales. Variables principales:

- `NODE_ENV`: `development`, `test` o `production`.
- `HOST` y `PORT`: direccion y puerto del backend.
- `JWT_SECRET`: obligatorio y fuerte para produccion.
- `MFA_ENCRYPTION_KEY`: clave independiente obligatoria para cifrar secretos TOTP en producción.
- `CORS_ORIGIN`: allowlist separada por comas.
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`: limites de abuso.

El backend responde con `requestId`, aplica headers de seguridad, CORS controlado y rate limiting. En produccion no arranca con el secreto JWT demo.

## Cuentas bootstrap de desarrollo

- Cliente: `cliente@flash.app` / `demo123`
- Comercio: `comercio@flash.app` / `demo123`
- Conductor/repartidor: `conductor@flash.app` / `demo123`
- Operaciones: `ops@flash.app` / `demo123`

Estas cuentas se cargan sólo mediante `npm run db:seed:auth` para desarrollo.
La web ya no inicia sesión automáticamente: muestra login, persiste refresh
tokens rotatorios y recupera la sesión desde PostgreSQL. No ejecutar seeds ni
reutilizar estas contraseñas en un ambiente desplegado.

## Flujos funcionales

- Cliente: pedir comida, carrito, checkout, cancelar pedidos, cotizar taxi, pedir taxi, tracking y wallet.
- Comercio: abrir/pausar local, avanzar pedidos de cocina, administrar stock y crear platos.
- Conductor/repartidor: activar disponibilidad, cambiar modo delivery/taxi, aceptar pedidos/viajes y avanzar estados.
- Operaciones: metricas en vivo, mapa operativo, pedidos/viajes activos, tickets y reinicio de demo.
- Realtime: las superficies autenticadas reciben eventos SSE de pedidos, viajes, comercios y drivers, con reconexion automatica.
- Geolocalización: origen de taxi por GPS y tracking foreground/background del conductor con source, precisión, corte por frescura y permisos nativos explícitos.
- Notificaciones: registro/revocación automática de tokens inválidos, outbox PostgreSQL, dead-letter y replay administrativo auditable con `npm run worker:notifications`.
- Dispatch: ofertas privadas PostGIS, aceptación atómica, expiración y reasignación por oleadas con `npm run worker:dispatch`.
- Soporte: routing multiagente y escalamiento de SLA con `npm run worker:support`.
- App conductor: bandeja privada responsive con countdown, tarifa, ruta, distancia y acciones reales de aceptar/rechazar.
- Flota del conductor: registro PostgreSQL de hasta cinco vehículos, revisión independiente, activación única y elegibilidad real de dispatch por modo.
- Referidos: atribución PostgreSQL única, recompensa Wallet diferida hasta el primer servicio pagado, ledger balanceado e idempotencia real. Ver `docs/referrals.md`.
- Bootstrap por audiencia: web y mobile consumen `/api/bootstrap/customer|merchant|driver|operations`; el servidor valida que la sesión posea el rol solicitado. El antiguo `/api/state` fue retirado y responde `410 Gone`.
- Actividad paginada: `/api/me/activity` usa cursor opaco y participación SQL para no descargar el estado global. Ver `docs/audience-resources.md`.
- Perfil Driver aislado: `/api/driver/me` deriva el conductor desde la sesión; el bootstrap del conductor ya no expone ni descarga la flota global.
- Cocina aislada: `/api/merchant/me` devuelve exclusivamente los comercios del propietario autenticado; Negocios ya no descarga restaurantes desde el bootstrap.
- Operación de Negocios: `/api/merchant/dashboard` calcula en PostgreSQL cola, preparación, atrasos, stock y ventas del día local; los plazos históricos ausentes se exponen como no observados, nunca se estiman.
- Tracking con datos mínimos: `/api/me/assigned-drivers` entrega sólo la ficha pública de conductores vinculados a trabajos propios y excluye identidad interna, disponibilidad, modos y ganancias.
- Operaciones paginadas: `/api/operations/restaurants` y `/api/operations/drivers` sustituyen los agregados de comercios y flota del bootstrap administrativo, con búsqueda, cursor, RBAC/MFA y caché privada.
- Usuarios operativos: `/api/operations/users` pagina cuentas sin exponer hashes, UUID internos ni controles internos de bloqueo; el bootstrap administrativo ya no transporta usuarios.
- Soporte operativo: `/api/operations/support-tickets` pagina la mesa de ayuda por última actualización con mensajes, SLA, asignaciones y escalaciones, fuera del bootstrap global.
- Auditoría y configuración: `/api/operations/audit-events` pagina eventos con RBAC/MFA; zonas y promociones se componen desde recursos independientes cacheables.
- Contexto de cuenta: `/api/me` entrega wallet, direcciones, pagos tokenizados, ratings, favoritos, tips y soporte estrictamente propios; web/mobile ya no obtienen esos agregados del bootstrap.
- CI bloquea secretos conocidos y vulnerabilidades críticas de runtime. Ver `docs/ci-security-gates.md`.
- Finanzas de negocios: split contable al completar, saldo PostgreSQL, movimientos y retiros reservados idempotentes.
- Pricing de comida: cotización PostGIS por distancia/zona, plan versionado y bloqueo firmado de cinco minutos antes del cobro.
- Postventa de comida: incidencias persistidas, resolución operacional y reintegros parciales con reversión contable del split.
- Sustituciones: propuesta del comercio, consentimiento del cliente y devolución automática de diferencias antes de avanzar el pedido.
- Sucursales: ubicación PostGIS, apertura, ETA e inventario independiente utilizados realmente por cotización y checkout.
- Suscripción: *Flash Más* con beneficios en la fila del plan —cambiar la oferta es un `UPDATE`, no un despliegue—; el envío sin cargo se aplica antes de firmar la cotización y sale del margen de Flash, no del comercio ni del conductor. Todavía no cobra, y la app lo dice. Ver `docs/subscription.md`.
- Propina en el checkout: se cobra con el pedido en un solo cargo y queda retenida hasta que hay conductor; no entra en el reparto. Ver `docs/service-tips.md`.
- Servicios programados: pedidos de comida y viajes se reservan y **se reprograman** mientras nadie empezó; una reserva futura no cuenta como trabajo activo del comercio. Ver `docs/scheduled-rides.md`.
- Pedidos grupales: canasta por participante, tope de gasto verificado contra la base y un código que da entrada pero no lectura. Un grupo confirmado se vuelve un pedido normal. Ver `docs/group-orders.md`.
- Colas de trabajo: `/api/operations/work-queues` ordena las doce colas por antigüedad y separa las que vacía un worker de las que atiende una persona, porque el diagnóstico es distinto.
- Intervención operativa: suspender el ingreso de pedidos de un comercio y soltar un servicio que el conductor no retiró, las dos con motivo obligatorio y auditadas. Ver `docs/operations.md`.

El esquema real y sus migraciones se persisten en PostgreSQL/PostGIS. El runtime
principal usa PostgreSQL para identidad, catálogo, carrito, pedidos, movilidad,
wallet, pagos, soporte, promociones, zonas, auditoría y feedback. SQLite queda
limitado al fallback aislado de tests; `npm run test:postgres` verifica que el
recorrido runtime no lo modifica. Las rutas sensibles usan JWT, RBAC, RLS y
validación de propiedad por cliente, comercio y driver.

## Documentacion de producto

### Rectores — leer primero

- **Auditoría integral (25-08-2026):** `docs/auditoria-2026-08-25.md`
- **Plan de acción y fases:** `docs/plan-de-accion.md`
- **Backlog técnico P0/P1:** `docs/backlog-tecnico.md`
- **Matriz de madurez:** `docs/matriz-madurez.md`
- **Lineamientos de ejecución:** `AGENTS.md`

### Referencia

- Roadmap ejecutivo: `ROADMAP.MD`
- Matriz completa Figma/API/dominio: `docs/figma-screen-matrix.md`
- Apps nativas base: `apps/mobile/README.md`
- Investigacion competitiva: `docs/investigacion-competitiva.md`
- Investor readiness: `docs/investor-readiness.md`
- Arquitectura: `docs/arquitectura-producto.md`
- Infraestructura escalable: `docs/infraestructura-escalable.md`
- Realtime: `docs/realtime.md`
- Roadmap: `docs/roadmap.md`
- Progreso: `docs/progreso.md`
- Dónde se despliega y por qué: `docs/despliegue.md`
- Checklist de despliegue: `docs/deployment-checklist.md`
- Base local PostgreSQL/PostGIS: `docs/local-database.md`
- Operación, métricas y backups: `docs/operations.md`
- Libreta PostgreSQL/PostGIS de cliente: `docs/address-book.md`
- Destinos privados y recientes de viajes: `docs/ride-destination-history.md`
- Contactos de confianza cifrados: `docs/ride-trusted-contacts.md`
- Seguimiento mobile de viajes: `docs/ride-live-tracking.md`
- PIN seguro de retiro de pasajeros: `docs/ride-pickup-verification.md`
- Suscripción Flash Más: `docs/subscription.md`
- Pedidos grupales: `docs/group-orders.md`
- Cotización versionada de comida: `docs/food-pricing.md`
- Incidencias y reintegros parciales: `docs/order-issues.md`
- Sustituciones de productos: `docs/order-substitutions.md`
- Sucursales e inventario localizado: `docs/merchant-branches.md`
