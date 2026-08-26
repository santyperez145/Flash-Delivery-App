# Auditoría integral — 25 de agosto de 2026

Documento de referencia. Sustituye las puntuaciones históricas de auditorías anteriores y es la base del [`docs/plan-de-accion.md`](plan-de-accion.md) y del [`docs/backlog-tecnico.md`](backlog-tecnico.md).

Convención de evidencia:

- **[V]** Verificado en este repositorio, con archivo y línea reproducibles.
- **[E]** Evaluación técnica o de producto. Es un juicio, no una métrica generada por el código.
- **[X]** Externo: depende de un proveedor, de una habilitación o de una prueba física todavía ausente.

---

## 1. Dictamen ejecutivo

Flash ya no debe clasificarse como maqueta ni como MVP visual. Tiene componentes propios de una **plataforma pre-beta con intención productiva**: PostgreSQL/PostGIS, Redis, sesiones rotativas, MFA administrativo, RBAC y RLS, idempotencia, ledger, conciliación, dispatch geoespacial, ofertas con expiración y aceptación atómica, realtime persistente, KYC, soporte con SLA, chat operativo, protección de envíos, integración preparada con Mercado Pago, apps Expo diferenciadas, background location, feature flags y auditoría encadenada criptográficamente.

Existe una diferencia crítica entre cuatro estados, y hoy sólo dos están cubiertos:

| Estado | Situación |
| --- | --- |
| 1. Capacidad modelada en código | **Fuerte** |
| 2. Integración técnicamente preparada | **Fuerte** |
| 3. Capacidad probada en staging con proveedores reales | **Insuficiente** |
| 4. Capacidad operada con usuarios, dinero y soporte real | **Ausente** |

### Conclusión central

Flash es hoy una **plataforma avanzada de preproducción**. Es apta para demo a inversores, desarrollo interno, staging serio y prueba cerrada y controlada de delivery una vez resueltos los P0.

No está aprobada para lanzamiento público irrestricto, custodia de saldo real, miles de pagos sin supervisión, transporte público de pasajeros, operación multiciudad, ni para prometer una confiabilidad equivalente a Uber o PedidosYa.

La prioridad ya no es agregar funcionalidades. Es **reducir complejidad, validar producción, conectar proveedores reales, probar concurrencia, operar una zona y demostrar liquidez**.

> El riesgo principal ya no es que el producto sea demasiado simple. Es el contrario: **Flash tiene más superficie funcional de la que hoy puede validar, mantener y operar de manera confiable.**

---

## 2. Evaluación por área

Puntuaciones **[E]**. No son métricas generadas por el repositorio.

| Área | Nota | Diagnóstico |
| --- | ---: | --- |
| Alcance funcional | **8,2/10** | Cobertura muy amplia de comida, movilidad, envíos, comercios, drivers y operaciones |
| Modelo de dominio | **7,5/10** | Entidades y flujos avanzados |
| Persistencia y datos | **7,2/10** | PostgreSQL/PostGIS, 110 migraciones, RLS, idempotencia y auditoría |
| Seguridad arquitectónica | **7,3/10** | Buena base; faltan pentest, revisión externa y endurecimiento completo |
| Pagos y contabilidad | **6,5/10** | Ledger, conciliación y Mercado Pago modelados; falta operación real |
| Dispatch y geoespacial | **6,0/10** | Real y transaccional, pero necesita optimización y routing comercial |
| Aplicaciones móviles | **5,2/10** | Expo, variantes y background location; arquitectura interna monolítica |
| Realtime y notificaciones | **5,5/10** | Realtime razonable; push productivo no existe |
| CI y evidencia de calidad | **4,5/10** | Muchos scripts, pero CI ejecuta una fracción de la matriz crítica |
| Mantenibilidad | **3,5/10** | Archivos gigantes y alta concentración de responsabilidades |
| Operación de ciudad | **4,0/10** | Backoffice amplio, sin prueba de operación humana sostenida |
| Seguridad física de viajes | **3,0/10** | Existen funciones; falta sistema operativo real de safety |
| Escalabilidad demostrada | **3,5/10** | Arquitectura plausible, sin evidencia de carga productiva |
| Preparación para beta delivery | **6,0/10** | Viable tras un sprint fuerte de estabilización |
| Preparación para viajes públicos | **3,0/10** | Requiere legal, seguros, safety 24/7 y validación operativa |
| **Evaluación global** | **6,2/10** | **Pre-beta avanzada, todavía no plataforma pública madura** |

---

## 3. Hallazgos verificados

Esta es la sección accionable. Cada hallazgo tiene evidencia reproducible en este repositorio.

### H-01 · CI no ejecuta el 86% de su propia matriz de pruebas

*Evidencia: [V]*

`package.json` declara **104 scripts**; `.github/workflows/ci.yml` ejecuta **15**. Quedan **89 fuera de toda puerta de merge**, incluidos los que cubren el núcleo de riesgo:

`test:postgres`, `test:rls`, `test:audit-immutability`, `test:sensitive-data`, `test:mfa`, `test:payment-reconciliation`, `test:marketplace-ledger`, `test:mercadopago-payment`, `test:mercadopago-webhook`, `test:payment-oauth`, `test:driver-kyc`, `test:driver-vehicles`, `test:ride-safety`, `test:city-isolation`, `test:support-sla`, `test:transaction-risk`, `test:payout-review`, `test:maps`.

Causa raíz: **CI no levanta PostgreSQL/PostGIS**. El workflow sólo declara un servicio Redis, así que ninguna suite que necesite base de datos puede correr.

Reproducir:

```bash
node -e "const p=require('./package.json'),ci=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const s=Object.keys(p.scripts);console.log(s.length,'declarados /',s.filter(x=>ci.includes('npm run '+x)).length,'en CI')"
```

