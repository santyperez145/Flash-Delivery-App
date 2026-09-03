# Plan de acción — Flash Delivery App

Vigente desde el **25 de agosto de 2026**. Deriva de [`docs/auditoria-2026-08-25.md`](auditoria-2026-08-25.md) y se ejecuta con los tickets de [`docs/backlog-tecnico.md`](backlog-tecnico.md).

Este documento manda sobre cualquier otro roadmap del repositorio mientras dure la Fase 0. Si `ROADMAP.MD` y este plan discrepan sobre qué hacer primero, gana este plan.

---

## 0. Regla de congelamiento

> **Durante la Fase 0 no se agregan verticales, pantallas ni capacidades de producto nuevas.**

Se admiten exclusivamente cuatro clases de cambio:

1. Los tickets P0 listados en el backlog técnico.
2. Corrección de defectos que bloqueen un P0.
3. Pruebas, contratos, puertas CI y observabilidad.
4. Documentación que refleje lo anterior.

Cualquier otra propuesta se anota en `ROADMAP.MD` como candidata post-Fase 0 y no se implementa. El motivo está en el veredicto de la auditoría: **la plataforma ya tiene más superficie funcional de la que puede validar, mantener y operar**. Agregar más superficie durante la estabilización empeora exactamente la métrica que se quiere corregir.

Excepción única: un hallazgo de seguridad explotable se atiende de inmediato, con su prueba de regresión, sin esperar al orden del plan.

---

## 1. Orden ejecutivo

Este es el orden obligatorio. No se adelanta un ítem sin cerrar el anterior o sin declarar explícitamente por qué se desvía.

