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
2. Extraer features de los dos `App.tsx` hacia módulos por dominio.
3. Crear entrypoints separados customer, driver y merchant en mobile.
4. Descomponer `server/index.js` en controllers, separados de use cases y repositories.
5. Dividir `commerce-repository.js` por subdominio (catálogo, sucursales, stock, finanzas).
6. Crear contratos compartidos en un paquete propio.
7. Limitar cada archivo a una responsabilidad concreta.

### Criterios de aceptación

- [ ] Ningún `App.tsx` supera 1.500 líneas.
- [ ] Ningún archivo fuente contiene líneas de más de 200 caracteres.
- [ ] Ningún módulo de dominio importa React.
- [ ] El build de driver no incluye pantallas de comercio.
- [ ] El build de customer no incluye backoffice.
- [ ] `server/index.js` deja de contener lógica de dominio.

### Verificación

```bash
find src apps/mobile/src server -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" \) -exec awk 'length($0)>200 {print FILENAME": "FNR" ("length($0)" chars)"}' {} \;
```

Debe devolver vacío. Añadir este control como puerta en `ci-fast.yml`.

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

### Criterios de aceptación

- [x] Un PR queda bloqueado si falla cualquier suite crítica — 73 de 76 suites con puerta, 69 bloqueantes.
- [x] Ningún script de riesgo queda fuera de una puerta sin justificación escrita — lo verifica `npm run test:ci-coverage`.
- [ ] Cerrar las cuatro suites en cuarentena: `test:postgres`, `test:support-routing`, `test:dietary-local`, `test:notification-local`.
- [ ] `ci-nightly.yml` con Playwright, carga k6, restore drill y provider sandbox.
- [ ] La rama `main` está protegida y exige PR — **configuración manual en GitHub**.
- [ ] Pagos y seguridad exigen dos aprobaciones (`CODEOWNERS` ya existe; falta más de un revisor).
- [ ] Los artefactos de test se almacenan y son consultables tras el run.

### Verificación

```bash
node -e "const p=require('./package.json'),fs=require('fs');const ci=fs.readdirSync('.github/workflows').map(f=>fs.readFileSync('.github/workflows/'+f,'utf8')).join('');const out=Object.keys(p.scripts).filter(s=>s.startsWith('test:')&&!ci.includes('npm run '+s));console.log(out.length?'FUERA DE CI:\n'+out.join('\n'):'OK: toda suite de test está en CI')"
```

---

## SEC-001 — Realtime default-deny