Consecuencia: el repositorio puede tener 104 scripts, pero sin puertas bloqueantes **no existe garantía continua** sobre migraciones, RLS, pagos, ledger, webhooks, refunds, dispatch, KYC, safety, soporte ni aislamiento por ciudad. Una regresión en cualquiera de esos caminos entra a `main` sin resistencia.

**Severidad: P0.** Ticket [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo).

---

### H-02 · Push productivo es imposible por configuración

*Evidencia: [V]*

`server/config.js:26`:

```js
NOTIFICATION_PROVIDER: z.enum(["disabled","sandbox"]).default("sandbox"),
```

`server/config.js:98`:

```js
if(env.NODE_ENV==="production"&&env.NOTIFICATION_PROVIDER==="sandbox")
  throw new Error("NOTIFICATION_PROVIDER sandbox is forbidden in production");
```

El enum admite exclusivamente `disabled` y `sandbox`, y producción prohíbe `sandbox`. El único valor válido en producción es `disabled`. Además `server/notification-repository.js:465` envía a dead-letter cualquier proveedor distinto de `sandbox`.

Es decir: **no existe hoy ningún proveedor de push productivo funcional, y el esquema de configuración lo impide por construcción.** El outbox, los reintentos, el dedupe, el dead-letter y el replay administrativo están bien construidos, pero no tienen a dónde entregar.