| # | Acción | Ticket | Fase |
| ---: | --- | --- | --- |
| 1 | Congelar funcionalidades nuevas durante un ciclo de estabilización | — | 0 |
| 2 | Separar las aplicaciones y los archivos monolíticos | [ARC-001](backlog-tecnico.md#arc-001--modularización) | 0 |
| 3 | Hacer que PostgreSQL/PostGIS y la suite crítica bloqueen todos los PR | [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo) | 0 |
| 4 | Implementar push real | [NOT-001](backlog-tecnico.md#not-001--push-real) | 0 |
| 5 | Reemplazar Nominatim/OSRM públicos para producción | [GEO-001](backlog-tecnico.md#geo-001--proveedor-de-mapas-comercial) | 0 |
| 6 | Corregir la audiencia por defecto del realtime | [SEC-001](backlog-tecnico.md#sec-001--realtime-default-deny) | 0 |
| 7 | Optimizar dispatch con radio, KNN, stats precomputadas y Route Matrix | [DSP-001](backlog-tecnico.md#dsp-001--dispatch-v2) | 0–1 |
| 8 | Endurecer la imagen Docker y ejecutar siempre el entrypoint instrumentado | [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida) | 0 |
| 9 | Completar OpenAPI y contratos de integración | [INT-001](backlog-tecnico.md#int-001--pos-y-api) | 1–3 |
| 10 | Validar Mercado Pago de extremo a extremo con sellers de prueba | [PAY-001](backlog-tecnico.md#pay-001--validación-marketplace) | 1 |
| 11 | Generar builds internos reales para las tres apps | [MOB-001](backlog-tecnico.md#mob-001--release-engineering) | 1 |
| 12 | Ejecutar una beta cerrada de delivery y courier en una sola zona | [OPS-001](backlog-tecnico.md#ops-001--operación-real) | 2 |
| 13 | Desarrollar Flash Business | — | 3 |
| 14 | Validar unit economics antes de subsidiar crecimiento | — | 2–3 |
| 15 | Postergar viajes públicos hasta resolver legal, seguros y safety 24/7 | — | 4 |
| 16 | No expandirse a otra ciudad antes de demostrar liquidez y margen en La Rioja | — | 5 |

---

## 2. Fase 0 — Estabilización

**25 de agosto → 20 de septiembre de 2026 (4 semanas).**

### Objetivo

Convertir una plataforma extensa en una base verificable. Al final de la Fase 0, cada afirmación del roadmap debe estar respaldada por una puerta automática o por una etiqueta honesta de dependencia externa.

### Matriz de madurez — instrumento central

El primer entregable es una matriz que clasifique **cada capacidad** en uno de seis estados. Sin esta matriz no se puede decidir qué es real.

| Estado | Significado |
| --- | --- |
| `IMPL` | Implementado en código |
| `LOCAL` | Probado localmente por un humano o un script |
| `CI` | Probado en CI como puerta bloqueante |
| `PROV` | Probado contra el proveedor real en sandbox |
| `STG` | Validado en staging con datos separados |
| `PROD` | Operado en producción con usuarios reales |

Regla: **una capacidad no puede anunciarse como disponible por encima de su estado real.** Una capacidad en `IMPL` no se demuestra a un inversor como funcional, y una capacidad en `CI` no se anuncia como productiva.

La matriz vive en `docs/matriz-madurez.md` y se actualiza en el mismo PR que cambia la capacidad.

### Entregables por semana

#### Semana 1 (25–31 de agosto) — Puertas y default-deny

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| ~~PostgreSQL/PostGIS como servicio en CI~~ **hecho** | CI-001 | `ci-postgres.yml` corre migraciones desde cero y de forma incremental sobre la base del PR |
| ~~Realtime default-deny~~ **hecho** | SEC-001 | Entidad desconocida sólo llega a `admin`; `test:realtime-audience` cubre todos los `entityType` |
| ~~Imagen Docker multi-etapa non-root~~ **hecho** | INF-001 | `USER flash`, `server/start.js`, sin devDependencies · verificado en build real |
| ~~Protección de rama y CODEOWNERS~~ **hecho** | CI-001 | Desde el 27 de agosto de 2026 `main` exige PR y los 7 checks, con `enforce_admins`. Sin aprobaciones ni Code Owners: con un solo colaborador, exigirlas dejaría el repositorio sin poder mergear |
| ~~Matriz de madurez inicial~~ **hecho** | — | 91 capacidades clasificadas y actualizadas en cada entrega |

#### Semana 2 (1–7 de septiembre) — Cobertura de riesgo

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| ~~`ci-critical-flows.yml`~~ **hecho** | CI-001 | Pagos, ledger, webhooks, conciliación, KYC, soporte y safety bloquean el merge · **cuarentena vacía desde el 27-08** |
| ~~Matriz formal de cobertura RLS~~ **hecho** | DAT-001 | 109 tablas clasificadas y con puerta CI; `FORCE ROW LEVEL SECURITY` sigue pendiente |
| ~~Pruebas negativas por rol~~ **hecho** | DAT-001 | Las cinco tablas de la deuda cerraron el 27-08: `test:rls-matrix` reporta 69 de 69 y `test:rls` afirma las dos mitades de cada una —el rol auditor no ve nada, y el dueño sí ve lo suyo—. Falta acotar los grants por operación |
| ~~Vitest + Testcontainers~~ **hecho** | CI-001 | `test:authorization` corre sobre Vitest 4.1; `test:runtime-role-shape` crea además PostGIS 17 aislado, aplica las 136 migraciones y bloquea `ci-postgres` |

#### Semana 3 (8–14 de septiembre) — Proveedores reales

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| ~~`NOTIFICATION_PROVIDER=expo`~~ **hecho** | NOT-001 | Falta que el push llegue a un dispositivo físico |
| ~~Receipts y device invalidation~~ **hecho** | NOT-001 | `DeviceNotRegistered` revoca el token; receipt ausente genera alerta |
| ~~Adapter `MapsProvider`~~ **hecho** | GEO-001 | Geocode, route y route matrix detrás de una interfaz, con dos proveedores |
| Proveedor comercial conectado | GEO-001 | **Bloqueado por credenciales.** Producción ya rechaza instancias públicas |

#### Semana 4 (15–20 de septiembre) — Modularización y cierre

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| Separación de `src/App.tsx` | ARC-001 | Shell web de sesión/auth/enrutado; catálogo, carrito, checkout y viajes viven en `useCustomerCommerce`. Cliente HTTP: transporte en `src/api/http.ts`; mapa partido en cuenta/comercio/movilidad/operaciones; el barrel sólo compone. Cliente delegado: Wallet, Cuenta, Actividad, Envíos, descubrimiento, restaurante, personalización, carrito/checkout, navegación y los tres trackings. `CustomerSurface.tsx` queda en 360 líneas. Backoffice: `AdminConsole` es shell. Comercio: `MerchantConsole` es shell. Phone-stage: comercio, conductor y ops en módulos y chunks propios. |
| Separación de `apps/mobile/App.tsx` | ARC-001 | Entrypoints customer/driver/merchant independientes; Actividad, tracking, Cuenta, Envíos y Viajes fuera del coordinador customer. Merchant App: `MerchantScreen` es shell. Sesión de Comidas en `useCustomerFood`; `CustomerScreen` queda como shell. Cliente HTTP: transporte en `apps/mobile/src/api/http.ts`; mapa partido en cuenta/comercio/movilidad/operaciones; el barrel sólo compone. |
| Descomposición de `server/index.js` | ARC-001 | Controllers separados de use cases y repositories. **9 de 57 grupos extraídos**; el núcleo compartido está completo, así que lo que queda es repetitivo y no de diseño |
| ~~Reformateo de archivos comprimidos~~ **hecho** | ARC-001 | Línea máxima 4.061 → 206; **0** líneas >200 (bajan de 251); `test:line-length` en cero |
| ~~Dispatch v2 etapa 1~~ **hecho** | DSP-001 | `ST_DWithin` + KNN recortan candidatos antes del scoring |
| SLOs documentados | — | Objetivos técnicos de la auditoría publicados y medibles |

### Criterios de salida de la Fase 0

La fase no se declara cerrada hasta que **todos** estos puntos sean verificables por un tercero:

- [x] Ningún merge a `main` evita PostgreSQL/PostGIS en CI.
- [x] Ningún recurso de realtime con entidad desconocida se transmite a todos los roles.
- [ ] Un push real llega a un dispositivo físico Android y a uno iOS. **Bloqueo del dueño:** teléfono + credenciales EAS.
- [ ] Una cotización productiva se calcula con ruta vial de un proveedor comercial. **Código listo** (`distanceSource: road` en prod); falta API key del dueño para evidencia real.
- [x] La imagen de producción corre como usuario no privilegiado y usa `server/start.js`.
- [x] El build de cada variante mobile (customer, driver, merchant) funciona por separado — `test:mobile-variant-bundles` en `ci-fast`.
- [ ] Cero credenciales demo en cualquier ambiente desplegado. **Bloqueo del dueño:** falta cuenta GCP / entorno.
- [x] La suite crítica está verde y es bloqueante, y **la cuarentena está vacía desde el 27 de agosto**.
- [x] La matriz de madurez está publicada y ningún ítem del README la contradice.
- [x] Ningún archivo fuente supera 1.500 líneas ni contiene líneas de más de 200 caracteres. **Líneas >200: cerrado (0). Archivos >1500: cerrado (0)** — `postgres-runtime-smoke.mjs` (4767 → **17** compositor) + `scripts/postgres-runtime/*` (máx. **1218**); `openapi.js` y `store.js` ya partidos. `test:line-length` fija ambos ratchets.

### Bloqueos del dueño (no los puede cerrar el agente)

| Bloqueo | Ticket / criterio | Qué hace falta |
| --- | --- | --- |
| Cuenta GCP `southamerica-east1` | Despliegue / cero demo en prod | Crear proyecto y secretos — ver `docs/despliegue.md` |
| `GOOGLE_MAPS_SERVER_API_KEY` (+ móviles restringidas) | GEO-001 calidad/costo real; cotización vial con evidencia | API key comercial |
| Teléfono Android + iOS + credenciales EAS | NOT-001 push físico | Dispositivos y cuenta Expo |
| Segundo revisor GitHub | CI-001 pagos/seguridad | Otro humano en el repo / `CODEOWNERS` |
| Credenciales nightly (k6 sandbox, EAS builds) | CI-001 nightly | Secrets en Actions |

Sin esos ítems la app **no puede declararse terminada en producción**; el código y las puertas CI sí pueden seguir cerrando todo lo verificable en el repo.

---

## 3. Fase 1 — Beta técnica de delivery

**21 de septiembre → 22 de noviembre de 2026 (9 semanas).**

### Objetivo

Demostrar que un pedido completo, con dinero real de sandbox, atraviesa la plataforma sin intervención manual.

### Entregables

**Pagos:** Mercado Pago OAuth sandbox completo · pago real en entorno de prueba · webhook firmado · refund · reconciliation diaria · payout workflow · caso de refund con saldo insuficiente del vendedor.

**Mobile:** app cliente preview · app comercio preview · app driver preview · background GPS probado en varios dispositivos y versiones de sistema operativo · push receipts en producción de prueba · crash reporting.

**Dispatch:** dispatch v2 completo · Route Matrix · prep time del comercio · oleadas de oferta · radio dinámico · protección contra inanición · dispatch manual desde backoffice.

**Operación:** onboarding de comercios · onboarding de drivers · KYC operativo · casos de soporte · chat · evidencia de entrega.

**Infraestructura:** backups automáticos · restore drill ejecutado y cronometrado · dashboard de SLO · prueba de carga con k6.

### Criterios de salida

- [ ] Un pedido completo se procesa sin una sola intervención SQL manual.
- [ ] Un reembolso queda conciliado automáticamente.
- [ ] Un webhook duplicado no duplica asientos en el ledger.
- [ ] Dos drivers no pueden tomar el mismo trabajo bajo concurrencia forzada.
- [ ] Una oferta vencida se reasigna sola.
- [ ] El driver recibe push con la app cerrada o en background, dentro de las limitaciones documentadas del sistema operativo.
- [ ] Operaciones resuelve incidentes íntegramente desde el backoffice.
- [ ] El restore fue probado y su tiempo real cumple el RTO ≤ 60 minutos.

---

## 4. Fase 2 — Piloto controlado en La Rioja

**23 de noviembre de 2026 → 28 de febrero de 2027.**

### Alcance

15–25 comercios · 20–40 repartidores controlados · 300–500 usuarios invitados · zona limitada · horario limitado · delivery y courier · **sin viajes públicos**.

### Entregables

Operaciones locales · soporte activo con SLA real · pago productivo de bajo volumen · liquidaciones · promociones limitadas · merchant dashboard · driver earnings · ratings · suspensiones · incidencias · refunds · reportes diarios · monitoreo de costos por proveedor · funnel y cohortes.

### Criterios de salida

- [ ] Fill rate por encima del objetivo interno definido al inicio del piloto.
- [ ] Completion rate consistente semana a semana.
- [ ] Conciliación financiera al 100%, sin diferencias sin explicar.
- [ ] Cero dobles cobros.
- [ ] Cero dobles asignaciones.
- [ ] Los comercios operan sin asistencia permanente del equipo.
- [ ] Los drivers comprenden la oferta y la liquidación sin necesidad de soporte.
- [ ] **Contribution margin calculable por job.**

El último punto es la puerta económica: sin margen de contribución medible, no se pasa a la Fase 3 ni se subsidia crecimiento.

---

## 5. Fase 3 — Flash Business e integraciones

**Marzo → mayo de 2027.**

Cuentas empresariales · usuarios invitados · centros de costo · presupuestos · restricciones por día, hora y zona · facturación unificada · reportes · API · webhooks · envíos programados · multi-stop · flotas · delivery híbrido · primeras integraciones POS · portal de developers · sandbox de integraciones.

### Criterios de salida

- [ ] Primeros contratos B2B recurrentes firmados.
- [ ] API versionada y documentada.
- [ ] Webhooks idempotentes verificados por un partner externo.
- [ ] Facturación conciliada.
- [ ] Una integración POS piloto en operación.

---

## 6. Fase 4 — Piloto de movilidad

**Junio → agosto de 2027.**

### Precondiciones bloqueantes

Ninguna línea de código de esta fase se escribe antes de tener:

- [ ] Opinión legal por escrito sobre el encuadre en La Rioja.
- [ ] Validación municipal/provincial documentada.
- [ ] Seguros contratados y vigentes.
- [ ] Contratos con conductores.
- [ ] Conductores habilitados según el marco aplicable.
- [ ] Safety operations con equipo humano.
- [ ] Soporte 24/7 durante todo el piloto.

**No debe inferirse legalidad por la presencia de competidores en la ciudad.**

### Entregables

Verificación de pasajero · verificación biométrica de conductor · PIN obligatorio · llamadas enmascaradas · compartir viaje · contactos de confianza · detección de desvío · detección de parada anómala · botón de emergencia · incident command · objetos perdidos · accidentes · no-show · waiting fee · payouts · viajes corporativos.

### Criterios de salida

- [ ] 100% de drivers con documentación vigente verificada.
- [ ] 100% de viajes trackeados.
- [ ] Alertas automáticas de anomalía funcionando.
- [ ] Procedimiento de emergencia probado en simulacro.
- [ ] Seguro validado con un caso real de prueba.
- [ ] Cero viajes iniciados sin PIN cuando corresponde.

---

## 7. Fase 5 — Multiciudad

**Septiembre de 2027 en adelante.**

Configuración por ciudad · tarifas versionadas · reglas locales · feature flags por ciudad · impuestos · zonas · equipos operativos · forecast · data warehouse · experimentación · playbook de lanzamiento · disaster recovery · escalado independiente de workers · separación de servicios sólo donde sea necesario.

**Precondición:** liquidez y margen demostrados en La Rioja. No antes.

---

## 8. Arquitectura objetivo

Estructura hacia la que converge la modularización de ARC-001. Sigue siendo **un monolito modular**, no microservicios.

```text
apps/
  customer-mobile/
  driver-mobile/
  merchant-mobile/
  ops-web/
  business-web/
services/
  api/
    modules/
      identity/  customers/  merchants/  catalog/  pricing/
      orders/    rides/      shipments/  dispatch/ payments/
      ledger/    support/    safety/     notifications/
      analytics/ admin/
workers/
  dispatch/  notifications/  payments/
  reconciliation/  support/  analytics/
packages/
  contracts/  domain/  database/  providers/
  observability/  configuration/
  mobile-ui/  web-ui/  testing/
```

---

## 9. Arquitectura de CI objetivo

Cuatro workflows sustituyen al `ci.yml` único. Detalle de implementación en [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo).

| Workflow | Cuándo | Contenido |
| --- | --- | --- |
| `ci-fast.yml` | Cada PR | Typecheck · lint · unit tests · static security · secret scan · build · bundle budget |
| `ci-postgres.yml` | Cada PR | PostgreSQL/PostGIS · migraciones aisladas con Testcontainers · migraciones desde snapshot anterior · RLS · audit chain · runtime smoke · city isolation · idempotencia |
| `ci-critical-flows.yml` | Cada PR | Pago · webhook · refund · ledger · dispatch · reconciliation · KYC · support SLA · safety |
| `ci-nightly.yml` | Cada noche | Playwright E2E · performance · load · provider sandbox · restore drill · dependency scan completo · mobile build preview |

---

## 10. Seguimiento

Estado al **25 de agosto de 2026**. Se actualiza en el PR que cambia el estado, nunca en un PR aparte.

| Ticket | Prioridad | Hallazgo | Estado | Fase |
| --- | --- | --- | --- | --- |
| [SEC-001](backlog-tecnico.md#sec-001--realtime-default-deny) | P0 | H-03 | **Cerrado** | 0 |
| [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo) | P0 | H-01 | **En curso** | 0 |
| [ARC-001](backlog-tecnico.md#arc-001--modularización) | P0 | H-08 | **En curso** | 0 |
| [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny) | P0 | H-04 | **Cerrado** | 0 |
| [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida) | P0 | H-05 | **Cerrado** | 0 |
| [NOT-001](backlog-tecnico.md#not-001--push-real) | P0 | H-02 | **Bloqueado por externo** | 0 |
| [GEO-001](backlog-tecnico.md#geo-001--proveedor-de-mapas-comercial) | P0 | H-07 | **En curso** | 0 |
| [DSP-001](backlog-tecnico.md#dsp-001--dispatch-v2) | P0 | H-06 | **En curso** | 0–1 |
| [PAY-001](backlog-tecnico.md#pay-001--validación-marketplace) | P0 | H-09 | Pendiente | 1 |
| [MOB-001](backlog-tecnico.md#mob-001--release-engineering) | P0 | — | Pendiente | 1 |
| [OPS-001](backlog-tecnico.md#ops-001--operación-real) | P1 | — | Pendiente | 2 |
| [INT-001](backlog-tecnico.md#int-001--pos-y-api) | P1 | — | Pendiente | 3 |

### Detalle de lo que está en curso — 26 de agosto de 2026

> **Las tres puertas están en verde.** 106 de 107 suites detrás de una puerta, 104 bloqueantes. Antes de esta entrega, `main` llevaba en rojo desde el 23 de agosto sin que nadie estuviera bloqueado — la prueba práctica de H-01: una puerta que existe pero no se hace cumplir no protege nada.

**SEC-001.** El fallback fail-open está eliminado. La política de audiencias vive
ahora en `server/realtime-audience.js`, un módulo sin dependencias, y una entidad
desconocida llega solamente a `admin`. Se descubrió que el defecto era mayor que
lo estimado: **13 de las 44 publicaciones realtime difundían a todos los roles**,
entre ellas las seis del libro de direcciones. `test:realtime-audience` bloquea el
merge y se verificó que falla ante el defecto. Falta la verificación de runtime
contra PostgreSQL y el dashboard de la métrica.

**CI-001.** `ci.yml` se dividió en **cuatro workflows**. La cobertura pasó de
**15 a 106 de 107 suites** detrás de una puerta, 104 de ellas bloqueantes.
`ci-critical-flows.yml` levanta la API contra PostgreSQL y
cubre pagos, conciliación, riesgo, payouts, KYC, vehículos, safety, chat,
soporte y notificaciones.

Levantar las puertas de verdad destapó cuatro defectos que llevaban días o meses
sin detectarse: `test:redis-rate-limit` roto desde el 23 de agosto por un cambio
de API de node-redis; una base desde cero que no equivalía a una migrada
([H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada));
**cuentas sembradas que no podían iniciar sesión** porque la verificación de
email era un backfill sobre usuarios preexistentes; y una suite que dependía del
orden de ejecución.

`test:ci-coverage` es la puerta que sostiene el resto: falla cuando una suite
queda fuera de todo workflow. Sin ella, la próxima se suma en silencio a las 89
que nadie corría.

La protección de rama se activó el 27 de agosto de 2026, y con eso los 82 checks dejaron de ser
informativos: `main` sólo acepta merges por PR, con los 7 contextos en verde y la rama al día.
Hasta ese día se habían mergeado once PR en los que CI pasaba sin que nada lo exigiera —el
trabajo estaba hecho y la puerta seguía abierta—.

`ci-nightly.yml` existe desde el 27 de agosto: corre la auditoría responsive en
Chromium —una vez por variante móvil— y la latencia de endpoints. Con eso las
dos suites que estaban declaradas como excepción pasaron a tener puerta, y
`test:ci-coverage` distingue ahora nocturna de bloqueante para que el número
que publica no exagere lo que un PR realmente frena.

La cuarentena quedó **vacía** el 27 de agosto: `test:support-routing` salió y ya
bloquea. Su causa anotada era falsa —le faltaba la cabecera `Idempotency-Key`,
así que nunca llegó a probar el ruteo del que la acusaban—. Del nocturno faltan
carga k6, sandbox de proveedores y builds EAS —los tres necesitan credenciales—
más el restore drill, que hoy es un script PowerShell.

Cerrar tres de las cuatro suites en cuarentena destapó cuatro defectos reales
—ninguno era fragilidad de la prueba—, tres de ellos variantes de H-11. Uno
excede a CI: el motor de riesgo trata como nueva a toda cuenta sembrada, lo que
significa que **un primer despliegue productivo marcaría a sus propios primeros
clientes**.

**INF-001.** La imagen es multi-etapa, corre como `uid=999(flash)`, arranca el
entrypoint instrumentado y no lleva devDependencies ni el árbol de fuentes. El
job `container-image` la construye en cada PR y verifica el resultado, no sólo el
texto del Dockerfile. Quedan el filesystem raíz de sólo lectura y los 380 MiB de
imagen, ambos con su razón anotada.

**DAT-001.** Las tablas vigentes están clasificadas y `test:rls-matrix` lo hace
vinculante: una tabla nueva no entra sin declarar su clase. Las 69 tablas
`por-usuario` ya tienen política y el rol runtime no puede asumir el migrador ni
saltear RLS. El acotamiento DML pasó de estimación a inventario ejecutable:
`test:runtime-write-scope` cruza código, upserts, candados, triggers y permisos
PostgreSQL. Las migraciones 116, 122, 123, 131, 132, 133, 134 y 135 reducen de
114 a **cero** los pares tabla/operación que nadie usa. La línea base queda en
cero y `test:grant-scope` impide recuperar `ON ALL TABLES` o sus defaults.

**NOT-001 y GEO-001.** Ambos pasaron de imposibles a implementados y con puerta
CI. `NOTIFICATION_PROVIDER` acepta `expo` y producción exige `EXPO_ACCESS_TOKEN`;
`MAPS_PROVIDER=openstreetmap` **hace fallar el arranque en producción** y existe
un adapter con Google Routes detrás. Desde la migración 136, la geocodificación
también emite una identidad breve ligada al usuario, persiste proveedor y
`place_id`, y el checkout de comida rechaza direcciones legacy o modificadas.

Los dos contratos se verifican con `fetch` interceptado, sin credenciales. Eso
prueba que el contrato es correcto, **no** que un push llegue a un teléfono ni
cuánto cuesta una consulta de rutas. Esa es la distancia entre `CI` y `PROV`, y
es lo que queda bloqueado por credenciales de proveedor.

**DSP-001.** La selección pasó a dos etapas y el recorte espacial existe por
primera vez. Queda medir el plan con `EXPLAIN ANALYZE` sobre un padrón
sintético, y el ETA vial, que depende de una API key.

**ARC-001.** El reformateo mecánico está hecho: la línea más larga bajó de 4.061
a 206 caracteres y las líneas largas de 1.543 a 262. Antes de eso hubo que
liberar a ocho contratos que afirmaban sobre texto fuente sin formatear, porque
bloqueaban el propio refactor que debían proteger.

La extracción empezó por el núcleo compartido, no por los grupos grandes:
`http/responses.js` (697 llamadas), `http/authorization.js` (81 usos, 10 reglas
ahora puras y con contrato propio) y `http/realtime.js` (43 publicaciones y el
registro de clientes SSE). El paso 5 cerró el núcleo con
`http/authentication.js`, `http/rate-limits.js` y `fallback-runtime.js`: los
routers dejaron de ser factories porque ya no queda nada que recibir.

Con el núcleo cerrado, cada grupo nuevo fue una extracción y nada más. **Los 57
grupos están extraídos**, repartidos en 31 routers, y `server/index.js` bajó de
9.696 a **873 líneas**: el 91 por ciento.

En web, `src/App.tsx` es el shell de sesión, auth y enrutado: catálogo, carrito,
checkout y viajes viven en `useCustomerCommerce`, y el chrome del phone-stage en
`AppChrome`. Las cinco audiencias se cargan por separado y el entry inicial se
mantiene en 67,7 KiB. En mobile, la sesión de Comidas vive en `useCustomerFood`.
El siguiente corte de ARC-001 son los clientes HTTP y los tipos divergentes,
no sumar condicionales al shell.
El primer corte interno web movió Wallet a `src/customer/WalletScreen.tsx`:
`CustomerSurface.tsx` bajó de 3.794 a **3.720 líneas** y una puerta fija el techo
en 3.725 sin cambiar la frontera sandbox del dinero.
El segundo movió Cuenta a `CustomerProfileScreen.tsx`, conservando perfil,
direcciones geocodificadas y preferencias alimentarias: el coordinador quedó en
**3.172 líneas** y el ratchet en 3.180. La segunda partición dejó perfil y
composición en 124 líneas, libreta geocodificada en 308 y dieta en 160, cada uno
con ratchet y API propietaria; ese límite ya satisface el criterio 7.
El tercer corte movió Actividad, su tarjeta común y los tres trackings a módulos
propios. `CustomerSurface.tsx` quedó en **2.166 líneas** con ratchet 2.185; las
hojas conservan ruta, ETA, PIN, safety, enlace compartible y evidencia. Chromium
abre las tres a 390 × 844 y crea el fixture ausente por la API real de envío,
con cotización firmada e idempotencia, en lugar de insertar datos de prueba.
El cuarto corte movió el formulario completo de Envíos a `ShipmentHome.tsx`
(567 líneas): opciones, geocoding, quote con vencimiento, protección, firma y
creación siguen en una sola frontera. El coordinador quedó en **1.617 líneas**,
con ratchet 1.635; Chromium abre la cotización compacta sin ejecutar dinero.
El quinto corte movió carrito, dirección, método, cotización, propina, horario,
resumen y confirmación a `FoodCartScreen.tsx` (680 líneas), con contador y estado
vacío bajo límites propios. `CustomerSurface.tsx` quedó en **914 líneas** y el
ratchet en 930. La matriz abre un carrito persistido a 390 × 844 y conserva la
quote firmada, Wallet y Card Payment Brick sin ejecutar un cobro productivo.
El sexto corte separó restaurante (85 líneas), componentes de catálogo (145) y
personalizador (101). `CustomerSurface.tsx` quedó en **598 líneas** con ratchet
610; `App.tsx` carga la hoja de producto directamente. Chromium recorre detalle,
extras, nota, cantidad y total a 390 × 844 sin agregar el producto ni escribir
datos.
El séptimo movió home, búsqueda, categorías, beneficios y listados a
`FoodDiscoveryHome.tsx` (119 líneas). `CustomerSurface.tsx` quedó en **459** con
ratchet 470. La portada dejó de depender de una imagen promocional fija: toma el
hero del catálogo activo, y Chromium confirma 4 restaurantes y 7 productos sin
overflow a 390 × 844.
El octavo llevó selector de servicio y navegación inferior a
`CustomerNavigation.tsx` (85 líneas), conservando flags y una Actividad común.
`CustomerSurface.tsx` quedó en **360 líneas** con ratchet 375 y sin la importación
muerta de `FlashMap`. La segmentación del cliente web está cerrada; ARC-001 no,
porque el paquete compartido y 256 líneas largas heredadas siguen pendientes.

Las 8 rutas que quedan no son dominio: salud, readiness, el documento OpenAPI,
el bootstrap por audiencia, las dos de métricas, el 410 que retiró `/api/state`
y el reset de la plataforma. El archivo es hoy el arranque, el middleware y el
montaje —lo que el ticket pedía que fuera—.
El paso 5 cerró el núcleo con `http/authentication.js` y `fallback-runtime.js`:
los tres routers dejaron de ser factories porque ya no queda nada que
recibir.

El segundo paso reveló el mismo defecto que el primero, en otra forma: un
contrato con un archivo hardcodeado **pierde cobertura en silencio** cuando la
extracción mueve el código. `test:realtime-audience` pasó de 43 a 37
publicaciones y siguió en verde. Un contrato acoplado a *dónde vive* el código
es tan frágil como uno acoplado a *cómo está escrito*, y falla peor.

El tercer paso dejó un criterio que conviene escrito, porque cambia cómo se
corta lo que falta: **un prefijo de URL no es un dominio**. `/api/admin` no
describe qué hace un grupo de rutas sino quién lo usa, y bajo ese prefijo
convivían gobernanza tarifaria, conciliación financiera, disparadores de colas,
propinas, moderación de cuentas y revisión de documentos. Extraerlo entero
habría producido un módulo tan mezclado como el archivo que se quiere partir.

Se cortó por ciclo de vida y salieron tres routers con sentido propio: tarifas
—que se proponen, se revisan y recién entonces rigen—, revisión financiera
—todo lo que actúa sobre plata que ya se movió, sin mover ninguna— y
disparadores de colas —lo que empuja trabajo diferido sin hacerlo—. `/api/admin`
pasó de 23 a 11 rutas. El mismo criterio encontró dos rutas que estaban en el
router equivocado: `PATCH /api/zones/:zoneId`, separada de su `GET` porque su
path no empieza con el prefijo del grupo al que pertenece, y las dos de payouts,
ochocientas líneas más abajo, entre rutas de viajes.

Los entrypoints por audiencia también están: `metro.config.js` resuelve la
pantalla según la variante y cada bundle lleva una sola, verificado empaquetando
las tres con `expo export`. Y `commerce-repository.js` se partió por dueño del
dato en catálogo, pedidos y plantel.

Los dos `App.tsx` ya son shells por debajo de 1.500 líneas. El acceso web pasó a
`auth/WebLogin.tsx`; `src/App.tsx` quedó en 1.286 líneas y Customer, Merchant,
Operaciones y Superadmin cargan por audiencia. La extracción interna
continúa por dominio: Actividad mobile pasó a `CustomerActivityScreen.tsx` con
grupos, sustituciones, servicios activos, comprobantes, repetición, reclamos y
propinas; las tres hojas de seguimiento pasaron a
  `CustomerTrackingSheets.tsx`; Cuenta pasó a `CustomerAccountScreen.tsx` sin
  perder estado de navegación ni el cableado de direcciones; y Envíos pasó a
  `CustomerShipmentScreen.tsx` con su cotización, ruta, opciones y solicitud
  reales. Ambos límites permanecen montados y comparten sólo el evento tipado de
  dirección. Viajes pasó a `CustomerRideScreen.tsx` con GPS, destinos, ruta,
  tarifa adelantada, reserva, contactos y solicitud persistida; un cambio de
  origen invalida el precio y las maniobras quedan sólo en Driver.
  Comidas se dividió luego en descubrimiento/búsqueda, restaurante/personalización,
  carrito, checkout y pedidos. Los modales de incidencias, devoluciones y siniestros
  también salieron a un límite tipado. `CustomerScreen.tsx` bajó de 6.241 a 908
  líneas al extraer la sesión de Comidas a `useCustomerFood`; el contrato fija el
  techo en 950. En web, Wallet salió de
  `CustomerSurface.tsx` a un límite propio y Cuenta siguió a
  `CustomerProfileScreen.tsx`; el coordinador quedó en 3.172 líneas y su ratchet
  en 3.180. También quedó activo un ratchet que impide que el
problema crezca:
`test:line-length` fija una línea base vigente de **0 líneas de más de 200
caracteres** y sólo admite bajarla (ya no hay margen).

Valores admitidos para **Estado**: `Pendiente` · `En curso` · `Bloqueado por externo` · `Cerrado`.

Un ticket sólo pasa a `Cerrado` cuando todos sus criterios de aceptación son verificables automáticamente o están respaldados por evidencia física adjunta al PR. `Bloqueado por externo` exige nombrar el proveedor, la gestión pendiente y la fecha de solicitud.

---

## 11. Definición de terminado

Aplica a cada PR de la Fase 0 en adelante, y complementa [`AGENTS.md`](../AGENTS.md).

1. La capacidad tiene una prueba automatizada proporcional a su riesgo.
2. Esa prueba corre en una puerta CI bloqueante, o el PR declara explícitamente por qué no puede.
3. La matriz de madurez refleja el estado real posterior al cambio.
4. La documentación afectada se actualiza en el mismo PR.
5. Ninguna capacidad dependiente de proveedor, habilitación o prueba física se marca como completa.
6. El PR no incrementa el tamaño de un archivo ya identificado como monolítico en H-08.
