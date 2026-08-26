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
| Protección de rama y CODEOWNERS | CI-001 | `CODEOWNERS` **hecho**; la protección de rama es configuración manual en GitHub, **pendiente** |
| ~~Matriz de madurez inicial~~ **hecho** | — | 91 capacidades clasificadas y actualizadas en cada entrega |

#### Semana 2 (1–7 de septiembre) — Cobertura de riesgo

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| ~~`ci-critical-flows.yml`~~ **hecho** | CI-001 | Pagos, ledger, webhooks, conciliación, KYC, soporte y safety bloquean el merge · 4 suites en cuarentena |
| ~~Matriz formal de cobertura RLS~~ **hecho** | DAT-001 | Las 106 tablas clasificadas y con puerta CI; `FORCE ROW LEVEL SECURITY` sigue pendiente |
| Pruebas negativas por rol | DAT-001 | Cada tabla con datos por usuario tiene un test que demuestra denegación |
| Vitest + Testcontainers | CI-001 | Framework estándar adoptado; primeras suites migradas |

#### Semana 3 (8–14 de septiembre) — Proveedores reales

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| `NOTIFICATION_PROVIDER=expo` | NOT-001 | Push llega a un dispositivo físico Android y iOS |
| Receipts y device invalidation | NOT-001 | `DeviceNotRegistered` revoca el token; receipt ausente genera alerta |
| Adapter `MapsProvider` | GEO-001 | Autocomplete, geocode, route y route matrix detrás de una interfaz |
| Proveedor comercial conectado | GEO-001 | Ninguna tarifa productiva usa distancia geodésica como estimación final |

#### Semana 4 (15–20 de septiembre) — Modularización y cierre

| Entregable | Ticket | Criterio de cierre |
| --- | --- | --- |
| Separación de `src/App.tsx` | ARC-001 | Ningún `App.tsx` supera 1.500 líneas |
| Separación de `apps/mobile/App.tsx` | ARC-001 | Entrypoints customer/driver/merchant independientes |
| Descomposición de `server/index.js` | ARC-001 | Controllers separados de use cases y repositories |
| Reformateo de archivos comprimidos | ARC-001 | Ninguna línea de código fuente supera 200 caracteres |
| Dispatch v2 etapa 1 | DSP-001 | `ST_DWithin` + KNN recortan candidatos antes del scoring |
| SLOs documentados | — | Objetivos técnicos de la auditoría publicados y medibles |

### Criterios de salida de la Fase 0

La fase no se declara cerrada hasta que **todos** estos puntos sean verificables por un tercero:

- [x] Ningún merge a `main` evita PostgreSQL/PostGIS en CI.
- [x] Ningún recurso de realtime con entidad desconocida se transmite a todos los roles.
- [ ] Un push real llega a un dispositivo físico Android y a uno iOS.
- [ ] Una cotización productiva se calcula con ruta vial de un proveedor comercial.
- [x] La imagen de producción corre como usuario no privilegiado y usa `server/start.js`.
- [ ] El build de cada variante mobile (customer, driver, merchant) funciona por separado.
- [ ] Cero credenciales demo en cualquier ambiente desplegado.
- [~] La suite crítica está verde y es bloqueante, con **4 suites declaradas en cuarentena** que corren sin bloquear.
- [x] La matriz de madurez está publicada y ningún ítem del README la contradice.
- [ ] Ningún archivo fuente supera 1.500 líneas ni contiene líneas de más de 200 caracteres.

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
| `ci-postgres.yml` | Cada PR | PostgreSQL/PostGIS · migraciones desde cero · migraciones desde snapshot anterior · RLS · audit chain · runtime smoke · city isolation · idempotencia |
| `ci-critical-flows.yml` | Cada PR | Pago · webhook · refund · ledger · dispatch · reconciliation · KYC · support SLA · safety |
| `ci-nightly.yml` | Cada noche | Playwright E2E · performance · load · provider sandbox · restore drill · dependency scan completo · mobile build preview |

---

## 10. Seguimiento