**Prioridad:** P0 · **Hallazgo:** [H-03](auditoria-2026-08-25.md#h-03--realtime-hace-broadcast-a-todos-los-roles-ante-entidad-desconocida) · **Fase:** 0

### Contexto

`server/realtime-repository.js:8` y `:16` devuelven `allRoles` (admin + customer + merchant + driver) cuando el evento no tiene entidad o cuando el `entityType` no está contemplado. Es un patrón *fail-open*: cada tipo de entidad nuevo entra por defecto en el camino inseguro.

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
- [ ] Verificación de runtime de `resolveAudience` contra PostgreSQL con fixtures multiusuario. El contrato actual es estático.
- [ ] La métrica de eventos sin clasificar es visible en un dashboard. Existe la métrica y la alerta; falta el panel.

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
- [ ] Las cinco tablas de la deuda tienen política y prueba negativa. `user_roles` exige mover el login a `SECURITY DEFINER` primero.
- [ ] Eliminar el esquema muerto: `outbox_events` y `user_security_factors`.
- [ ] `FORCE ROW LEVEL SECURITY` donde corresponda — sigue en cero.
- [ ] Los grants dejan de ser `ON ALL TABLES`.

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
- [ ] Filesystem raíz de sólo lectura — necesita una corrida real para confirmar que nada escribe fuera del volumen montado.
- [ ] Reducir los 380 MiB de imagen moviendo las dependencias de frontend, **sin perderlas de la puerta de auditoría**.
- [ ] Existe SBOM y scan de imagen en el pipeline.

### Verificación

```bash
docker build -t flash:audit . && docker run --rm flash:audit id
```

No debe reportar `uid=0(root)`.

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
- [ ] Push real recibido en un dispositivo Android físico.
- [ ] Push real recibido en un dispositivo iOS físico.
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
- [ ] Ningún checkout usa una dirección ambigua sin validar — el `place_id` se conserva, falta usarlo en checkout.
- [ ] Ninguna tarifa productiva usa distancia geodésica como estimación final.
- [ ] Los costos por proveedor son visibles y tienen alerta de presupuesto.
- [ ] El fallback entre proveedores es auditable.
- [ ] Calidad real de rutas y costo por consulta con una API key habilitada.

---

## DSP-001 — Dispatch v2

**Prioridad:** P0 · **Hallazgo:** [H-06](auditoria-2026-08-25.md#h-06--dispatch-sin-recorte-espacial-previo) · **Fase:** 0–1

### Contexto

La consulta de candidatos calcula `ST_Distance`, carga activa y agregados de 30 días para cada conductor online del sistema. No hay `ST_DWithin` ni orden KNN `<->` en todo el repositorio.

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

Añadir además: oleadas de oferta · radio dinámico · protección contra inanición · prep time del comercio · dispatch manual desde backoffice · Route Matrix para el scoring.

### Criterios de aceptación

- [x] El recorte espacial y el orden KNN existen y están cubiertos por una puerta.
- [x] La reasignación automática funciona al expirar una oferta.
- [x] El desglose que explica cada score sigue disponible, ahora con el radio usado.
- [x] Cero dobles asignaciones bajo concurrencia forzada (`test:postgres`).
- [ ] El plan de consulta usa índice GiST, verificado con `EXPLAIN ANALYZE`.
- [ ] La primera oferta se emite dentro del SLO de 5 s p95.
- [ ] Existe una prueba de carga con un padrón sintético de al menos 1.000 conductores.
- [ ] ETA vial por Route Matrix conectado al scoring — depende de una API key.

---

## PAY-001 — Validación marketplace

**Prioridad:** P0 · **Hallazgo:** [H-09](auditoria-2026-08-25.md#h-09--mercado-pago-preparado-pero-no-validado) · **Fase:** 1

### Contexto

La integración con Mercado Pago está construida (OAuth PKCE, tokens cifrados, `application_fee`, idempotencia, refund, webhook, conciliación, ledger), pero `PAYMENT_MARKETPLACE_PROVIDER` está deshabilitado por defecto y nada fue probado contra el proveedor real.

### Trabajo

Sellers de test vinculados · OAuth completo · refresh y expiración probados · webhook firmado · pago · capture · refund · payout · reconciliation diaria · modelo de chargeback · caso de **saldo insuficiente del vendedor** · duplicados · timeouts · webhooks fuera de orden · procedimientos humanos para diferencias · validación fiscal y contractual.

### Criterios de aceptación

- [ ] El ledger queda balanceado tras cada operación.
- [ ] Un pago duplicado es idempotente y no genera doble asiento.
- [ ] Un reembolso proporcional se refleja correctamente en el split.
- [ ] Una diferencia de conciliación genera un caso operativo, no un error silencioso.
- [ ] La conciliación diaria corre automáticamente y su resultado es auditable.
- [ ] El caso de refund con saldo insuficiente del vendedor está modelado y probado.

### Nota de alcance

**No se avanza hacia wallet custodial.** El dinero real permanece en el PSP; Flash mantiene un ledger de representación; los créditos Flash son promocionales y no retirables. Ver la sección 4.7 de la auditoría y la nota del BCRA.

---

## MOB-001 — Release engineering

**Prioridad:** P0 · **Fase:** 1

### Trabajo

Perfiles EAS preview y production · signing · TestFlight · internal testing · crash reporting · política OTA · versión mínima · upgrade forzado · deep links · device integrity.

### Criterios de aceptación

- [ ] Existen tres binarios internos instalables: customer, driver y merchant.
- [ ] Un crash es visible en Sentry con símbolos resueltos.
- [ ] El rollback fue probado.
- [ ] Los permisos de ubicación se explican correctamente al usuario en ambas plataformas.
- [ ] Background location fue probada en dispositivos físicos con development build, no en Expo Go.

---

## OPS-001 — Operación real

**Prioridad:** P1 · **Fase:** 2

### Trabajo

Case ownership · SLA · escalation · aprobación de refunds · suspensión de drivers · suspensión de comercios · excepciones de pago · intervención de dispatch · runbooks · traspaso de turno.

### Criterios de aceptación

- [ ] Ningún incidente requiere ejecutar SQL manual.
- [ ] Toda acción operativa registra actor y motivo.
- [ ] Los tickets críticos escalan automáticamente al vencer su SLA.
- [ ] Existen dashboards por cola de trabajo.

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

| Ticket | Descripción |
| --- | --- |
| **OBS-002** | Colector, dashboards y Alertmanager administrados; paging productivo |
| **RT-002** | Insertar el evento realtime en la misma transacción de dominio mediante outbox |
| **RT-003** | WebSocket para presencia bidireccional, chat y tracking de alta frecuencia |
| **SAF-002** | Safety Operating System: detección de anomalías, incident command, llamadas enmascaradas |
| **DAT-002** | Rotación de claves y migración a KMS/HSM o Secret Manager administrado |
| **SEC-002** | Pentest externo y revisión de seguridad independiente |
| **QC-001** | Quick commerce, picking e inventario masivo — **no antes de la Fase 4** |