**Severidad: P0.** Ticket [NOT-001](backlog-tecnico.md#not-001--push-real).

---

### H-03 · Realtime hace broadcast a todos los roles ante entidad desconocida

*Evidencia: [V]*

`server/realtime-repository.js:7-17`:

```js
const allRoles=["admin","customer","merchant","driver"];

async function resolveAudience(entityType,entityId){
  if(!entityType||!entityId)return{users:[],roles:allRoles};   // línea 8
  ...
  return{users:[],roles:allRoles};                              // línea 16
}
```

Hay dos caminos que devuelven `allRoles`: evento sin entidad (línea 8) y **entidad no reconocida** (línea 16). El segundo es el peligroso: un `entityType` nuevo, mal escrito o no contemplado convierte un error de clasificación en un broadcast a clientes, comercios y conductores.

El contenido del evento es deliberadamente pobre (tipo, entidad, acción, requestId, timestamp) y la app revalida contra un recurso autorizado, lo que limita el daño real. Pero el patrón es *fail-open*, y cada `entityType` que se agregue en el futuro entra por defecto en el camino inseguro.

Debe ser:

```text
Entidad conocida    → participantes + admin
Entidad desconocida → solamente admin
Sin entidad         → audiencia explícita obligatoria
```

Nunca `unknown → customer + merchant + driver + admin`.

**Severidad: P0.** Ticket [SEC-001](backlog-tecnico.md#sec-001--realtime-default-deny).

---

### H-04 · 20 tablas sin política RLS y cero `FORCE ROW LEVEL SECURITY`

*Evidencia: [V]*

Medición sobre `database/migrations/`:

| Métrica | Valor |
| --- | ---: |
| Tablas creadas | 106 |
| Tablas con `ENABLE ROW LEVEL SECURITY` | 86 |
| **Tablas sin política RLS** | **20** |
| Sentencias `FORCE ROW LEVEL SECURITY` | **0** |

Tablas sin RLS:

```text
audit_events            catalog_items          drivers                idempotency_keys
ledger_accounts         ledger_entries         ledger_transactions    merchants
notification_deliveries outbox_events          pricing_plans          promotion_redemptions
promotions              realtime_events        referral_campaigns     service_zones
shipment_details        user_roles             user_security_factors  webhook_events
```

Algunas son legítimamente globales (`pricing_plans`, `promotions`, `service_zones`, `referral_campaigns`, `catalog_items`) o append-only de servicio (`audit_events`, `outbox_events`). Pero otras contienen datos por usuario y no deberían depender sólo de la capa de aplicación: **`user_roles`, `user_security_factors`, `ledger_entries`, `ledger_transactions`, `ledger_accounts`, `notification_deliveries`, `realtime_events`, `shipment_details`, `webhook_events`, `idempotency_keys`**.

Esto se agrava con el grant de `database/docker-init`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flash_runtime;
```

El rol de runtime tiene DML sobre **todas** las tablas. Donde no hay política RLS, la única barrera es el código de aplicación. Un bug de ownership en un handler equivale a exposición total de esa tabla.

`FORCE ROW LEVEL SECURITY` en cero significa además que, si el propietario de la tabla llegara a ejecutar consultas, las políticas no se le aplicarían.

Reproducir:

```bash
grep -rhoiE "CREATE TABLE (IF NOT EXISTS )?[a-zA-Z_]+" database/migrations/ | sed -E 's/CREATE TABLE //I; s/IF NOT EXISTS //I' | tr 'A-Z' 'a-z' | sort -u > /tmp/tables.txt
grep -rhoiE "ALTER TABLE [a-zA-Z_]+ ENABLE ROW LEVEL SECURITY" database/migrations/ | awk '{print tolower($3)}' | sort -u > /tmp/rls.txt
comm -23 /tmp/tables.txt /tmp/rls.txt
```

No se afirma que exista una fuga explotable hoy: se afirma que **no existe evidencia de cobertura** y que el modelo no es *default deny*. Cada tabla nueva debe entrar en una matriz obligatoria con pruebas negativas por rol.

**Severidad: P0.** Ticket [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny).

---

### H-05 · La imagen Docker no corresponde al arranque real y corre como root

*Evidencia: [V]*

`Dockerfile` completo:

```dockerfile
FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
...
CMD ["node", "server/index.js"]
```

Problemas concretos:

1. **Una sola etapa.** Dependencias de desarrollo quedan en la imagen productiva; no hay `npm prune --omit=dev`.
2. **Copia todo el repositorio** en lugar de los artefactos necesarios.
3. **Corre como root.** No hay `USER`.
4. **Entrypoint divergente.** `CMD` usa `server/index.js`, pero `package.json` define `start` como `node --env-file-if-exists=.env.local server/start.js`. `docker-compose.yml` sobrescribe el comando y sí usa `server/start.js`.

El punto 4 es el más insidioso: **la imagen por sí sola y la imagen dentro de Compose no tienen el mismo comportamiento**. Todo lo que `server/start.js` instrumenta (telemetría, apagado ordenado, readiness) se pierde si alguien despliega la imagen tal cual.

`scripts/container-security-smoke.mjs` existe y corre en CI, pero valida principalmente roles de PostgreSQL: no valida usuario Linux, capabilities, seccomp ni filesystem de sólo lectura.

**Severidad: P0.** Ticket [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida).

---

### H-06 · Dispatch sin recorte espacial previo

*Evidencia: [V]*

`server/dispatch-repository.js:7-30`. La consulta de candidatos calcula, **para cada conductor online del sistema**:

- `ST_Distance(d.current_location, j.pickup_location)` — tres veces en la misma fila (distancia, penalización y score).
- `count(*)` de trabajos activos vía `CROSS JOIN LATERAL`.
- Tasa de aceptación de 30 días y tiempo medio de respuesta vía `LEFT JOIN LATERAL` sobre `dispatch_offers`.

No hay `ST_DWithin` para recortar el conjunto, ni orden KNN `<->` para aprovechar el índice GiST. Verificado: **cero ocurrencias de `ST_DWithin` y cero de `<->` en todo el repositorio.**

```bash
grep -rn "ST_DWithin\|<->" server/ database/ | wc -l   # → 0
```

Con decenas de conductores esto es irrelevante. Con cientos o miles por ciudad, cada oleada de ofertas recalcula historial de 30 días para todo el padrón online. El costo crece justo cuando la plataforma empieza a funcionar.

**Severidad: P0.** Ticket [DSP-001](backlog-tecnico.md#dsp-001--dispatch-v2).

---

### H-07 · Proveedores de mapas públicos por defecto

*Evidencia: [V]*

`server/config.js:42-44` y `.env.example:36-41`:

```js
GEOCODING_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
ROUTING_URL:   z.string().url().default("https://router.project-osrm.org"),
WEB_MAP_ORIGINS: z.string().default("https://tile.openstreetmap.org")
```

Aceptable para desarrollo, inaceptable para una plataforma comercial. La política de uso de Nominatim prohíbe autocomplete de cliente contra la instancia pública y advierte expresamente a aplicaciones comerciales que no dependan de ella. Lo mismo aplica al demo público de OSRM y a los tiles de openstreetmap.org.

Además, sin routing vial real, cualquier tarifa calculada con distancia geodésica es una estimación que el cliente percibirá como incorrecta en cuanto el trayecto tenga un río, una vía de un solo sentido o una autopista.

Ya existen caché (`GEOCODING_CACHE_TTL_SECONDS`, `ROUTING_CACHE_TTL_SECONDS`), circuit breaker y presupuesto, que es la mitad difícil del trabajo. Falta el proveedor.

**Severidad: P0.** Ticket [GEO-001](backlog-tecnico.md#geo-001--proveedor-de-mapas-comercial).

---

### H-08 · Concentración monolítica extrema

*Evidencia: [V]*

| Archivo | Bytes | Líneas | Línea más larga |
| --- | ---: | ---: | ---: |
| `apps/mobile/App.tsx` | 433.280 | 5.695 | **4.061** |
| `src/App.tsx` | 360.467 | 9.957 | 1.791 |
| `server/index.js` | 338.114 | 9.432 | — |
| `src/styles.css` | 119.082 | 4.561 | — |
| `server/commerce-repository.js` | 67.486 | 612 | **2.655** |
| `server/store.js` | 65.967 | 2.019 | — |
| `server/openapi.js` | 61.243 | — | — |
| `src/api.ts` | 48.496 | — | — |
| `server/mobility-repository.js` | 43.436 | — | 1.836 |
| `server/auth-repository.js` | 30.138 | 287 | 1.563 |

Dos observaciones que agravan el diagnóstico habitual:

1. **`server/index.js` con 338 KB** es el archivo central y no figura en los inventarios de deuda previos. Es tan crítico como los dos `App.tsx`.
2. **El código está comprimido en líneas larguísimas.** `commerce-repository.js` tiene 612 líneas para 67 KB: funciones completas en una sola línea de hasta 2.655 caracteres. `apps/mobile/App.tsx` llega a 4.061 caracteres en una línea. Esto no es un problema estético: hace que cualquier diff sea ilegible, que un conflicto de merge sea irresoluble, que `git blame` no aporte información y que una revisión de seguridad sea impracticable.

Consecuencias: conflictos de merge, ownership imposible, pruebas frágiles, alto riesgo de regresión, sin lazy loading, sin separación por audiencia, onboarding lentísimo y **imposibilidad práctica de escalar el equipo**.

**Severidad: P0.** Ticket [ARC-001](backlog-tecnico.md#arc-001--modularización).

---

### H-09 · Mercado Pago preparado pero no validado

*Evidencia: [V] + [X]*

Lo que existe y está bien construido: OAuth con PKCE S256, estados de autorización, tokens cifrados con rotación automática, `application_fee`, idempotency key, creación de pago, refund, lectura del recurso del proveedor, webhook firmado, conciliación estricta, ledger y revisión de payouts. `server/payment-marketplace-provider.js` son 11.942 bytes de integración real.

Lo que falta es la mitad que no se puede escribir en código: `PAYMENT_MARKETPLACE_PROVIDER` está deshabilitado por defecto, no hay cuentas de vendedor de prueba vinculadas, no hay credenciales productivas, no se probaron expiración ni rotación de OAuth contra el proveedor, no se simularon duplicados/timeouts/webhooks fuera de orden contra el sandbox real, no hay conciliación diaria operada, no existen procedimientos humanos para diferencias, no se probó refund con saldo insuficiente del vendedor y no está validado el tratamiento fiscal ni contractual.

Restricción conocida del modelo Split Payments 1:1 de Mercado Pago: los refunds tienen limitaciones cuando el vendedor no dispone de fondos suficientes. Ese caso debe modelarse y probarse antes de la beta, no descubrirse en producción.

**Severidad: P0.** Ticket [PAY-001](backlog-tecnico.md#pay-001--validación-marketplace).

---

### H-11 · Una base creada desde cero no es equivalente a una migrada

*Evidencia: [V]* — descubierto el 26 de agosto al levantar PostgreSQL en CI por primera vez.

**Ocho migraciones hacen backfill de datos derivados de filas que ya existían** cuando se aplicaron:

| Migración | Tabla | Deriva de |
| --- | --- | --- |
| `041_merchant_branches` | `merchant_branches` | Comercios |
| `047_driver_kyc` | `driver_compliance` | Conductores |
| `053_wallet_payment_methods` | `payment_methods` | Usuarios |
| `057_catalog_modifiers` | `catalog_modifier_groups`, `catalog_modifiers` | `merchants.metadata->extras` |
| `059_catalog_dietary_allergens` | `catalog_item_allergens`, `catalog_item_dietary_labels` | Ítems de catálogo |
| `084_support_assignment_escalation` | `support_agent_profiles` | Usuarios con rol admin/support |
| `087_driver_vehicle_registry` | `vehicles` | Conductores |
| `107_driver_operational_sessions` | `driver_availability_sessions`, `driver_job_sessions` | Conductores y trabajos |

En una base creada desde cero **el orden se invierte**: las migraciones corren antes que los seeds, así que las ocho tablas quedan vacías. Un ambiente nuevo no equivale a uno migrado en su momento.

No es un problema exclusivo de CI: **un primer despliegue productivo arrancaría sin sucursales, sin vehículos aprobados y sin métodos de pago wallet.** El dispatch exige `vehicle.status='approved'`, así que ningún conductor sería elegible.

Reproducir:

```bash
npm run db:migrate && npm run db:seed:auth && npm run db:seed:commerce
psql "$DATABASE_URL" -c "SELECT count(*) FROM catalog_modifiers"   # → 0 sin db:seed:derived
```

Se descubrió porque `test:rls` afirma sobre modificadores de catálogo y alérgenos, y falló en la primera corrida desde cero.

### Segunda cara del mismo hallazgo: nadie podía iniciar sesión

El escaneo inicial buscó backfills de la forma `INSERT ... SELECT` y por eso omitió los que usan `UPDATE`. Hay 23, y la mayoría son guardas `WHERE ... IS NULL` sobre identificadores que las filas nuevas ya traen. Dos importan, y una es devastadora:

`052_email_verification.sql`:

```sql
UPDATE users SET email_verified_at=COALESCE(email_verified_at,created_at);
```

Verifica el email de los usuarios que existían al aplicarse. En una base desde cero los seeds corren después, así que **todas las cuentas quedan sin verificar y la API rechaza cualquier login** con «Debes verificar tu email». La plataforma entera queda inaccesible.

Se descubrió al levantar `ci-critical-flows` por primera vez: **28 de 32 suites fallaron por esta única causa.**

**Corregido** con `npm run db:seed:derived`, que repite las mismas derivaciones de forma idempotente, incluida la verificación de email. **La deuda pendiente** es que la reproducibilidad no está garantizada hacia adelante: cada migración futura que haga backfill sobre datos existentes vuelve a introducir el problema. Debe entrar en la definición de terminado de [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny).

**Severidad: P0.**

---

### H-10 · Documentación desalineada del runtime

*Evidencia: [V]*

Ejemplos detectados:

- `ROADMAP.MD` afirma repetidamente «migraciones hasta `105`». El repositorio tiene **110** (`database/migrations/110_merchant_prep_acceptance_clock.sql`).
- `docs/investor-readiness.md` (fecha base 14 de agosto) describe el producto como «MVP fullstack» y lista como gap «Postgres/PostGIS», que ya está operativo hace tiempo.
- `docs/deployment-checklist.md` (fecha base 14 de agosto) todavía trata SQLite como preocupación de despliegue.
- `docs/ci-security-gates.md` describe CI como «build/smoke, typecheck mobile, `test:secrets` y `test:dependency-gate`», omitiendo que hay 89 suites fuera de la puerta.

Un roadmap que sobreestima el estado es tan peligroso como un bug: es la base sobre la que se toman decisiones de lanzamiento.

**Severidad: P1.** Resuelto parcialmente por esta entrega.

---

## 4. Qué tiene Flash realmente

### 4.1 Producto multiaudiencia

El repositorio separa conceptualmente cliente, comercio, conductor/repartidor, operaciones, administración, soporte y auditoría. El antiguo endpoint de estado global fue retirado y reemplazado por bootstraps específicos (`/api/bootstrap/customer|merchant|driver|operations`) y recursos paginados para actividad, comercios, drivers, usuarios, soporte y auditoría. Esto corrige uno de los problemas de privacidad más graves de la arquitectura anterior. [V]

**Cliente:** registro, login, recuperación de contraseña, verificación de correo y teléfono, sesiones remotas, direcciones guardadas, preferencias alimentarias, favoritos, catálogo, carrito, modificadores, checkout, cotización de comida, pedido, sustituciones, incidencias, reembolsos parciales, viajes, viajes programados, envíos, tracking, chat, propinas, notificaciones, soporte, wallet y movimientos, referidos.

**Comercio:** comercios y sucursales, ubicación geoespacial, apertura y pausa, horarios, ETA, menú, categorías, productos, modificadores, alérgenos, stock por sucursal, flujo de cocina, sustituciones, incidencias, reintegros, finanzas, balance, movimientos, retiros, revisión de payouts, integración marketplace con Mercado Pago, dashboard operativo.

**Conductor/repartidor:** disponibilidad online/offline, modalidades de trabajo, preferencias, vehículos con revisión independiente, KYC, documentación y vencimientos, ganancias, tiempo operativo, zonas de demanda, ubicación foreground y background, ofertas privadas, aceptación o rechazo, capacidad máxima por modalidad, avance de estados, PIN, contactos de confianza, seguimiento, evidencia de entrega.

**Operaciones:** usuarios, conductores, comercios, trabajos, pedidos, viajes, envíos, zonas, promociones, soporte, routing de tickets, SLA, escalaciones, riesgo transaccional, conciliación, refunds, payouts, auditoría, feature flags, analítica, readiness por ciudad, moderación de cuentas, revisión de KYC y vehículos, revisión financiera.

La amplitud funcional ya es comparable conceptualmente con la suma de varios productos: marketplace, mobility platform, merchant OS, driver OS y operations command center. **El problema no es falta de visión; es convertir ese alcance en una operación confiable.**

### 4.2 Backend

Node.js, Express, JavaScript ESM, Zod, PostgreSQL, PostGIS, Redis, JWT, bcrypt, OpenTelemetry, Nodemailer, Mercado Pago, MapLibre y workers independientes ejecutados mediante scripts.

La estrategia correcta es **mantener el monolito modular durante la beta**. No conviene migrar a microservicios ahora. Cambiar Express por NestJS o Fastify no resolvería por sí mismo ninguno de los riesgos identificados; el retorno de inversión está en TypeScript, modularización, contratos, tests, observabilidad, proveedores reales y menos acoplamiento.

Arquitectura objetivo por capa:

```text
Controller
   ↓
Application service / use case
   ↓
Domain policy / state machine
   ↓
Repository interface
   ↓
PostgreSQL / proveedor externo
```

### 4.3 Aislamiento y auditoría

El runtime prepara contexto transaccional por usuario y rol, y verifica rol de ejecución, propiedad del esquema, ausencia de `BYPASSRLS`, contextos `app.user_id` y `app.roles`, y separación entre migrador, runtime y auditor. [V]

La auditoría incorpora append-only enforcement, hash anterior, hash del evento, SHA-256, advisory locks y verificación de integridad de la cadena. [V]

Falta: matriz formal de cobertura RLS (H-04), `FORCE ROW LEVEL SECURITY`, pruebas negativas por rol en cada migración nueva, revisión específica de permisos de soporte, política formal de retención, separación de datos sensibles y operativos, rotación de claves, KMS/HSM o Secret Manager real, y auditoría externa.

Una política RLS existente no garantiza que todos los caminos de acceso estén protegidos.

### 4.4 Realtime

Persiste eventos, tiene secuencia monotónica, permite replay por cursor, filtra por usuario y rol, usa PostgreSQL `LISTEN/NOTIFY`, tiene retención y pruning, y recupera eventos tras una desconexión. Para una beta de una ciudad esta solución es razonable. [V]

No es necesario agregar Kafka. Secuencia recomendada:

1. PostgreSQL `LISTEN/NOTIFY` — beta.
2. Redis Streams o NATS — cuando existan varias réplicas y más consumidores.
3. Kafka/Redpanda — sólo con volumen sostenido alto, retención de eventos larga, varios equipos independientes, reprocesamiento analítico y necesidad real de particiones.

### 4.5 Notificaciones

Preferencias, tokens cifrados, dedupe, outbox, retries, locks, dead letter, replay administrativo, invalidación de dispositivos, email SMTP y recuperación de cuenta están implementados. El bloqueador es exclusivamente el proveedor (H-02). [V]

Expo Push es el primer paso correcto: requiere revisar push receipts y su servicio no ofrece SLA, por lo que Flash debe tratar el envío como asíncrono y monitoreado, nunca como entrega garantizada. Más adelante: FCM directo para Android, APNs directo para iOS y un proveedor alternativo para contingencia.

### 4.6 Aplicaciones móviles

Expo, EAS, variantes customer/driver/merchant, bundle IDs y schemes diferenciados, permisos diferenciados, background location para driver, Secure Store, mapas nativos, Task Manager, Document Picker, Image Picker, registro de push token y builds configurables. [V]

Background location está sujeta a restricciones del sistema operativo, necesita permisos especiales y no se valida correctamente en Expo Go para Android: requiere development builds y revisión de permisos. [X]

No hace falta cambiar React Native. EAS Build ya cubre perfiles, builds internos, credenciales, automatización y envío a stores. El problema es estructural (H-08), no tecnológico.

Arquitectura móvil objetivo:

```text
apps/
  customer-mobile/
    App.tsx  navigation/  features/
  driver-mobile/
    App.tsx  navigation/  features/
  merchant-mobile/
    App.tsx  navigation/  features/
packages/
  mobile-ui/  mobile-auth/  mobile-network/  mobile-maps/
  mobile-realtime/  mobile-notifications/  domain-contracts/
```

Puede conservarse un único repositorio y gran parte del código compartido, pero deben existir entrypoints y árboles de navegación separados.

### 4.7 Wallet — decisión de no avanzar

**No convertir Flash en una wallet custodial en esta etapa.** El BCRA mantiene registros para proveedores de servicios de pago y billeteras digitales interoperables; ofrecer una cuenta de pago o una billetera propia puede implicar inscripción y obligaciones regulatorias específicas.

Estructura recomendada:

- El dinero real permanece en el PSP.
- Flash mantiene un ledger interno de representación y conciliación.
- Los «créditos Flash» son promocionales, limitados y **no retirables**.
- No se custodian depósitos de clientes.
- Los payouts se ejecutan a través del proveedor habilitado.

---

## 5. Comparación competitiva

| Dimensión | Flash actual | Líder competitivo | Brecha |
| --- | --- | --- | --- |
| Comida + viajes + envíos | Muy buena visión unificada | Uber, Maxim | Flash ya tiene la arquitectura conceptual |
| Marketplace gastronómico | Amplio, pre-beta | PedidosYa, Rappi, Uber Eats | Liquidez, catálogo, promociones, escala |
| Merchant OS | Avanzado en modelo | DoorDash, Uber Eats, Rappi | UX, POS, analytics y operación real |
| Driver OS | Avanzado en modelo | Uber, Lyft, DiDi | Navegación, payouts, incentivos, soporte |
| Dispatch | Real, basado en PostGIS | Uber, DoorDash | ETA vial, batching, predicción y escala |
| Quick commerce | Prácticamente ausente | PedidosYa, Rappi | Inventario masivo, picking, dark stores |
| Seguridad de viajes | Funciones modeladas | Lyft, DiDi, Uber, Cabify | Monitoreo real, safety team, identidad |
| B2B | Poco desarrollado | Cabify, Uber Business, Lyft Business | Centros de costo, invitados, facturación |
| POS e integraciones | Base, sin ecosistema | PedidosYa, Rappi, DoorDash | Partners, webhooks y certificación |
| Ads | Limitado | RappiAds, PedidosYa Ads, Uber Ads | Segmentación, atribución y billing |
| Suscripción | Posible, no madura | Uber One, DashPass, Rappi Pro | Economía y densidad |
| Pagos | Arquitectura fuerte | Plataformas maduras | Validación real y conciliación operada |
| Soporte | Buen modelo | Líderes con operación 24/7 | Personal, SLA real y procedimientos |
| Multiciudad | Modelo inicial | Todos los grandes | Configuración, equipos y repetibilidad |

### 5.1 PedidosYa

Su plataforma pública de integraciones incluye Courier API (cotización, confirmación, envíos programados, listado paginado de envíos), API de catálogo, actualización de stock y precios, promociones, webhooks, integración de órdenes, picking, reemplazo de productos y operaciones multitienda. Su Partner Portal permite revisar catálogo, integraciones, promociones, horarios, pedidos, errores, webhooks y tokens.

**Flash ya tiene** arquitectura de delivery, Commerce OS, sucursales, stock, sustituciones, courier, dispatch, pagos, soporte y movilidad — que PedidosYa no tiene como núcleo.

**Flash no tiene** red real de comercios, integraciones POS certificadas, ecosistema de partners, quick commerce, picking sofisticado, inventario de miles de SKU, ads maduros, densidad logística, reconocimiento de marca ni economías de escala.

**Cómo competir:** no intentar igualar el catálogo nacional. Atacar comercios locales ignorados, delivery propio + Flash, courier B2B, integraciones simples, menor comisión, mejor soporte local y herramientas SaaS para el comercio.

### 5.2 Uber y Uber Eats

La app de conductor integra zonas de demanda, tendencias horarias, preferencias de modalidad, Safety Toolkit, ganancias, payouts, promociones, inbox de soporte, documentos, vehículos, métodos de cobro y métricas de aceptación y cancelación. Uber Eats Manager ofrece rendimiento en tiempo real, ventas, online rate, exactitud, feedback, menú, precios, horarios, problemas de pedidos, disputas de reembolso, customer insights y payouts.

La visión de Flash (cliente food+rides, driver delivery+rides, merchant, operations) es parecida, y eso es una fortaleza. La brecha real está en routing, confiabilidad, seguridad, fraud prevention, soporte, incentivos, payouts, identidad, experimentación, disponibilidad, datos históricos, marca y liquidez.

**Flash no necesita igualar todo Uber. Necesita ofrecer una operación mejor en una ciudad limitada.**

### 5.3 Maxim — competencia local más directa

Publica operación en La Rioja y otras ciudades argentinas. Ofrece precio anticipado, viajes programados, mapa del conductor, plantillas de viaje, viajes urbanos e interurbanos, comida y compras, courier y vehículos de carga. Su producto para comercios permite solicitar entregas y compartir un enlace de seguimiento en tiempo real con el cliente.

**Maxim supera hoy a Flash** en operación real, conductores activos, cobertura, precios productivos, atención, marca local, experiencia acumulada y viajes programados operados.

**Flash puede superar a Maxim** en marketplace gastronómico, sistema de comercio, inventario, analytics, APIs, POS, B2B, transparencia para el conductor, logística híbrida, fidelización y backoffice local.

La propuesta no puede ser simplemente «más barato que Maxim».

### 5.4 Lyft — benchmark de seguridad

Documenta monitoreo de actividad anómala, paradas largas, cancelaciones durante el viaje, safety team humano 24/7, soporte de emergencia, ubicación compartida, grabación, PIN, comunicación con número anonimizado, verificación de pasajeros y background checks de conductores. Muestra al conductor, antes de aceptar, ganancia, pickup, dropoff, tiempo, distancia, ruta completa y ganancia horaria estimada.

Flash tiene varias entidades de seguridad, pero debe convertirlas en un **Safety Operating System**: monitoreo automatizado, equipo humano, escalamiento, evidencia, llamadas, autoridades, seguros, auditoría y post-incidente.

Lyft también ofrece Price Lock para recorridos frecuentes, concepto interesante para viajes corporativos, empleados y estudiantes.

### 5.5 DiDi

Publica verificación de conductor con revisión de más de diez documentos, reconocimiento facial, PIN, anonimización de teléfono, contactos de confianza, monitoreo GPS, detección de desvíos, detección de paradas inusuales, detección de duración excesiva, tickets automáticos, comunicación con autoridades y soporte 24/7. Muestra el destino al conductor antes de aceptar.

La brecha no es crear un botón SOS. Es inteligencia de riesgo, verificación biométrica, operación de incidentes, llamadas anonimizadas, identity assurance, gestión de zonas peligrosas, safety team y procedimientos con autoridades.

### 5.6 Cabify — la oportunidad B2B

Presenta usuarios, grupos, límites de gasto, restricciones por día/hora/zona, centros de costo, factura unificada, viajes para invitados, seguimiento desde el panel, API, integraciones ERP y reportes. También ofrece geolocalización, contactos de confianza, botón de seguridad y PIN.

**Flash Business puede ser uno de los productos más defendibles**: empresas, hoteles, clínicas, farmacias, comercios, estudios, industrias, instituciones y turismo. **Es más viable conseguir diez contratos B2B que intentar adquirir decenas de miles de consumidores mediante subsidios.**

### 5.7 DoorDash y Rappi

DoorDash Business Manager permite órdenes activas, tracking de repartidor, ETA, ajustes de preparación, refunds, productos agotados, cancelaciones, sustituciones, horarios, reportes, campañas y chat con cliente y repartidor. También desarrolló onboarding rápido, menú asistido por IA e integraciones POS. Flash modela muchas de estas capacidades pero debe mejorar UX del comercio, flujos de excepción, predicción de preparación, integración POS, app tablet, roles del personal, analytics y onboarding.

Rappi ofrece a comercios métricas, ventas, comentarios, menú, horarios, perfiles, pagos, reportes, promociones, RappiAds, soporte, integración POS y conciliación. Flash **no debería competir** inicialmente en supermercados, farmacias con inventario masivo, dark stores, quick commerce, ads a gran escala ni amplia variedad retail. Debe competir en operación local, comercio directo, SaaS, courier, B2B, delivery híbrido, menor complejidad y atención cercana.

---

## 6. Dónde puede ganar Flash

### Posicionamiento

No: «la nueva competencia de Uber y PedidosYa».

Sí: **«La plataforma local para vender, entregar y moverse dentro de una ciudad.»** o **«El sistema operativo de comercio y movilidad para ciudades regionales.»**

### Ventajas defendibles

1. **Soporte local.** Los grandes operan con procesos regionales. Flash puede tener operadores locales, comercios conocidos, conductores verificados localmente, resolución rápida, acuerdos B2B y conocimiento de barrios y horarios.
2. **Logística híbrida.** Cada comercio elige flota propia, driver Flash, autoasignación, fallback a Flash, pickup o courier externo.
3. **Transparencia para drivers.** Ganancia neta, km al pickup, km total, tiempo, destino, espera estimada, comisión, propina, incentivo y costos externos — antes de aceptar.
4. **Flash Business.** Viajes para invitados, envíos corporativos, centros de costo, facturación, presupuestos, restricciones, API y reportes.
5. **Merchant OS.** El comercio puede usar Flash sin depender del marketplace: tienda directa, gestión de delivery, pedidos propios, CRM, catálogo, analytics, logística y POS.
6. **Ciudades secundarias.** Donde PedidosYa tiene oferta limitada, Uber no tiene densidad, las soluciones locales son rudimentarias y los comercios todavía operan por WhatsApp.

---

## 7. Inversión técnica recomendada

| Área | Porcentaje |
| --- | ---: |
| Calidad, seguridad, CI y confiabilidad | **25%** |
| Mobile, mapas, push y tracking | **20%** |
| Pagos, ledger y conciliación | **15%** |
| Dispatch, geoespacial y supply | **15%** |
| Merchant OS, POS y API | **10%** |
| Operaciones, soporte y safety | **10%** |
| Data, growth y experimentación | **5%** |

**Invertir ahora:** QA automation, backend senior, mobile senior, proveedor de mapas, push real, observabilidad, PostgreSQL y Redis administrados, object storage, seguridad externa, asesoría legal, seguros, operación y soporte.

**Invertir después:** ads, suscripción, IA avanzada, recomendaciones, forecast, data warehouse complejo, quick commerce, expansión nacional.

**No invertir todavía:** Kubernetes, Kafka, microservicios masivos, modelo de IA propio, dark stores, wallet regulada, subsidios agresivos, oficinas costosas, expansión a muchas ciudades.

### Tecnologías a conservar

| Tecnología | Decisión |
| --- | --- |
| PostgreSQL | Mantener |
| PostGIS | Mantener |
| Redis | Mantener para datos efímeros |
| React | Mantener |
| Expo/React Native | Mantener |
| Express | Mantener durante beta |
| Zod | Mantener |
| OpenTelemetry | Mantener y completar |
| Mercado Pago | Primer PSP marketplace |
| MapLibre | Mantener como capa visual |

### Tecnologías a incorporar

| Necesidad | Recomendación |
| --- | --- |
| Backend tipado | TypeScript incremental |
| Unit tests | Vitest |
| Integración real | Testcontainers |
| API tests | Supertest |
| E2E | Playwright |
| Carga | k6 |
| Cola | BullMQ sobre Redis, o formalizar los workers actuales |
| Storage | S3 compatible |
| Secrets | AWS Secrets Manager, GCP Secret Manager o Vault |
| Error tracking | Sentry |
| Métricas | Grafana Cloud, Datadog o stack Prometheus |
| Infraestructura | Terraform/OpenTofu |
| Push inicial | Expo Push |
| Routing | Google Routes, Mapbox o HERE |
| API SDK | OpenAPI Generator |

### Tecnologías a NO incorporar todavía

Kubernetes · Kafka · service mesh · veinte microservicios · blockchain · modelo de IA propio · data lake complejo · wallet custodial · motor de mapas propio · antifraude basado exclusivamente en IA.

---

## 8. Integraciones y credenciales necesarias

| Integración | Credenciales principales | Webhooks/eventos |
| --- | --- | --- |
| Mercado Pago | Client ID, Client Secret, Public Key, OAuth encryption key | Payments, refunds, merchant events |
| Maps | Server API key, Android key, iOS key | Normalmente sin webhook |
| Expo Push | Expo project ID, credenciales FCM/APNs | Receipts consultados asíncronamente |
| Twilio Verify | Account SID, Auth Token, Verify Service SID | Delivery/status opcional |
| Email | SMTP host, user, password, from | Bounce/complaint si el proveedor lo soporta |
| S3 compatible | Access key, secret, bucket, KMS key | Object events opcionales |
| Observability | OTLP endpoint/token | Alert receiver |
| KYC | API key, webhook secret | Review completed, rejected, expired |
| POS partners | OAuth/API key | Order, catalog, stock, status |
| Accounting/ERP | OAuth/API key | Settlement, invoices, payouts |

**Todas las credenciales deben vivir en un Secret Manager, no en `.env` de servidores permanentes.**

---

## 9. KPIs obligatorios

### Técnicos

| KPI | Objetivo inicial |
| --- | ---: |
| API availability | ≥ 99,9% |
| API p95 interna | < 300 ms |
| Quote p95 | < 1,5 s |
| Primera oferta dispatch p95 | < 5 s |
| Evento realtime p95 | < 2 s |
| Ubicación activa con menos de 20 s | ≥ 95% |
| Error rate | < 1% |
| Doble cobro | 0 |
| Doble asignación | 0 |
| Exposición cross-user | 0 |
| RPO | ≤ 15 minutos |
| RTO | ≤ 60 minutos |

### Marketplace

Fill rate · acceptance rate · completion rate · cancellation rate por actor · tiempo a primera oferta · tiempo de aceptación · tiempo de preparación · on-time pickup · on-time delivery · error de ETA · utilización de driver · ganancia por hora · órdenes por comercio · retención de comercio · repetición de cliente · contactos a soporte por 100 órdenes · refund rate · fraud loss · contribution margin.

### Safety

Documentos vigentes · verificaciones fallidas · GPS freshness · viajes con PIN · alertas por desvío · incidentes por 10.000 viajes · tiempo de respuesta crítico · conductores suspendidos · cuentas comprometidas.

---

## 10. Equipo necesario

### Tecnología

| Rol | Cantidad recomendada |
| --- | ---: |
| Tech Lead | 1 |
| Backend senior | 2 |
| Mobile senior | 2 |
| Frontend/operations web | 1 |
| QA automation | 1 |
| Product designer | 1 |
| DevOps/SRE | 0,5–1 |
| Data analyst/engineer | 0,5–1 |

### Operación

Product manager · city manager · merchant operations · driver operations · support agents · safety lead · legal · contabilidad · conciliación · partnerships · growth.

**Una plataforma como Flash no se vuelve competitiva solamente aumentando developers. La operación humana forma parte del producto.**

---

## 11. Nota regulatoria

No se identificó un marco provincial o municipal claramente publicado y vigente que permita determinar por sí solo el encuadre de plataformas de viajes en La Rioja. **No debe inferirse legalidad por la presencia de competidores**: se necesita asesoramiento jurídico local y confirmación escrita de las autoridades competentes antes de cualquier piloto de movilidad. [X]

---

## 12. Veredicto

Flash tiene **potencial real de startup**. La base técnica es considerablemente más seria que la mayoría de los proyectos en etapa temprana, y la visión de combinar marketplace, comercio, delivery, courier, movilidad, pagos y operaciones es sólida.

La inversión correcta durante los próximos meses no está en agregar otra vertical. Está en convertir lo existente en una plataforma **modular, probada, observable, integrada, operable, legalmente viable y económicamente medible**.

La ruta con mejor relación riesgo–potencial:

> **Delivery y courier local → Flash Business → densidad operativa → piloto de movilidad → multiciudad.**

Ejecución concreta en [`docs/plan-de-accion.md`](plan-de-accion.md).

---

## Fuentes consultadas

- Mercado Pago — Split Payments 1:1, configuración de integración marketplace: https://www.mercadopago.com.ar/developers/en/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- BCRA — Registro de Billeteras Digitales Interoperables: https://www.bcra.gob.ar/inscripcion-registro-billeteras-digitales-interoperables/
- Google Maps Platform — Routes API: https://developers.google.com/maps/documentation/routes
- Google Maps Platform — Specify locations for a route matrix: https://developers.google.com/maps/documentation/routes/specify_location-rm
- Expo — Send notifications with the Expo Push Service: https://docs.expo.dev/push-notifications/sending-notifications/
- Expo — Location (background): https://docs.expo.dev/versions/latest/sdk/location/
- Expo — EAS Build: https://docs.expo.dev/build/introduction/
- OSMF Operations — Nominatim Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
- PedidosYa Developers — Courier API: https://developers.pedidosya.com/
- PedidosYa Developer — Partner Portal: https://developer.pedidosya.com/en/documentation/promotions-sftp-faq
- Uber — Driver App: https://www.uber.com/us/en/drive/driver-app/
- Uber Eats — Simplify operations: https://merchants.ubereats.com/us/en/technology/simplify-operations/overview/
- Maxim — servicio de solicitud de viajes: https://taximaxim.com/ar/
- Maxim Delivery — entregas para comercios: https://delivery.taximaxim.com/es-AR/
- Lyft — Safety for Riders and Drivers: https://www.lyft.com/safety
- Lyft — Upfront pay: https://help.lyft.com/hc/en-us/driver/articles/8668928544-Upfront-pay
- Lyft — Price Lock: https://www.lyft.com/rider/commute/pricelock
- DiDi Argentina — Monitoreo de viaje: https://web.didiglobal.com/ar/seguridad/pasajeros/monitoreo-de-viaje/
- DiDi Argentina — Seguridad de conductores: https://web.didiglobal.com/ar/seguridad/conductores/
- Cabify — Plataforma para empresas: https://cabify.com/ar/empresas/plataforma
- Cabify — Seguridad para empresas: https://cabify.com/ar/empresas/seguridad
- DoorDash — Business Manager App: https://merchants.doordash.com/en-us/learning-center/business-manager-app
- DoorDash — Real-time features for merchants: https://about.doordash.com/en-us/news/doordash-empowers-merchants-with-new-real-time-features
- Rappi — Consultar ventas y pagos: https://help.partners.rappi.com/es/cmo-consultar-tus-ventas-y-pagos-desde-la-seccin-financiero-Bku0SUvlfx
