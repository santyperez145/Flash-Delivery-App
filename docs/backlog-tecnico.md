# Backlog técnico

Tickets derivados de [`docs/auditoria-2026-08-25.md`](auditoria-2026-08-25.md) y ordenados por [`docs/plan-de-accion.md`](plan-de-accion.md).

Cada ticket tiene: hallazgo de origen, trabajo concreto, criterios de aceptación verificables y cómo comprobarlos. **Un criterio que no se puede comprobar no es un criterio.**

Prioridades: **P0** bloquea la beta de delivery · **P1** bloquea el piloto o la operación · **P2** mejora sin bloquear.

---

## ARC-001 — Modularización

**Prioridad:** P0 · **Hallazgo:** [H-08](auditoria-2026-08-25.md#h-08--concentración-monolítica-extrema) · **Fase:** 0

### Contexto

Cinco archivos concentran más de 1,3 MB de código: `apps/mobile/App.tsx` (433 KB), `src/App.tsx` (360 KB), `server/index.js` (338 KB), `src/styles.css` (119 KB) y `server/commerce-repository.js` (67 KB). Además el código está comprimido en líneas de hasta 4.061 caracteres, lo que hace ilegible cualquier diff e imposible cualquier revisión de seguridad.

### Trabajo

1. **Reformatear primero.** Antes de mover nada, aplicar un formateador con ancho máximo de línea a todo el código fuente. Es un commit mecánico, separado y sin cambios de comportamiento, que hace revisables todos los commits siguientes.
2. Extraer features de los dos `App.tsx` hacia módulos por dominio. **Parcial**: mobile quedó en 321 líneas y web en 1.274 al mover el acceso real a `auth/WebLogin.tsx` (170 líneas), los estados transversales a `ui/SystemStateScreen.tsx` y convertir Customer, Merchant, Operaciones y Superadmin en límites de carga por audiencia. El entry web bajó de 575,7 a 67,7 KiB. La extracción interna del cliente movió Actividad —grupos, sustituciones, servicios activos, recibos, repetición, reclamos y propinas— a `CustomerActivityScreen.tsx` (586 líneas) sin alterar sus operaciones reales. Las tres hojas de seguimiento viven ahora en `CustomerTrackingSheets.tsx`, su marco en `MobileTaskSheet`, los timelines en `CustomerTrackingProgress.tsx` y la carga vial en `useTrackingRoute.tsx`. La prueba Chromium encontró y cerró un desacople real: Actividad listaba recursos paginados, pero tracking los buscaba sólo en el bootstrap. Comidas, Viajes y Envíos resuelven ahora el elemento seleccionado desde la misma colección paginada y las cards tienen semántica de botón. La ruta de Envíos ya no depende de que cargue la evidencia de entrega. Cuenta —seguridad, sesiones, referidos, preferencias, notificaciones, soporte, direcciones y pagos— vive en `CustomerAccountScreen.tsx`; permanece montada para conservar formularios y sólo devuelve un evento de dirección al coordinador. Envíos vive en `CustomerShipmentScreen.tsx` con cotización, mapa, opciones, protección, firma y creación persistida, conserva el formulario entre pestañas y consume el evento tipado de dirección. Viajes vive en `CustomerRideScreen.tsx` con GPS, destinos, ruta, tarifa adelantada, reserva, contactos y solicitud persistida; invalida precio al cambiar origen y reserva las maniobras para Driver. Comidas quedó segmentada en descubrimiento/búsqueda (505 líneas), restaurante/personalización (443), carrito (326), checkout (237) y pedidos (134). Incidencias de pedido, devoluciones y siniestros quedaron además en un estado discriminado y `CustomerServiceIssueModals.tsx` (340 líneas). `CustomerScreen.tsx` bajó de 6.241 a 1.321 líneas; `test:responsive-layout` fija un techo de 1.350 y verifica el cableado de las tres APIs sin perder el carrito compartido con Actividad ni las preferencias/dirección compartidas con Cuenta. En web, Wallet salió de `CustomerSurface.tsx` a `WalletScreen.tsx`; el coordinador bajó de 3.794 a 3.720 líneas y la misma puerta fija un techo de 3.725, sin alterar los límites ni presentar la carga sandbox como dinero productivo. La matriz Chromium abre además la PWA cliente en 390 × 844 y verifica actividad, overflow y ambos límites sin cargar saldo.

   **Cierre de la segmentación interna web:** Cuenta salió a `CustomerProfileScreen.tsx`; la segunda partición dejó perfil/composición en 124 líneas, libreta geocodificada en 308 y dieta en 160, con techos 130/315/165. Actividad salió después a `CustomerActivityScreen.tsx` (189), la tarjeta común a `CustomerStatusCard.tsx` (67) y los trackings a módulos propios para pedido (179), viaje (333) y envío (282). Envíos completo vive en `ShipmentHome.tsx` (567), conservando opciones, geocoding, quote firmada y creación. Carrito y checkout viven en `FoodCartScreen.tsx` (680), y `QuantityCounter.tsx` (28) y `EmptyState.tsx` (19) son primitivas con límite propio. Restaurante (85), componentes de catálogo (145) y personalizador (101) tienen fronteras separadas; el personalizador se carga directamente desde `App.tsx`. Home/descubrimiento vive en `FoodDiscoveryHome.tsx` (119) y usa la imagen del catálogo en lugar de una promoción fija. Navegación/flags viven en `CustomerNavigation.tsx` (85). `CustomerSurface.tsx` quedó como coordinador en 360 líneas con techo 375. La matriz Chromium abre Cuenta sin escribir, los tres trackings, cotizador, home, restaurante, personalizador y carrito a 390 × 844; provisiona el envío activo faltante por APIs reales, no por SQL ni mocks. Los contratos fuente exigen geocoding, alta/edición, dieta, catálogo, favoritos, modificadores, nota, flags, ruta, PIN, safety, enlace compartible, evidencia, quotes, pago tokenizado y creación en sus dueños concretos. ARC-001 continúa por el paquete compartido y las líneas largas heredadas; este cierre es sólo del cliente web. La consola de comercio es shell: horarios/modificadores/dieta en `MerchantCatalogEditors.tsx`; cocina, detalle, catálogo, sucursales, analítica, pulso y finanzas en módulos propios.

3. ~~Crear entrypoints separados customer, driver y merchant en mobile~~ **Hecho**: `metro.config.js` resuelve `./variant-screen` según `EXPO_PUBLIC_APP_VARIANT`, y `test:mobile-variant-bundles` lo verifica empaquetando las tres con `expo export`.
4. ~~Descomponer `server/index.js`~~ **Hecho**: 57 grupos de rutas en routers bajo `server/http/` (incl. `platform-status`, `readiness`, `bootstrap`, `metrics`). El archivo quedó en **~350 líneas**: sólo arranque, middleware y montaje — **cero** `app.get/post` de API.
5. ~~Dividir `commerce-repository.js` por subdominio~~ **Hecho**: `catalog-repository.js`, `order-repository.js` (~1168, cotizar/crear/cobrar/avanzar), `cart-repository.js` + `order-selection.js` (carrito y agregados) y `driver-roster-repository.js`. `usesPostgresCommerce` vive en `postgres.js`. Pedidos/carrito importan `mapCatalogItem` de catálogo —nunca al revés.
6. Crear contratos compartidos en un paquete propio. **Avance:** `@flash/domain-contracts` concentra **47** tipos (`RideSummary`/`ShipmentSummary`/`RideService` y variantes de envío sumados a `DriverVehicle`/dashboard/menú/`Order`/`User`). Web: `Ride`/`Shipment` extienden el núcleo; mobile añade cancelación. `test:domain-contracts` bloquea el merge. Extras del comercio siguen locales.
7. Limitar cada archivo a una responsabilidad concreta. **Avance:** backoffice modularizado (`AdminConsole` shell; paneles de dinero y soporte partidos); Driver: `useDriverShift` + paneles (`DriverScreen` cockpit); comercio web: `MerchantConsole` shell con cocina, detalle/sustituciones, catálogo, sucursales, analítica, pulso y liquidaciones en módulos propios; Merchant App: `MerchantScreen` shell con Hoy, Pedidos, Catálogo, Cuenta y detalle. Phone-stage web: `MerchantApp`, `DriverApp`, `OpsApp` y `OpsRail` en módulos y chunks propios. Cuenta mobile: `CustomerAccountScreen` shell con seguridad, referidos, dieta, inbox, soporte, libreta y pagos. Cliente mobile: sesión de Comidas en `useCustomerFood`. Cliente web: sesión de comercio en `useCustomerCommerce`; `src/App.tsx` queda como shell de sesión, auth y enrutado. Cliente HTTP web: transporte en `src/api/http.ts`; mapa partido en cuenta/comercio/movilidad/operaciones; `src/api.ts` sólo compone y arma el bootstrap. Cliente HTTP mobile: el mismo corte —transporte en `apps/mobile/src/api/http.ts`, mapa partido, barrel que sólo compone. **Estilos (sep-2026):** `src/styles.css` bajó a 5.636 con tres hojas nuevas cableadas vía `readWebStyles()`; mobile extrajo `styles/merchant.ts` (472 claves) y dejó `styles.ts` como compositor con re-export intacto; ratchet de archivos >1.500: **21.868 → 19.739** líneas.

### Criterios de aceptación

- [x] **Reformateo mecánico aplicado.** Línea máxima 4.061 → 206; líneas largas 1.543 → 262.
- [x] Los contratos que leen código fuente dejaron de depender del formato.
- [x] Una puerta de formato impide que el código vuelva a derivar.
- [x] **Los contratos que leen código fuente dejaron de depender de dónde vive.** Un contrato con un archivo hardcodeado pierde cobertura en silencio cuando la extracción mueve el código: `test:realtime-audience` pasó de 43 a 37 publicaciones y siguió en verde, y `test:web-tracking-maps` contaba 4 de 5 usos del mapa desde que `RideHome` se extrajo. Las suites de servidor y las nueve del frente leen ahora el árbol de su audiencia, con piso explícito.
- [x] **Una aserción no puede pasar sobre una región vacía.** `section` lanza si el marcador falta o si la región colapsa; `containsNone` se niega a responder por debajo de un piso. Sin eso, partir los dos `App.tsx` apagaba nueve contratos en silencio.
- [x] **La autorización es un módulo propio, puro y con contrato.** `server/http/authorization.js`, 10 reglas, 81 usos, `test:authorization` en `ci-fast.yml`.
- [x] **El núcleo compartido de HTTP está extraído.** Respuestas, autorización, autenticación, transporte realtime y runtime del fallback. Un grupo de rutas nuevo no necesita nada de `server/index.js`.
- [x] **Ningún `App.tsx` supera 1.500 líneas.** `apps/mobile/App.tsx` 15.374 → **321**; `src/App.tsx` 10.553 → shell de sesión/auth/enrutado, con la sesión de comercio en `useCustomerCommerce`. `test:responsive-layout` fija el techo web en 720.
- [x] **Ninguna capacidad queda construida y sin cablear.** `test:api-wiring` cruza las 191 rutas del servidor contra los literales de ruta del frente web y móvil. Encontró 16 huérfanas; **quedan cero**, trinquetadas en cero. Dos eran duplicados y se borraron —`GET /api/restaurants` devolvía la tabla entera de comercios sin autenticación ni paginación, esquivando el tope que `test:catalog-pagination` verifica sobre la ruta buena—. Diez se cablearon: el embudo de producto, los flags por audiencia y el go/no-go de zona en la sección **Producto**; las promociones y los multiplicadores de zona en **Tarifas**, con confirmación explícita porque las dos mueven dinero; el registro y la baja de dispositivos en el móvil, que era el eslabón que cortaba la cadena entera de push; y `GET /api/features`, que cierra el control de release: las pestañas de Envíos y Taxi se gobiernan con `shipment_beta` y `public_rides`, verificadas en las dos direcciones. Cablearlo destapó que `public_rides` estaba en `false` mientras la app mostraba Taxi igual —el flag no lo leía nadie—; el dueño confirmó que la movilidad opera y la migración 124 lo enciende, dejando el apagado como decisión de operaciones desde el panel en lugar de un despliegue. El último lote cerró dos colas que se podían mirar y no tocar: las devoluciones de envío se listaban desde el móvil y **nadie podía resolverlas**, y los documentos de conductor se aprobaban o rechazaban **sin poder abrirlos**. El cierre destapó un falso positivo de la propia puerta: `/api/payment-provider/client-configuration` figuraba huérfana y el checkout **ya la llamaba**, con un literal que lleva una plantilla dentro de su interpolación. Casi termino cableando algo cableado. La detección ahora quita las interpolaciones antes de buscar, y se verificó que sigue detectando una ruta nueva sin consumidor. El sentido contrario ya está limpio y la puerta lo vigila: ningún literal del frente apunta a una ruta que no exista.
- [x] **Ninguna línea de más de 200 caracteres.** Techo **251 → 0**; `test:line-length` fija el techo en cero.
- [x] **Ningún archivo fuente supera 1.500 líneas.** Ratchet de tamaño en cero (estilos, openapi, store, postgres smoke partidos).
- [x] **Ningún módulo de dominio importa React.** 93 módulos verificados por `test:domain-purity`, en `ci-fast.yml`. La regla es la convención del repositorio: `.ts` es lógica, `.tsx` es presentación. `react-native` no cuenta, porque ahí aporta primitivas de plataforma y no renderizado.
- [x] **El build de driver no incluye pantallas de comercio.** `metro.config.js` resuelve `./variant-screen` según `EXPO_PUBLIC_APP_VARIANT`, así que las otras dos pantallas quedan sin arista que las alcance. Verificado sobre bytecode Hermes real: `test:mobile-variant-bundles` empaqueta las tres variantes y comprueba la diagonal.
- [x] **El build de customer no incluye backoffice.** Mismo mecanismo y misma puerta. Los tres bundles bajaron de llevar las 9.715 líneas de las tres pantallas a llevar una: 2,3 MB customer, 2,4 MB driver, 2,1 MB merchant.
- [x] **`server/index.js` deja de contener lógica de dominio.** 57 de 57 grupos de rutas extraídos a routers en `server/http/`. `index.js` bajó de 9.696 a **~350 líneas** (−96%): arranque, middleware y montaje. Salud, readiness, OpenAPI, bootstrap, métricas, el 410 de `/api/state` y el reset SQLite viven en routers de infraestructura.
- [x] **Ninguna ruta responde 500 sobre el respaldo SQLite.** `test:fallback-degradation` sondea 54 rutas × 4 audiencias en el job `local-fallback`. Encontró 17 rotas —incluido todo el flujo de conductor y la cola administrativa— por llamar a repositorios de PostgreSQL sin guarda. Apareció levantando la app en un navegador: ninguna puerta estática podía verlo, porque el código es estáticamente correcto.

### Verificación

```bash
find src apps/mobile/src server -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) -exec awk 'length($0)>200 {print FILENAME": "FNR" ("length($0)" chars)"}' {} \;
```

Debe devolver vacío. Añadir este control como puerta en `ci-fast.yml`.

### Orden de extracción

El criterio no fue el tamaño del grupo, sino **cuánto núcleo compartido necesita**. Un grupo de rutas dependía de siete cosas que vivían en `server/index.js`; las siete son módulos y **un grupo nuevo ya no necesita nada de ahí**.

| Dependencia                                       | Estado                   | Quién la necesita                |
| ------------------------------------------------- | ------------------------ | -------------------------------- |
| `ok` / `fail` / `parseOrFail`                     | `http/responses.js`      | casi todo handler                |
| autorización (10 predicados + `requireAnyRole`)   | `http/authorization.js`  | 81 usos                          |
| `requireAuth`                                     | `http/authentication.js` | todo grupo autenticado           |
| `publishRealtimeEvent` + registro SSE             | `http/realtime.js`       | 43 publicaciones                 |
| `audit` del fallback SQLite                       | `fallback-runtime.js`    | toda mutación                    |
| `readDb` (contabiliza lecturas SQLite)            | `fallback-runtime.js`    | todo el doble runtime            |
| esquemas Zod (≈20)                                | en `index.js`            | por dominio, viajan con su grupo |
| `auditRuntime` (auditoría sobre los dos runtimes) | `audit-trail.js`         | toda mutación auditada           |

Extraer un grupo antes que su núcleo funciona —lo demuestra `addresses-router.js`— pero deja una lista de dependencias larga en la factory. **La factory era andamio**: existe para recibir lo que todavía no es un módulo, y se cae sola cuando ya no queda nada que recibir. Esa misma factory pasó de cuatro dependencias a cero en dos pasos, sin que se tocara una sola de sus cinco rutas. Los tres routers se importan y se montan.

El registro de clientes SSE era el caso difícil, porque es **estado vivo**: un `Map` no se pasa por parámetro sin arrastrarlo entre archivos. Se resolvió haciéndolo estado del módulo `http/realtime.js`, con la ruta `/api/events` adentro, que es la única que lo escribe.

El orden entre autenticación y autorización no era intercambiable. La autenticación **no puede ser pura** —consulta el usuario y, si es administrador, su estado de MFA—; los permisos sí, pero sólo si alguien resolvió `mfa` antes. Sacar los permisos primero era la única forma de que quedaran verificables sin levantar un runtime.

---

## CI-001 — Pipeline productivo

**Prioridad:** P0 · **Hallazgo:** [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas) · **Fase:** 0

### Contexto

104 scripts declarados, 15 en CI. CI no levanta PostgreSQL/PostGIS, por lo que ninguna suite que necesite base de datos puede correr. 89 suites, incluidas todas las de pagos, RLS, ledger, KYC y safety, están fuera de la puerta de merge.

### Trabajo

Sustituir `ci.yml` por cuatro workflows:

**`ci-fast.yml`** — cada PR: typecheck · lint · unit tests · static security · secret scan · build · bundle budget · control de longitud de línea (ARC-001).

**`ci-postgres.yml`** — cada PR, con servicio PostgreSQL 17 + PostGIS:

```yaml
services:
  postgres:
    image: postgis/postgis:17-3.5
    env:
      POSTGRES_PASSWORD: ci
      POSTGRES_DB: flash
    ports: ["5432:5432"]
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 5s --health-timeout 3s --health-retries 20
```

Ejecuta: migraciones desde cero · migraciones desde snapshot de la versión anterior · `test:rls` · `test:audit-immutability` · `test:postgres` · `test:city-isolation` · `test:idempotency-prune` · `test:sensitive-data`.

**`ci-critical-flows.yml`** — cada PR: `test:mercadopago-payment` · `test:mercadopago-webhook` · `test:marketplace-ledger` · `test:payment-reconciliation` · `test:payment-oauth` · `test:payout-review` · `test:transaction-risk` · `test:driver-kyc` · `test:driver-vehicles` · `test:ride-safety` · `test:support-sla` · `test:support-routing` · `test:mfa`.

**`ci-nightly.yml`** — cada noche: Playwright E2E · `test:performance` · carga k6 · provider sandbox · restore drill · dependency scan completo · mobile build preview.

Adoptar además un framework estándar de pruebas: **Vitest**, **Testcontainers**, **Supertest**, **Playwright**, **k6**, cobertura y mutation testing selectivo sobre pricing, ledger y máquinas de estado.

**Avance del 29-08:** Vitest 4.1 ya ejecuta el contrato unitario de autorización y
`@testcontainers/postgresql` 12.1 crea un PostGIS 17 efímero, replica los tres roles sin
`BYPASSRLS`, aplica las **137 migraciones** desde cero y comprueba extensión y privilegios. La
prueba aislada corre como segunda mitad de `test:runtime-role-shape` dentro del job bloqueante de
`ci-postgres`; no reemplaza el servicio de CI,
sino que elimina la dependencia de su preparación manual y deja un punto de partida estándar
para migrar suites gradualmente.

**Avance del 2-09-2026:** Supertest monta el Express real (`FLASH_HTTP_LISTEN=0`, sin abrir
puerto) en `tests/integration/http-supertest.test.js`, encadenado en `test:authorization`
(ci-fast): health, OpenAPI, readiness, 401, 404, planes públicos y login vacío. Vitest quedó
**pinneado a 3.2.4**: 4.1.x falla en Node 24 al registrar suites (`runner.config`
indefinido). **`test:k6-local`** (`load/k6-health.js`) está listo; cablearlo a
`ci-nightly.yml` es **bloqueo del dueño** (token GitHub con scope `workflow`). Cobertura
de líneas, mutation testing, sandbox de proveedores y builds EAS siguen abiertos.

### Criterios de aceptación

- [x] Un PR queda bloqueado si falla cualquier suite crítica — **106 de 109 suites con puerta, 104 bloqueantes**, 2 nocturnas y cuarentena vacía (`test:k6-local` exceptuado hasta cablear workflow).
- [x] Ningún script de riesgo queda fuera de una puerta sin justificación escrita — lo verifica `npm run test:ci-coverage`.
- [x] **Cerrar las suites en cuarentena.** Las cuatro salieron. `test:postgres`, `test:dietary-local` y `test:notification-local` se cerraron el 26-08 —las dos últimas estaban apuntadas al runtime equivocado, no eran frágiles—. `test:support-routing` salió el 27-08 y su causa anotada resultó falsa: figuraba como «ruteo atómico de un caso de safety a un agente con skill», pero `POST /api/support/tickets` exige una cabecera `Idempotency-Key` y responde 400 sin ella, y la suite no la mandaba en ninguno de sus seis POST. **Nunca llegó a ejercitar el ruteo.** Con la cabecera puesta pasan sus diez afirmaciones sin tocar una línea de producto. Ya es bloqueante y el paso de cuarentena se quitó del workflow.
- [ ] `ci-nightly.yml`. **Existe desde el 27-08** con la auditoría responsive en Chromium —una corrida por variante—, la latencia de endpoints y la conciliación de pagos programada. **`test:k6-local` está escrito** (`load/k6-health.js`); falta que el dueño lo agregue al YAML nocturno (scope `workflow`). Faltan sandbox de proveedores y builds EAS (credenciales). El restore drill dejó de faltar por otra vía: `scripts/restore-drill.ps1` sigue siendo PowerShell y sigue siendo el ensayo que importa sobre los backups reales, pero `test:restore-drill` corre en cada PR un ensayo distinto —volcar, restaurar y verificar invariantes sobre la copia— que cubre lo que el local no puede cubrir por PR: que el esquema, las políticas y los permisos sobrevivan al viaje por `pg_dump`.
- [x] **La rama `main` está protegida y exige PR** desde el 27-08: los 7 checks son obligatorios, la rama debe estar al día, la historia es lineal y no hay excepción para administradores.
- [ ] Pagos y seguridad exigen dos aprobaciones (`CODEOWNERS` ya existe; falta más de un revisor).
- [x] **Los artefactos de test se almacenan y son consultables tras el run.** `ci-critical-flows` guarda la salida de **cada suite en su propio archivo** —treinta y una suites en un solo paso son un muro donde el error que importa queda lejos del final— más el log completo de la API, y `ci-fast` sube el del respaldo SQLite. Se suben **pase o falle** la corrida: guardarlos sólo ante un fallo impide la comparación que más sirve, la de una verde contra una roja. Retención de 14 días. No amplía quién ve qué: un artefacto lo descarga quien ya puede leer el log, que hoy publica un `tail` del mismo archivo; lo que cambia es que deja de estar truncado.

### Verificación

```bash
node -e "const p=require('./package.json'),fs=require('fs');const ci=fs.readdirSync('.github/workflows').map(f=>fs.readFileSync('.github/workflows/'+f,'utf8')).join('');const out=Object.keys(p.scripts).filter(s=>s.startsWith('test:')&&!ci.includes('npm run '+s));console.log(out.length?'FUERA DE CI:\n'+out.join('\n'):'OK: toda suite de test está en CI')"
```

---

## SEC-001 — Realtime default-deny

**Prioridad:** P0 · **Hallazgo:** [H-03](auditoria-2026-08-25.md#h-03--realtime-hace-broadcast-a-todos-los-roles-ante-entidad-desconocida) · **Fase:** 0

### Contexto

`server/realtime-repository.js:8` y `:16` devuelven `allRoles` (admin + customer + merchant + driver) cuando el evento no tiene entidad o cuando el `entityType` no está contemplado. Es un patrón _fail-open_: cada tipo de entidad nuevo entra por defecto en el camino inseguro.

### Trabajo

1. Eliminar el fallback `allRoles` de ambos caminos.
2. Entidad conocida → participantes + `admin`.
3. Entidad desconocida → `admin` únicamente, más una métrica de evento sin clasificar.
4. Evento sin entidad → audiencia explícita obligatoria en la firma de la función; sin audiencia declarada, la escritura falla.
5. Registrar y exponer una métrica de eventos descartados por falta de audiencia.

### Criterios de aceptación

- [x] Un evento mal clasificado no llega a ningún cliente, comercio ni conductor.
- [x] Sólo `admin` recibe eventos operativos sin audiencia resoluble.
- [x] Existe cobertura de test para **todos** los `entityType` en uso.
- [x] Existe un test que agrega un `entityType` inventado y verifica que no hay broadcast.
- [x] **Verificación de runtime de `resolveAudience` contra PostgreSQL con fixtures multiusuario.** `test:realtime-audience-runtime` publica eventos reales sobre datos sembrados y después le pregunta al **replay** qué recibiría cada usuario, que es la consulta que decide la entrega. Cubre la mitad que el contrato estático no puede tocar: los resolutores de propiedad son JOINs contra tablas reales, y uno mal escrito devuelve al usuario equivocado sin que ninguna comprobación estática se entere. Cada caso tiene sus dos mitades —el dueño recibe, un tercero no— y se ejercitan además los tres caminos que deben cerrarse: `entityType` inventado, evento sin entidad, e identificador mal formado en `address`.
- [x] **La métrica de eventos sin clasificar es visible en un dashboard.** El panel vive en la consola móvil de operaciones, junto al tablero de riesgo. No se dibujó encima de la métrica Prometheus que ya existía: ese contador es en memoria, por réplica y se borra al reiniciar, así que un panel montado sobre él habría mostrado un número que se reinicia solo. La migración 120 guarda el desenlace con el evento y `GET /api/admin/realtime-audience` lo agrega sobre una ventana, de modo que el panel **nombra** los eventos sin clasificar en lugar de contarlos. En reposo es una línea discreta; con hallazgos se pone en el color de acento y ocupa lugar, porque un panel que se ve igual con cero que con veinte enseña a no mirarlo. Cobertura: `test:realtime-audience-runtime` para la agregación y `test:realtime-audience-api` para la ruta —401 sin sesión, 403 para un cliente, ventana acotada—.

---

## DAT-001 — Matriz RLS default-deny

**Prioridad:** P0 · **Hallazgo:** [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security) · **Fase:** 0

### Contexto

106 tablas, 86 con RLS, 20 sin política y cero `FORCE ROW LEVEL SECURITY`. El rol `flash_runtime` tiene `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`. Donde no hay política, la única barrera es el código de aplicación.

### Trabajo

1. Publicar `docs/matriz-rls.md` con las 106 tablas y su clasificación: `por-usuario` · `global-lectura` · `servicio-append-only` · `interna`.
2. Aplicar política RLS a toda tabla `por-usuario`. Prioridad: `user_roles`, `user_security_factors`, `ledger_entries`, `ledger_transactions`, `ledger_accounts`, `notification_deliveries`, `realtime_events`, `shipment_details`, `webhook_events`, `idempotency_keys`.
3. Aplicar `FORCE ROW LEVEL SECURITY` donde el propietario también deba quedar sujeto a la política.
4. Restringir los grants: sustituir `GRANT ... ON ALL TABLES` por grants explícitos por tabla y operación.
5. Escribir pruebas negativas por rol: cada tabla con datos por usuario debe demostrar denegación desde un rol auditor sin contexto.
6. Definir política formal de retención y separación de datos sensibles frente a operativos.
7. Añadir a la definición de terminado: **una migración que crea una tabla debe incluir su política RLS y su prueba negativa, o declarar por escrito por qué la tabla es global.**
8. Añadir a la definición de terminado: **una migración que haga backfill sobre datos existentes debe agregar su derivación idempotente a `scripts/db-seed-derived.mjs`.** Sin eso, una base creada desde cero deja de ser equivalente a una migrada — ver [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada).

### Criterios de aceptación

- [x] Toda tabla nueva entra en la matriz en el mismo PR que la crea — lo verifica `npm run test:rls-matrix`.
- [x] CI falla si aparece una tabla sin clasificar, si la matriz se desalinea de las migraciones, o si una tabla `por-usuario` queda sin política fuera de la deuda declarada.
- [x] Las 106 tablas están clasificadas: 65 `por-usuario` (60 con política), 24 `global-lectura`, 15 `servicio`, 2 `sin-uso`.
- [x] **Las cinco tablas de la deuda tienen política y prueba negativa.** Cerraron el 27-08. Al 28-08 la matriz tiene 109 tablas y `test:rls-matrix` reporta **69 de 69**. Se repitió un patrón que conviene registrar: en tres de las cinco —`drivers`, `merchants`, `user_roles`— el motivo anotado para no aplicarlas era más restrictivo que el esquema real. Bloqueaban por consultas sin contexto de usuario, y eso sólo bloquea si la política alcanzara al runtime, que queda exento como en las otras 67 tablas.
- [x] **Esquema muerto eliminado.** `112_drop_dead_schema.sql` borró `outbox_events` y `user_security_factors`; la matriz pasó de 106 tablas a 104. La segunda tenía forma de almacén de credenciales —TOTP y WebAuthn— sin política RLS y alcanzable por el rol de runtime a través del `GRANT ... ON ALL TABLES`. Borrarla es la única manera de cerrar su deuda: una tabla sin uso no se puede probar.
- [x] **`FORCE ROW LEVEL SECURITY` donde corresponda — la respuesta es «en ninguna tabla», y ahora es una decisión con pruebas.** Sin `FORCE` las políticas no rigen para el dueño; el dueño es `flash_app`, el rol migrador, que corre migraciones y backfills sobre filas de todos los usuarios. Aplicarlo rompería ese trabajo: no es una casilla pendiente por descuido. El riesgo que cubriría —que `DATABASE_URL` apunte al migrador— ya está cerrado por `server/rls-guard.js`, que impide arrancar en producción con un rol que puede saltear RLS. **Lo que faltaba era probar aquello sobre lo que descansa la decisión.** La matriz afirmaba que «`flash_runtime` no es dueño y es `NOBYPASSRLS`», y ninguna puerta lo miraba: `test:rls` se conecta como el rol auditor y como el migrador. `test:runtime-role-shape` lo verifica ahora —atributos del rol, que no sea dueño de ninguna tabla, que no sea miembro del migrador— y además **intenta el `SET ROLE` que rompería todo** y exige que la base lo rechace. Una decisión de no hacer algo se sostiene sobre las propiedades que la justifican; sin verificarlas envejece hasta volverse una suposición.
- [x] Los grants dejan de ser `ON ALL TABLES`. La migración 116 revocó la escritura sobre las 8 tablas de referencia donde el runtime nunca escribe y retiró la herencia automática, que era lo que hacía nacer con DML a toda tabla nueva. `test:grant-scope` impide reintroducir cualquiera de las dos formas. Desde el 27-08 el trabajo dejó de ser una estimación: `test:runtime-write-scope` cruza permisos, writes del código, upserts, candados y writes de rebote por trigger. Midió **114 permisos de más en 86 tablas** —pares tabla/operación— y las migraciones 122, 123, 131, 132, 133 y 134 los redujeron por lotes verificables. La 135 conserva cada operación observada y retira las 35 restantes en catálogo, carrito, preferencias, sesiones de conductor y configuración. El resultado es **cero permisos DML sin uso**, con contrato nominal para las últimas 35 operaciones y trinquete en cero.

### Verificación

```bash
grep -rhoiE "CREATE TABLE (IF NOT EXISTS )?[a-zA-Z_]+" database/migrations/ | sed -E 's/CREATE TABLE //I; s/IF NOT EXISTS //I' | tr 'A-Z' 'a-z' | sort -u > /tmp/tables.txt
grep -rhoiE "ALTER TABLE [a-zA-Z_]+ ENABLE ROW LEVEL SECURITY" database/migrations/ | awk '{print tolower($3)}' | sort -u > /tmp/rls.txt
comm -23 /tmp/tables.txt /tmp/rls.txt
```

Toda tabla en la salida debe estar clasificada como global o de servicio en `docs/matriz-rls.md`.

---

## INF-001 — Imagen productiva endurecida

**Prioridad:** P0 · **Hallazgo:** [H-05](auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root) · **Fase:** 0

### Contexto

Dockerfile de una etapa, con devDependencies, copiando todo el repositorio, corriendo como root y arrancando `server/index.js` en lugar del entrypoint instrumentado `server/start.js` que sí usa Compose.

### Trabajo

Dockerfile objetivo:

```dockerfile
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system flash \
 && useradd --system --gid flash --home-dir /app flash
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/database ./database
COPY --from=build /app/scripts ./scripts
USER flash
EXPOSE 4000
CMD ["node", "server/start.js"]
```

En infraestructura: filesystem raíz de sólo lectura · capabilities eliminadas · `/tmp` temporal · secrets montados · sin puertos públicos para Redis/PostgreSQL · scan de imagen · SBOM · firma de imagen · deploy inmutable.

Ampliar `scripts/container-security-smoke.mjs`, que hoy valida principalmente roles de PostgreSQL, para cubrir usuario Linux, capabilities, seccomp y filesystem de sólo lectura.

### Criterios de aceptación

- [x] `docker run` sin Compose arranca `server/start.js` con toda su instrumentación.
- [x] El contenedor corre como usuario no root — verificado: `uid=999(flash)`.
- [x] La imagen productiva no contiene devDependencies ni el árbol de fuentes.
- [x] El smoke de contenedor valida usuario, entrypoint, etapas y capabilities.
- [x] **Filesystem raíz de sólo lectura.** `read_only: true` en Compose y **una corrida real en CI**: el job `container-image` arranca la imagen con `--read-only` hasta que responde, y después comprueba que un `touch` sobre la raíz falle —sin eso, el paso pasaría aunque la raíz fuera escribible—. Lo escribible queda declarado: `/tmp` y `/app/server/data` (este último sólo para el caso de prueba que arranca el respaldo SQLite sin `DATABASE_URL`). **`server/store.js` abre SQLite de forma perezosa** (2-09-2026): importar `createId` u otros exports puros ya no crea `server/data`; con PostgreSQL el runtime productivo no necesita tocar ese volumen.
- [x] **Dependencias de frontend fuera de la imagen productiva, sin perderlas de la puerta de auditoría.** En ese orden: primero `test:dependency-gate` pasó a auditar cuatro alcances —raíz y móvil, producción y desarrollo— y recién después se movieron los siete paquetes que sólo usa el frente. `test:production-deps` exige que cada dependencia de producción esté importada por `server/` o `scripts/`; hoy son 20 y las 20 lo cumplen. **La imagen bajó de 381 a 303 MiB**, medido por el job `container-image` antes y después.
- [x] **Existe SBOM y scan de imagen en el pipeline.** El job `container-image` genera un SBOM CycloneDX que publica como artefacto, y escanea con Trivy por imagen fijada —no por una acción del marketplace, que sería código de terceros con el token del workflow—. **Bloquea lo que este equipo puede arreglar**, que no es lo mismo que lo que tiene parche publicado: la puerta falló en su primera corrida con cuatro CVEs altas del npm que trae la imagen base, arreglables upstream pero no acá sin cambiar de base. El scan que corta se salta ese `node_modules` y mira lo que agregamos nosotros; lo heredado se informa sin cortar. Que siga pudiendo fallar tras estrecharle el alcance se verificó con `jsonwebtoken@8.5.1`. `npm audit` reportaba cero mientras Trivy encontraba cuatro: ninguna de las dos sola responde qué se despliega.

### Verificación

```bash
docker build -t flash:audit . && docker run --rm flash:audit id
```

No debe reportar `uid=0(root)`.

---

## DOC-001 — La documentación no puede mentir sobre el runtime

**Prioridad:** P1 · **Hallazgo:** [H-10](auditoria-2026-08-25.md#h-10--documentación-desalineada-del-runtime) · **Fase:** 0

### Contexto

H-10 era el **único de los once hallazgos sin ticket**: aparecía sólo en el documento de auditoría y nadie lo había tomado. Su ejemplo principal —un recuento de migraciones en prosa— derivó dos veces: decía 105, se corrigió a 110, y el 27 de agosto había 122.

No es prolijidad. Es la falla que explica a las demás. Durante la semana del 25 al 27 de agosto aparecieron, todas de la misma forma: la causa anotada de una suite en cuarentena que resultó falsa y mandó a buscar un defecto de concurrencia que no existía; notas de deuda RLS más restrictivas que el esquema real; un criterio de aceptación cumplido y sin marcar; la matriz de madurez declarando «ledger de doble entrada» respaldada por una prueba que verifica la aritmética del split; y una afirmación de que nada obligaba a cuadrar el ledger cuando un trigger lo hacía desde la migración 003.

**Una nota escrita con cautela se lee después como un hecho**, y las decisiones se toman sobre ella.

### Trabajo

1. Automatizar la parte mecánica: una cifra que el repositorio puede calcular no debería poder mentir.
2. Distinguir afirmación vigente de registro histórico. Una cifra vale si coincide con la realidad **o** si su línea declara cuándo fue cierta.
3. Corregir la deriva existente.
4. Ampliar los hechos verificados sólo cuando el repositorio pueda calcularlos sin adivinar.

### Criterios de aceptación

- [x] **Existe una puerta que verifica las cifras calculables.** `test:docs-drift` recorre `docs/`, `ROADMAP.MD`, `README.md` y `AGENTS.md`, y compara contra el repositorio el recuento de migraciones y el total de suites. Encontró **16 cifras obsoletas en 9 archivos** en su primera corrida.
- [x] **La puerta distingue historia de afirmación.** Una cifra fechada —«al 25-08», «el 25 de agosto»— se acepta aunque no coincida. Sin esta mitad, la puerta obligaría a reescribir el registro para que diga lo de hoy, que lo volvería falso. Se verificó con las dos: una cifra errónea sin fecha corta y nombra archivo y línea; la misma con fecha pasa.
- [x] **La deriva existente está corregida.** Seis afirmaciones vigentes se actualizaron; diez registros históricos recibieron la fecha que les faltaba. El documento de auditoría queda excluido entero: es un registro fechado por construcción.
- [x] **Las afirmaciones no numéricas empiezan a verificarse.** `test:docs-drift` rechaza frases que el runtime ya desmiente (H-04 «Abierto», read_only «pendiente», «migrar a Postgres», «push imposible por configuración»). Se amplían de a una cuando el repositorio puede demostrar la falsedad sin adivinar.
- [x] **`docs/investor-readiness.md` y `docs/deployment-checklist.md` se revisaron contra el runtime** el 2-09-2026: H-04/INF-001 ya no figuran abiertos; push/mapas se nombran como bloqueo externo; Postgres ya no aparece como migración pendiente.

---

## NOT-001 — Push real

**Prioridad:** P0 · **Hallazgo:** [H-02](auditoria-2026-08-25.md#h-02--push-productivo-es-imposible-por-configuración) · **Fase:** 0

### Contexto

`NOTIFICATION_PROVIDER` sólo admite `disabled` y `sandbox`; producción prohíbe `sandbox`. No existe proveedor de push productivo, y el esquema de configuración lo impide por construcción. El outbox, los reintentos y el dead-letter ya están bien construidos: falta el destino.

### Trabajo

1. Extender el enum a `disabled | sandbox | expo`, y más adelante `fcm` y `apns`.
2. Implementar el proveedor Expo: Batch API · push tickets · consulta de receipts · invalidación por `DeviceNotRegistered` · retry con backoff · rate limits · circuit breaker · métricas por plantilla · fallback in-app.
3. Tratar la entrega como **asíncrona y monitoreada**, nunca como garantizada: el servicio de Expo no ofrece SLA.
4. Más adelante: FCM directo para Android, APNs directo para iOS y un proveedor alternativo de contingencia.

### Criterios de aceptación

- [x] Producción puede arrancar con un proveedor de push activo (`NOTIFICATION_PROVIDER=expo`).
- [x] Un token inválido queda revocado automáticamente (`DeviceNotRegistered` en ticket y en recibo).
- [x] Un receipt no recibido dentro de la ventana genera alerta (`FlashPushReceiptsStale`).
- [x] Un ticket aceptado nunca se reporta como entregado.
- [ ] Push real recibido en un dispositivo Android físico. **Depende de un teléfono y de credenciales de EAS**, no de código: desde el 28 de agosto el móvil pide permiso, obtiene el token de Expo y registra el dispositivo en `POST /api/devices` al iniciar sesión, y lo da de baja al salir. Hasta ese día `expo-notifications` **no era ni siquiera una dependencia**, así que el servidor podía enviar notificaciones que ningún dispositivo podía recibir: la cadena estaba cortada en el eslabón que no se ve, porque no fallaba nada, simplemente no llegaba nada.
- [ ] Push real recibido en un dispositivo iOS físico. Mismo bloqueo: teléfono y credenciales.
- [ ] El dedupe está probado con envíos duplicados contra el proveedor real.

### Evidencia requerida

Captura o registro del dispositivo físico adjunto al PR. **Sin evidencia física, el ticket no se cierra.**

---

## GEO-001 — Proveedor de mapas comercial

**Prioridad:** P0 · **Hallazgo:** [H-07](auditoria-2026-08-25.md#h-07--proveedores-de-mapas-públicos-por-defecto) · **Fase:** 0

### Contexto

Los valores por defecto apuntan a Nominatim, OSRM y tiles públicos de OpenStreetMap. La política de Nominatim prohíbe autocomplete de cliente contra la instancia pública y advierte a aplicaciones comerciales que no dependan de ella. Sin routing vial, la tarifa se calcula sobre distancia geodésica.

### Trabajo

Crear un adapter que aísle al proveedor:

```text
MapsProvider
  autocomplete()
  geocode()
  reverseGeocode()
  computeRoute()
  computeRouteMatrix()
  snapToRoad()
```

Elegir para beta entre Google Places + Routes, Mapbox Search + Directions o HERE Geocoding + Routing.

Requisitos operativos: API keys restringidas · una clave móvil por plataforma · una clave de servidor · restricción por bundle ID y package name · cuotas · alertas de costo · field masks · caché · circuit breaker · métricas de fallback · almacenar `place_id` en lugar de direcciones ambiguas como texto simple.

Ya existen caché, circuit breaker y presupuesto: se conservan y se conectan al adapter.

### Criterios de aceptación

- [x] Cambiar de proveedor no requiere tocar código de dominio — ambos devuelven las mismas claves normalizadas.
- [x] Producción rechaza el arranque con instancias públicas de la comunidad.
- [x] `computeRouteMatrix()` existe, con field mask y límite facturable.
- [x] El checkout de comida sólo acepta una dirección con procedencia firmada por el backend. La migración 136 conserva proveedor, `place_id`, tipo y fecha; el token dura 15 minutos, está ligado al usuario y sus valores sustituyen cualquier texto o coordenada enviados por el cliente. Producción exige proveedor comercial y `place_id`. `test:maps` y `test:postgres` cubren reutilización entre usuarios, manipulación y dirección legacy.
- [x] Ninguna tarifa productiva usa distancia geodésica como estimación final cuando hay coordenadas. Comida, viajes y envíos usan `resolveDrivingRoute` (caché + circuit breaker) en producción o con proveedor comercial; desarrollo OSM conserva `geodesic_scaled` etiquetado en `distanceSource`. Sin coordenadas, viaje/envío siguen con heurística textual. Verificado en `test:maps-provider`.
- [x] Los costos por proveedor son visibles y tienen alerta de presupuesto. `mapProviderBudgetSnapshot()` y gauges Prometheus (`flash_map_provider_budget_*`) exponen llamadas, límite y remanente por proveedor; al 80% del presupuesto diario se emite `flash_provider_calls_total{operation="budget",outcome="warning"}` una vez por día. Verificado en `test:provider-resilience` y `test:maps-provider`.
- [x] El fallback entre proveedores es auditable. `noteStaleFallback()` registra `stale_fallback` en observabilidad y `maps.stale_fallback` en `audit_events` con hash de caché cuando geocode o routing devuelven respuesta envejecida. Verificado en `test:maps-provider`.
- [ ] Calidad real de rutas y costo por consulta con una API key habilitada.

---

## DSP-001 — Dispatch v2

**Prioridad:** P0 · **Hallazgo:** [H-06](auditoria-2026-08-25.md#h-06--dispatch-sin-recorte-espacial-previo) · **Fase:** 0–1 · **Estado:** Bloqueado por externo (Route Matrix + evidencia SLO en prod)

### Contexto

Al abrir el ticket la consulta de candidatos calculaba distancia y agregados de
30 días sobre todo el padrón online, sin `ST_DWithin` ni KNN. Eso ya no es cierto:
shortlist espacial, stats precomputadas, radio dinámico, boost Flash Más y
assign manual están en el runtime y en puertas CI. Lo que falta para cerrar el
ticket es ETA vial (API key) y evidencia del SLO p95 en infraestructura productiva.

### Trabajo

**Etapa 1 — generación rápida de candidatos:**

```sql
WHERE ST_DWithin(
  driver.current_location,
  job.pickup_location,
  :search_radius_m
)
ORDER BY driver.current_location <-> job.pickup_location
LIMIT 30
```

**Etapa 2 — scoring avanzado** sobre esos 20–30 candidatos: ruta vial · ETA al pickup · espera prevista · ganancia neta · acceptance rate · cancelación · capacidad · preferencias · riesgo · SLA.

**Precomputar estadísticas** en lugar de recalcular el historial completo en cada oferta:

```text
driver_dispatch_stats
- driver_id
- service
- acceptance_rate_7d
- acceptance_rate_30d
- cancellation_rate_30d
- median_response_seconds
- completed_jobs_30d
- incident_score
- current_capacity
- updated_at
```

- [x] **Tabla `driver_dispatch_stats` y refresh out-of-band.** Migración 137 · `server/dispatch-stats.js` · refresh tras accept/reject y en `processPostgresDispatchBatch` · scoring lee la tabla · `test:dispatch-candidates`.

Añadir además: ~~oleadas de oferta~~ · ~~radio dinámico~~ · ~~protección contra inanición~~ · ~~dispatch manual desde backoffice~~ · ~~prioridad Flash Más en cola~~ · prep time anticipado del comercio (**bloqueado** a propósito: máquinas cocina/logística) · **Route Matrix** para el scoring (**bloqueo del dueño:** API key).

- [x] **Dispatch manual desde backoffice.** `POST /api/admin/jobs/:id/assign` + panel Ops; motivo ≥5; auditoría `dispatch.job_assigned`; misma frontera que el worker (comida en `ready_for_pickup`). Verificado en `test:postgres` / `test:audit-actor` / `test:openapi-contract`.
- [x] **Oleadas, radio dinámico e inanición.** Escalera 8→25 km en shortlist; desglose con radio usado; worker de ofertas con TTL. Ver `docs/dispatch-ranking.md`.
- Prep-time anticipado (despachar antes de listo) **bloqueado** hasta separar máquinas cocina/logística (`docs/competitive-research/merchant-live-operations.md`).

### Criterios de aceptación

- [x] El recorte espacial y el orden KNN existen y están cubiertos por una puerta.
- [x] La reasignación automática funciona al expirar una oferta.
- [x] El desglose que explica cada score sigue disponible, ahora con el radio usado.
- [x] Cero dobles asignaciones bajo concurrencia forzada (`test:postgres`).
- [x] **El plan de consulta usa índice GiST, verificado con `EXPLAIN ANALYZE`.** `test:dispatch-plan` explica la consulta **real** —importa `SHORTLIST_SQL` del módulo que la ejecuta, porque explicar una copia probaría que la copia usa el índice— y exige `drivers_available_location_gix` en el plan. Corre sobre mil conductores sintéticos por una razón concreta: con los tres del sembrado el planificador elige `Seq Scan` y hace bien, así que explicarla ahí mediría el caso que no importa. Incluye su otra mitad: con `enable_indexscan` apagado se exige que el plan **deje** de usarlo, porque un detector que encuentre cualquier índice en cualquier parte del plan aprobaría siempre.
- [ ] La primera oferta se emite dentro del SLO de 5 s p95. **Avanzado**: `scripts/dispatch-load-smoke.mjs` (vía `test:dispatch-plan` en `ci-postgres`) mide p95 de la primera oferta sobre mil conductores con oleadas concurrentes y afirma ≤ 5 s; falta evidencia en infraestructura productiva y Route Matrix sigue abierto.
- [x] Existe una prueba de carga con un padrón sintético de al menos 1.000 conductores. El smoke de carga reutiliza `dispatch-synthetic-padron.mjs`, ejercita shortlist/scoring/ofertas concurrentes, workers en paralelo y refuerza cero dobles asignaciones; corre encadenado en `test:dispatch-plan`.
- [ ] ETA vial por Route Matrix conectado al scoring — depende de una API key.

---

## PAY-001 — Validación marketplace

**Prioridad:** P0 · **Hallazgo:** [H-09](auditoria-2026-08-25.md#h-09--mercado-pago-preparado-pero-no-validado) · **Fase:** 1

### Contexto

La integración con Mercado Pago está construida (OAuth PKCE, tokens cifrados, `application_fee`, idempotencia, refund, webhook, conciliación, ledger), pero `PAYMENT_MARKETPLACE_PROVIDER` está deshabilitado por defecto y nada fue probado contra el proveedor real.

### Trabajo

Sellers de test vinculados · OAuth completo · refresh y expiración probados · webhook firmado · pago · capture · refund · payout · reconciliation diaria · modelo de chargeback · caso de **saldo insuficiente del vendedor** · duplicados · timeouts · webhooks fuera de orden · procedimientos humanos para diferencias · validación fiscal y contractual.

### Criterios de aceptación

- [x] **El ledger queda balanceado tras cada operación.** Lo garantiza un `CONSTRAINT TRIGGER` diferido que rechaza al commit toda transacción cuyos débitos no igualen a sus créditos. **Corrección:** ese trigger existía desde la migración 003 —`ledger_entries_must_balance`—, no lo agregó la 118. La 118 escribió un duplicado por haber buscado tablas y políticas sobre `ledger_entries` pero no triggers, y la 121 lo quitó. Lo que sí faltaba, y es lo que cierra este criterio, es la verificación: `test:ledger-balance` barre el libro entero buscando desbalances anteriores, exige que el trigger siga existiendo y siendo diferido —llevaba veinte migraciones sin que nadie lo comprobara, tanto que se lo dio por inexistente— y **le prueba las dos mitades en cada corrida**, todo dentro de un ROLLBACK.
- [x] **Un pago duplicado es idempotente y no genera doble asiento.** La garantía tiene dos mitades y ahora las dos están cubiertas. La estructural —que `ledger_transactions.idempotency_key` siga siendo UNIQUE— la exige `test:ledger-balance`. La de comportamiento —que el código use esa clave y trate el conflicto como «ya estaba» en lugar de reventar o reinsertar— la cubre `test:payment-idempotency`, que llama a `recordMarketplaceCapture` dos veces con el mismo `providerPaymentId` y verifica que quede una sola transacción y un solo par de asientos. **También comprueba que dos pagos distintos sean dos transacciones**: una implementación que considere duplicado todo pasaría la primera mitad y perdería pagos, que es peor que contarlos dos veces.
- [x] **Un reembolso proporcional se refleja correctamente en el split.** `test:order-refund-split` ejercita `resolveOrderIssue` con una liquidación de 3333/3333/3334 sobre 10000 y un reintegro de 1000: los ideales caen en 333,3 y 333,4, así que el reparto tiene que dar 333/333/334 sin perder ni inventar un centavo. El módulo entero estaba sin cobertura. La prueba destapó que la consulta que alimenta el prorrateo **no tenía `ORDER BY`**: el bucle le da el resto al último renglón y ese último lo elegía el planificador, así que el centavo sobrante caía en una parte u otra sin regla y el mismo reintegro podía repartirse distinto al repetirse. Ahora ordena por importe y el resto lo absorbe la parte con mayor participación, que es la que menos se distorsiona en relativo.
- [x] **Una diferencia de conciliación genera un caso operativo, no un error silencioso.** Ya estaba cumplido y sin marcar, que es su propia clase de deuda: `test:payment-reconciliation`, en `ci-critical-flows`, siembra cuatro tipos de discrepancia —intento rancio, captura, reintegro y webhook huérfano— y exige que el escaneo persista un caso por cada uno, que operaciones pueda resolverlo con atribución, y que un caso resuelto no se reabra cuando la discrepancia de origen desaparece.
- [ ] La conciliación diaria corre automáticamente y su resultado es auditable. **Avanzado**: existe `npm run job:payment-reconciliation`, el punto de entrada sin persona detrás, y su resultado queda en `audit_events` con `origin: scheduled-reconciliation`. Corre desatendido cada noche en `ci-nightly`. Lo que falta es el planificador productivo, y no se puede cerrar porque **no hay producción todavía** —la matriz sigue en cero para `PROV`, `STG` y `PROD`—. El trabajo no trae su propio planificador a propósito: un `setInterval` dentro del servidor concilia una vez por réplica y no sobrevive a un reinicio en el momento equivocado. Escribirlo destapó que `recordPostgresAudit` perdía el evento en silencio cuando no había actor, arreglado en el PR de atribución de auditoría.
- [x] **El caso de refund con saldo insuficiente del vendedor está modelado y probado.** La regla es que el reintegro al cliente **nunca se bloquea** por el saldo de un tercero: la parte queda en negativo y la deuda se netea contra liquidaciones futuras. Eso ya pasaba, pero como consecuencia y sin rastro. Ahora es una decisión escrita en [Finanzas de comercios](merchant-finance.md#saldo-en-negativo-por-reintegro), y cada reversión que deja una cuenta en rojo abre un caso `negative_balance` en la bandeja de operaciones —en la misma transacción que escribe el asiento, con el saldo real en `details.balanceCents`—. `test:order-refund-split` lo cubre con sus dos mitades: la parte que ya había cobrado abre exactamente un caso apuntando a su cuenta, y las que siguen en positivo no abren ninguno.

### Nota de alcance

**No se avanza hacia wallet custodial.** El dinero real permanece en el PSP; Flash mantiene un ledger de representación; los créditos Flash son promocionales y no retirables. Ver la sección 4.7 de la auditoría y la nota del BCRA.

---

## GTM-001 — Paridad comercial con la categoría

**Prioridad:** P1 · **Origen:** [investigación competitiva](investigacion-competitiva.md#lo-que-falta-para-competir-y-no-es-técnico) · **Fase:** 2

### Contexto

Al 28 de agosto la paridad funcional con Uber Eats, DoorDash, Rappi y PedidosYa está medida contra el repositorio y es alta: descubrimiento, carrito, cotización, tracking, programación, sustituciones, reembolsos parciales, propinas, chat, calificaciones, promociones, referidos, wallet, alérgenos, sucursales, envíos con protección y riesgo transaccional existen y tienen puerta.

Quedan **cuatro huecos**, y ninguno es de ingeniería: son decisiones de producto comercial. Vivían sólo en el documento de investigación, que es exactamente cómo H-10 se perdió un mes sin dueño.

> **Al 28 de agosto los cuatro están construidos y cableados en sus dos extremos**: la suscripción, la propina en el checkout, la reserva de horario con su reprogramación, y los pedidos grupales. Lo que queda del ticket es comercial —precio, oferta, medición—, no de ingeniería.

### Criterios de aceptación

- [x] **Existe un producto de suscripción.** _Flash Más_, migración 125. El dueño eligió los tres beneficios: envío sin cargo desde un monto, comisión reducida en viajes y prioridad de dispatch. **Los tres viven en la fila del plan, no en el código**, así que mover el umbral o el precio es un `UPDATE` y no un despliegue; el smoke lo prueba moviendo el umbral por encima y por debajo del subtotal del mismo pedido.
  - **Envío sin cargo: entregado y cableado.** Se aplica dentro del cálculo de la cotización, antes de que la ruta firme el token —después de firmar no sobreviviría a la creación del pedido—, se revalida en la creación contra la suscripción releída en la transacción, y se muestra por su nombre en el resumen de web y móvil.
  - **Quién lo paga quedó explícito.** El comercio cobra igual y el conductor cobra el envío completo aunque el cliente no lo haya pagado; la diferencia sale del margen de Flash. Eso obligó a admitir un `platformNet` negativo en la liquidación, acotado exactamente al subsidio otorgado: antes el reparto no cerraba y el pedido moría después de cobrado.
  - **Prioridad de dispatch: cableada en la cola de jobs (DSP-001).** `dispatch_priority_boost` del plan vigente reordena el reclamo del batch (`ORDER BY boost DESC, created_at`); no altera el score de conductores. Verificado en `test:dispatch-candidates` y `test:postgres` (suite de suscripciones): un job más nuevo con boost se reclama antes que el FIFO viejo sin suscripción. Periodo cancelado pero vigente sigue contando.
  - **Comisión reducida en viajes: en la fila del plan, todavía sin aplicar.** `ride_discount_bps` no se aplica porque `/api/rides/quote` no exige sesión —es un estimador público de precio— y personalizarlo ahí cambia el contrato de la ruta.
  - **No cobra.** El cobro recurrente depende de PAY-001, que espera credenciales. `user_subscriptions.billed` distingue un período cobrado de uno otorgado mientras eso no exista, y la respuesta de la API y las dos pantallas lo dicen: «Período bonificado». Un período que se otorga y se llama cobrado es la forma más rápida de tener un problema contable.
- [x] **La propina se puede dejar en el checkout.** Migración 126. Se cobra junto con el pedido —**un solo cargo**— y queda retenida hasta que hay conductor y el servicio se completa; ahí se libera entera a quien repartió. Si el pedido se reintegra, vuelve con el resto.
  - **El problema no era la pantalla: en el checkout todavía no hay a quién pagarle.** Eso obligó a que una propina pueda existir sin destinatario, que es lo que la migración habilita (`driver_id` y `ledger_transaction_id` pasan a ser opcionales, y `status` distingue `held` de `released` y `refunded`).
  - **No se reparte.** La liquidación la saca del total antes de dividir entre comercio, conductor y plataforma, y la acredita aparte. Sin eso el comercio se llevaba parte de la propina; con split de Mercado Pago hacía falta además sumarla a la comisión de aplicación, o el proveedor se la depositaba directamente a él.
  - **Los porcentajes se calculan sobre el subtotal, no sobre el total.** Sobre el total, la propina subiría cuando sube el envío o la tarifa de servicio, que no tienen nada que ver con quien reparte.
  - **Los topes del cliente son los del servidor, y hay una puerta que lo vigila.** `test:web-checkout` y `test:mobile-food-design` leen el piso, el techo y la proporción del propio `tip-repository.js`: si el servidor cambia y el cliente no, la pantalla ofrecería un botón que devuelve 409.
- [x] **Existen pedidos grupales.** Migración 128, web y móvil. Cada participante tiene su propia canasta, el anfitrión ve quién pidió qué, y cierra y paga uno solo.
  - **Un grupo confirmado se convierte en un pedido normal.** No hay una segunda tubería: se juntan los ítems, se cotiza y se crea por `/api/orders` como cualquier pedido. De ahí en adelante propina, suscripción, horario reservado, despacho y liquidación no saben que empezó como grupo — que es exactamente lo que evita que cada una crezca un caso especial.
  - **No se toca el carrito personal de nadie.** Reusar `carts` habría sido menos código, pero tiene un único activo por (cliente, comercio): sumarse a un grupo del mismo restaurante donde ya tenías algo guardado te lo habría pisado sin avisar.
  - **Tope de gasto por persona**, verificado contra los precios de la base y no contra los que manda el cliente: un tope que se pueda esquivar mandando precios inventados no es un tope. Es la diferencia entre un pedido entre amigos y uno de oficina con presupuesto.
  - **El código de seis caracteres no da lectura por sí solo.** Primero se entra, después se ve; al revés, cualquiera con un código filtrado leería quién pidió qué en una oficina. El alfabeto excluye `0/O` y `1/I/L`, que son los pares que se copian mal al dictarlo.
- [x] **Un pedido programado se puede reprogramar.** Migración 127, y el criterio resultó ser dos cosas.
  - **Los pedidos de comida no se podían programar en absoluto.** `jobs.scheduled_for` existía desde la migración 001 y **sólo lo escribía el alta de viajes** — mientras la portada del cliente prometía «Programar · Food o taxi» desde antes de que existiera la mitad de comida de esa promesa. Ahora el checkout reserva horario en web y móvil.
  - **`PATCH /api/jobs/:id/schedule` mueve el horario**, de un pedido o de un viaje: los dos son filas de `jobs` con horario, y una ruta por servicio serían dos versiones de la misma política. Sólo en `requested` o `accepted` y sin conductor asignado; después, mover la hora tira comida o le hace perder el viaje a alguien que se comprometió, y ahí la salida correcta es cancelar con su política.
  - **La ventana de reserva dejó de estar duplicada.** Vivía escrita a mano dentro del router de viajes; ahora es `server/scheduling.js` y la usan las tres rutas que tocan horarios. `test:dispatch-candidates` afirma los cuatro bordes exactos y que ningún router vuelva a escribirla a mano.
  - **Una reserva ya no ensucia la cola del comercio.** `merchant_ready_due_at` cuenta desde el horario reservado y no desde el cobro; las reservas fuera de ventana salen de `activeOrders` y de `oldestActiveMinutes` —una reserva para la semana que viene aparecía como un pedido de siete días de antigüedad y disparaba la alarma de demora— y se publican aparte en `scheduledAhead`, para que el comercio pueda planificar sin que le cuenten como trabajo pendiente.

### Nota de alcance

Este ticket **no** incluye lo que depende de terceros —credenciales de proveedor, dispositivos, un entorno desplegado—, que está repartido en PAY-001, GEO-001, NOT-001, MOB-001 y CI-001 con su bloqueo nombrado.

---

## MOB-001 — Release engineering

**Prioridad:** P0 · **Fase:** 1

### Trabajo

Perfiles EAS preview y production · signing · TestFlight · internal testing · crash reporting · política OTA · versión mínima · upgrade forzado · deep links · device integrity.

### Criterios de aceptación

- [ ] Existen tres binarios internos instalables: customer, driver y merchant.
- [ ] Un crash es visible en Sentry con símbolos resueltos.
- [ ] El rollback fue probado.
- [x] Los permisos de ubicación se explican correctamente al usuario en ambas plataformas. Strings iOS/Android por variante en `app.base.json` / `app.config.js`; rationale in-app vía `explainAndRequestForegroundLocation` antes del diálogo del sistema; `test:mobile-location-permission` en `ci-fast`.
- [ ] Background location fue probada en dispositivos físicos con development build, no en Expo Go.

---

## OPS-001 — Operación real

**Prioridad:** P1 · **Fase:** 2

### Trabajo

Case ownership · SLA · escalation · aprobación de refunds · suspensión de drivers · suspensión de comercios · excepciones de pago · intervención de dispatch · runbooks · traspaso de turno.

### Criterios de aceptación

- [x] **Ningún incidente requiere ejecutar SQL manual.** Se inventarió qué puede hacer un operador contra lo que la operación necesita, y quedaban dos huecos. Los dos son la llamada de las dos de la mañana, y los dos se resolvían entrando a la base.
  - **Suspender un comercio.** `merchants.status` existía, cuarenta y una consultas lo respetaban, y **ninguna ruta lo escribía**. La columna además era `text` sin restricción, así que un valor mal tipeado suspendía el comercio en todas partes a la vez y sin decirlo; la migración 130 le pone el `CHECK`.
    - **Suspender frena lo nuevo y no cancela lo que está en curso.** Cancelar en masa castiga a clientes que no hicieron nada y deja comida hecha sin destino. Lo que la suspensión corta es que entre uno más.
    - Y el comercio suspendido **sigue viendo su panel**. El tablero filtraba por comercio activo, así que suspenderlo lo dejaba sin ver los pedidos que ya tenía en el horno. Ahora publica `merchantStatus` para que distinga una sucursal que él cerró de una suspensión que decidió operaciones.
  - **Soltar un servicio de un conductor.** Un teléfono que se apaga, una moto que se rompe, alguien que aceptó y desapareció: el trabajo quedaba con `driver_id` puesto y sin camino de vuelta al despacho. `POST /api/admin/jobs/:id/release` lo devuelve, retira las ofertas pendientes y avisa a las dos partes.
    - **Sólo antes de retirar.** Después el conductor tiene la comida encima o el pasajero adentro, y ahí la salida es cancelar con su política o abrir una incidencia. Aceptarlo en ese estado dejaría un pedido en la calle sin dueño.
    - Vuelve al estado del que se asigna, que no es el mismo para todos: comida a `ready_for_pickup`, viajes y envíos a `requested`. Devolverlos todos al mismo lo dejaría fuera del alcance del despacho.
  - **Las dos exigen motivo de al menos cinco caracteres**, y las dos entraron a la lista de `test:audit-actor`: son decisiones sobre el registro de un tercero, y el día del reclamo lo que se lee es el log.
- [x] **Toda acción operativa registra actor y motivo.** El actor ya estaba. El motivo lo registran las ocho decisiones que cambian el estado de un tercero, y desde el 28 de agosto hay puerta: vive **dentro de `test:audit-actor`**, no en una suite propia.
  - Ese detalle era el bloqueo, y resultó ser el bloqueo equivocado. Lo que el token de GitHub sin permiso `workflow` impide es **agregar una suite nueva** —habría que editar un workflow para cablearla, y una suite sin workflow no protege nada—. No impide agregar la comprobación a una suite que ya está cableada. El chequeo es estático y corre antes de que el archivo toque la base, así que se ejecuta sin credenciales aunque el resto de la suite no.
  - Falsificada en sus dos mitades: sacándole el motivo a una decisión, y declarando una acción que no existe en el código.
- [x] **Los tickets críticos escalan al vencer su SLA.** Lo hace `worker:support`, que reclama tickets vencidos con `FOR UPDATE SKIP LOCKED` y registra la escalación de forma idempotente.
  - > **Corrección del 28 de agosto.** Este criterio se dio por cerrado ese mismo día con un hallazgo que era **falso**: que `processPostgresDispatchBatch`, `processPostgresNotificationBatch` y `processSupportQueue` no tenían ningún punto de entrada desatendido, y que por eso un pedido pagado no recibía oferta de conductor. Los tres workers existían desde antes —con bucle propio, backoff y apagado ordenado— y estaban documentados en [`docs/operations.md`](operations.md). El error fue buscar sólo `job:*` y `setInterval`, encontrar lo esperado, y escribirlo como hecho; el trabajo duplicado que se creó a partir de eso se borró.
  - Lo que sí era cierto y quedó arreglado: las tres funciones estaban **importadas en `server/index.js` y nunca llamadas desde ahí**. Eran importaciones muertas, y la lectura apresurada de eso fue lo que produjo el hallazgo falso.
  - **La puerta se quedó, apuntando a lo que existe.** `test:ci-coverage` verifica que cada lote tenga su punto de entrada —`worker:dispatch`, `worker:notifications`, `worker:support`, `job:payment-reconciliation`— y que nadie meta un `setInterval` dentro del servidor, que corre una vez por réplica y no sobrevive a un reinicio.
- [x] **Existen dashboards por cola de trabajo.** `GET /api/operations/work-queues` y el tablero al tope de la vista general del backoffice, con las doce colas del producto.
  - **Se ordena por antigüedad del más viejo, no por cantidad.** Una cola con trescientos elementos de este minuto está sana; una con tres de hace cuatro días no. Y es la forma de la métrica que revela lo que ninguna cantidad revela: que nadie está procesando.
  - **Separa cola de máquina de cola de persona**, porque el diagnóstico es distinto: si se llena una que vacía un trabajo programado, falta cron; si se llena una que atiende una persona, falta gente o falta prioridad. Los umbrales van en minutos para las primeras y en horas para las segundas — a las tres de la mañana no hay nadie, y eso no es una falla.
  - **El predicado de la cola de despacho es una copia del que usa el lote.** Un tablero que midiera «trabajos sin conductor» a secas habría contado los programados para mañana y los que ya tienen oferta viva, y habría mostrado una cola sana durante todo el tiempo en que el lote no corría.
  - Lo lee `support` además de `admin`: que sólo lo vea administración convierte una pregunta operativa en una escalación.

---

## INT-001 — POS y API

**Prioridad:** P1 · **Fase:** 3

### Contexto

El contrato OpenAPI actual se declara explícitamente incremental y cubre sólo una parte del núcleo. `server/openapi.js` tiene 61 KB pero no representa toda la plataforma.

### Trabajo

OpenAPI completo · SDK generado · API keys · OAuth para partners · webhooks firmados · replay · sandbox · logs de integración · partner portal.

### Criterios de aceptación

- [ ] Un comercio externo sincroniza su menú por API.
- [ ] Una orden entra al POS del comercio.
- [ ] El stock se actualiza en ambos sentidos.
- [ ] Un webhook duplicado no genera efectos duplicados.
- [ ] Un partner puede depurar sus propios errores desde el portal.

---

## Tickets P2 — post-Fase 0

No se ejecutan durante el congelamiento. Se registran para no perderlos.

| Ticket      | Descripción                                                                              |
| ----------- | ---------------------------------------------------------------------------------------- |
| **OBS-002** | Colector, dashboards y Alertmanager administrados; paging productivo                     |
| **RT-002**  | Insertar el evento realtime en la misma transacción de dominio mediante outbox           |
| **RT-003**  | WebSocket para presencia bidireccional, chat y tracking de alta frecuencia               |
| **SAF-002** | Safety Operating System: detección de anomalías, incident command, llamadas enmascaradas |
| **DAT-002** | Rotación de claves y migración a KMS/HSM o Secret Manager administrado                   |
| **SEC-002** | Pentest externo y revisión de seguridad independiente                                    |
| **QC-001**  | Quick commerce, picking e inventario masivo — **no antes de la Fase 4**                  |