Estado al **25 de agosto de 2026**. Se actualiza en el PR que cambia el estado, nunca en un PR aparte.

| Ticket | Prioridad | Hallazgo | Estado | Fase |
| --- | --- | --- | --- | --- |
| [SEC-001](backlog-tecnico.md#sec-001--realtime-default-deny) | P0 | H-03 | **En curso** | 0 |
| [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo) | P0 | H-01 | **En curso** | 0 |
| [ARC-001](backlog-tecnico.md#arc-001--modularización) | P0 | H-08 | **En curso** | 0 |
| [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny) | P0 | H-04 | **En curso** | 0 |
| [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida) | P0 | H-05 | **En curso** | 0 |
| [NOT-001](backlog-tecnico.md#not-001--push-real) | P0 | H-02 | Pendiente | 0 |
| [GEO-001](backlog-tecnico.md#geo-001--proveedor-de-mapas-comercial) | P0 | H-07 | Pendiente | 0 |
| [DSP-001](backlog-tecnico.md#dsp-001--dispatch-v2) | P0 | H-06 | Pendiente | 0–1 |
| [PAY-001](backlog-tecnico.md#pay-001--validación-marketplace) | P0 | H-09 | Pendiente | 1 |
| [MOB-001](backlog-tecnico.md#mob-001--release-engineering) | P0 | — | Pendiente | 1 |
| [OPS-001](backlog-tecnico.md#ops-001--operación-real) | P1 | — | Pendiente | 2 |
| [INT-001](backlog-tecnico.md#int-001--pos-y-api) | P1 | — | Pendiente | 3 |

### Detalle de lo que está en curso — 26 de agosto de 2026

> **Las tres puertas están en verde.** 73 de 76 suites detrás de una puerta, 69 bloqueantes. Antes de esta entrega, `main` llevaba en rojo desde el 23 de agosto sin que nadie estuviera bloqueado — la prueba práctica de H-01: una puerta que existe pero no se hace cumplir no protege nada.

**SEC-001.** El fallback fail-open está eliminado. La política de audiencias vive
ahora en `server/realtime-audience.js`, un módulo sin dependencias, y una entidad
desconocida llega solamente a `admin`. Se descubrió que el defecto era mayor que
lo estimado: **13 de las 44 publicaciones realtime difundían a todos los roles**,
entre ellas las seis del libro de direcciones. `test:realtime-audience` bloquea el
merge y se verificó que falla ante el defecto. Falta la verificación de runtime
contra PostgreSQL y el dashboard de la métrica.

**CI-001.** `ci.yml` se dividió en **tres workflows y los cinco jobs están en
verde**. La cobertura pasó de **15 a 73 de 76 suites** detrás de una puerta, 69
de ellas bloqueantes. `ci-critical-flows.yml` levanta la API contra PostgreSQL y
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

Faltan `ci-nightly.yml`, cerrar las **cuatro suites en cuarentena** y la
protección de rama, que es configuración manual en GitHub.

**INF-001.** La imagen es multi-etapa, corre como `uid=999(flash)`, arranca el
entrypoint instrumentado y no lleva devDependencies ni el árbol de fuentes. El
job `container-image` la construye en cada PR y verifica el resultado, no sólo el
texto del Dockerfile. Quedan el filesystem raíz de sólo lectura y los 380 MiB de
imagen, ambos con su razón anotada.

**DAT-001.** Las 106 tablas están clasificadas y `test:rls-matrix` lo hace
vinculante: una tabla nueva no entra sin declarar su clase. La clasificación
destapó que `user_roles` se lee antes de autenticar —una política ingenua ahí
rompe todo login— y que hay dos tablas de esquema muerto, una de ellas con
forma de almacén de credenciales. Quedan cinco tablas sin política, `FORCE` en
cero y los grants todavía `ON ALL TABLES`.

**ARC-001.** Todavía no empezó la modularización. Sí quedó activo un ratchet que
impide que el problema crezca: `test:line-length` fija una línea base de **1.543
líneas de más de 200 caracteres en 120 archivos** y sólo admite bajarla.

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
