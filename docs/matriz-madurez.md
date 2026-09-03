# Matriz de madurez

Instrumento central de la Fase 0 definida en [`docs/plan-de-accion.md`](plan-de-accion.md). Versión inicial: **25 de agosto de 2026**.

## Para qué sirve

La auditoría del 25 de agosto identificó que el riesgo principal de Flash no es la falta de capacidades, sino **la distancia entre lo que está implementado y lo que está probado con proveedores, operado y verificable**. Esta matriz existe para que esa distancia sea imposible de ignorar.

### Escala

| Estado | Significado | Cómo se demuestra |
| --- | --- | --- |
| `IMPL` | Implementado en código | Existe el módulo |
| `LOCAL` | Probado localmente por un script o un humano | Hay un script `test:*` que pasa en una máquina |
| `CI` | Probado como puerta bloqueante | El script corre en un workflow y bloquea el merge |
| `PROV` | Probado contra el proveedor real en sandbox | Hay evidencia del proveedor adjunta al PR |
| `STG` | Validado en staging con datos separados | Hay un ambiente de staging con la capacidad activa |
| `PROD` | Operado en producción con usuarios reales | Hay métricas de uso real |

### Reglas

1. **Una capacidad no puede anunciarse por encima de su estado real.** Una capacidad en `IMPL` no se demuestra a un inversor como funcional; una capacidad en `CI` no se anuncia como productiva.
2. El estado se actualiza **en el mismo PR** que cambia la capacidad, nunca en un PR aparte.
3. Un estado `PROV` o superior exige evidencia adjunta: captura del proveedor, identificador de transacción o registro del dispositivo físico.
4. Cuando una capacidad esté bloqueada por un externo, se nombra el externo y la gestión pendiente.

---

## Estado consolidado

Al **27 de agosto de 2026**, sobre **107 capacidades inventariadas**:

| Estado | Capacidades | Proporción | Al 26-08 | Al 25-08 |
| --- | ---: | ---: | ---: | ---: |
| `IMPL` | 7 | 6,5% | 6 | 9 |
| `LOCAL` | 8 | 7,5% | 8 | 50 |
| `CI` | 78 | 72,9% | 64 | 14 |
| `PROV` | 0 | 0% | 0 | 0 |
| `STG` | 0 | 0% | 0 | 0 |
| `PROD` | 0 | 0% | 0 | 0 |
| No existe | 14 | 13,1% | 16 | 18 |

**Lectura:** de las 93 capacidades que existen, **15 (16%) siguen en `IMPL` o `LOCAL`** — sin puerta automática que las proteja de una regresión. Eran 59 sobre 73 (81%) el 25 de agosto.

La capacidad 106 no es construcción nueva: el reintegro proporcional por incidencia existía en el código y **no estaba inventariado**, que es su propia clase de hallazgo. El salto anterior viene de las puertas del ticket CI-001. Las 78 en `CI` ya no son infraestructura: incluyen migraciones, RLS, cadena de auditoría, aislamiento por ciudad, audiencia realtime, ledger, conciliación, riesgo, payouts, KYC, vehículos, safety, chat, soporte, notificaciones, push y mapas.

**Ninguna capacidad alcanzó `PROV`.** Ni pagos, ni push, ni mapas, ni KYC fueron probados contra un proveedor real. Ese es el objetivo de la Fase 1, y es la distancia que esta matriz existe para no dejar olvidar: **una capacidad en `CI` está protegida contra regresiones, no demostrada contra el mundo real.**

El push y los mapas ilustran exactamente esa distancia. Ambos pasaron de imposibles a implementados y con puerta CI, pero sus contratos se verifican con `fetch` interceptado. Que el contrato sea correcto no dice nada sobre si un push llega a un teléfono ni sobre cuánto cuesta una consulta de rutas: eso exige credenciales y un dispositivo, y por eso siguen en `CI` y no en `PROV`.

### Lo que sigue sin puerta

| Capacidad | Motivo |
| --- | --- |
| ETA vial en el scoring de dispatch | Route Matrix lista, falta API key — ticket DSP-001 |
| SSE, event log, retención realtime | Sin suite dedicada |
| Calidad y costo reales de geocoding/routing | Adapter y contratos en CI; falta API key comercial y ensayo de deliverability — ticket GEO-001 |
| Backup y restore drill | Scripts PowerShell, van a `ci-nightly` |
| Wallet sandbox, moderación, notificación in-app | Sin suite dedicada |
| Registro y login | `test:security` corre sobre el fallback SQLite, no sobre PostgreSQL |

---

## Identidad y sesiones

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Registro y login | `CI` | `test:security` vía `check` sobre el fallback y `test:postgres` sobre PostgreSQL |
| Access/refresh rotativo | `CI` | `test:web-auth-session` en `ci-fast` |
| Transporte HTTP web acotado | `CI` | Timeout, refresh y SSE viven en `src/api/http.ts`; `test:network-resilience` fija techo 280 |
| Mapa HTTP web por dominio | `CI` | Cuenta, comercio, movilidad y operaciones en `src/api/*`; el barrel sólo compone; `test:network-resilience` fija techos |
| Transporte HTTP mobile acotado | `CI` | Timeout y refresh viven en `apps/mobile/src/api/http.ts`; `test:network-resilience` fija techo 210 |
| Mapa HTTP mobile por dominio | `CI` | Cuenta, comercio, movilidad y operaciones en `apps/mobile/src/api/*`; el barrel sólo compone; `test:network-resilience` fija techos |
| Refresh en cookie HttpOnly | `CI` | `test:web-auth-session` en `ci-fast` |
| Sesiones remotas | `CI` | `test:remote-sessions` en `ci-critical-flows` |
| Recuperación de contraseña | `CI` | `test:password-recovery` en `ci-critical-flows` |
| Verificación de email | `CI` | `test:email-verification` bloquea el merge · SMTP real pendiente |
| Verificación telefónica | `CI` | `test:phone-verification` cubre el flujo sandbox · **sin prueba con cuenta Twilio habilitada** |
| MFA administrativo | `CI` | `test:mfa` en `ci-critical-flows` |
| Moderación y suspensión | `LOCAL` | Sin puerta CI |
| RBAC y ownership | `CI` | `test:security` dentro de `check` (runtime) y `test:authorization` en `ci-fast` (las 10 reglas, una por una) |

## Datos y aislamiento

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| PostgreSQL/PostGIS runtime | `CI` | `ci-postgres.yml` levanta PostGIS 17 con roles separados; `test:runtime-role-shape` repite el arranque en un contenedor aislado |
| 136 migraciones versionadas | `CI` | `ci-postgres.yml` corre desde cero, en Testcontainers y de forma incremental sobre la rama base |
| Framework estándar de pruebas | `CI` | Vitest 4.1 ejecuta autorización; Testcontainers 12.1 ejecuta migraciones y roles sobre PostGIS efímero · migración gradual restante |
| Row-Level Security | `CI` | `test:rls` bloquea el merge · **69 de 69** tablas `por-usuario` con política. `shipment_details` y `promotion_redemptions` cerraron el 27-08: la primera guardaba nombre, teléfono y PIN del destinatario sin `ENABLE` |
| Matriz de clasificación RLS | `CI` | `test:rls-matrix`: las 104 tablas clasificadas, deuda declarada que sólo puede achicarse. Desde el 27/08 también resta los `DROP TABLE`: una clasificación no sobrevive a su tabla |
| `FORCE ROW LEVEL SECURITY` | — | **Cero sentencias.** El dueño es `flash_app`, que migra y hace backfill sobre filas de todos: `FORCE` a todo rompe ese trabajo — ticket DAT-001 |
| Negativa de arranque con rol que saltea RLS | `CI` | `test:rls-guard`. Cubre el riesgo que `FORCE` no puede cubrir: apuntar `DATABASE_URL` al rol migrador desactivaría las políticas en silencio |
| Esquema muerto eliminado | `CI` | `112_drop_dead_schema.sql` borró `outbox_events` y `user_security_factors`, que era un almacén de credenciales sin política |
| Auditoría encadenada SHA-256 | `CI` | `test:audit-immutability` en `ci-postgres.yml` |
| Idempotencia y locks | `CI` | `test:idempotency-prune` y `test:postgres` bloquean el merge · `test:payment-idempotency` cubre la captura repetida, y sus dos mitades |
| Aislamiento por ciudad | `CI` | `test:city-isolation` en `ci-postgres.yml` |
| Backup y restore drill | `LOCAL` | `db:restore:drill` fuera de CI · sin cronometrar contra RTO |
| Separación de roles PostgreSQL | `CI` | `test:container-security` |
| Alcance de permisos del runtime | `CI` | `test:grant-scope` y `test:runtime-write-scope`. Las migraciones hasta la 135 reducen los permisos DML sin uso de 114 a cero; las últimas 35 operaciones tienen además un contrato nominal, no sólo un conteo |
| Imagen productiva non-root | `CI` | Job `container-image` construye la imagen y verifica `uid=999(flash)` |
| Auditoría de dependencias de desarrollo | `CI` | `test:dependency-gate` cubre cuatro alcances: raíz y móvil, producción y desarrollo |
| Dependencias de producción acotadas | `CI` | `test:production-deps`: las 20 están importadas por el servidor. Siete paquetes de frente salieron de la imagen: 381 → 303 MiB |
| Filesystem raíz de sólo lectura | `CI` | El job arranca la imagen con `--read-only` hasta que responde y comprueba que la raíz rechace escrituras. Escribible sólo `/tmp` y el volumen de datos (SQLite de respaldo). `store.js` abre SQLite de forma perezosa: con PostgreSQL el import puro no escribe |
| SBOM de la imagen productiva | `CI` | CycloneDX publicado como artefacto en cada corrida del job `container-image` |
| Scan de vulnerabilidades de imagen | `CI` | Trivy fijado. Bloquea las HIGH/CRITICAL **arreglables por el equipo**, fuera del npm de la imagen base; lo heredado se informa sin cortar |

## Pagos y finanzas

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Ledger de doble entrada | `CI` | `test:ledger-balance` en `ci-postgres`: barre el libro, exige el trigger diferido de la migración 118 y le prueba las dos mitades. `test:marketplace-ledger` cubre la aritmética del split |
| Payment intents | `CI` | `test:payment-methods` en `ci-critical-flows` |
| Reintegro proporcional por incidencia | `CI` | `test:order-refund-split` en `ci-postgres`: prorrateo con números que fuerzan el redondeo, resto determinista y guarda de doble resolución |
| Wallet sandbox | `CI` | `test:postgres` cubre captura y reintegro · **no custodial por decisión** |
| Mercado Pago OAuth PKCE | `CI` | `test:payment-oauth` cubre el contrato · **sin sellers de prueba vinculados** — ticket PAY-001 |
| Creación de pago con `application_fee` | `CI` | `test:mercadopago-payment` con fetch interceptado · **sin credenciales del proveedor** |
| Conciliación de pagos programada | `CI` | `job:payment-reconciliation` corre desatendido en `ci-nightly` y deja auditoría de sistema · **sin planificador productivo porque no hay producción** |
| Webhook firmado | `CI` | `test:mercadopago-webhook` en `ci-fast` · sin webhook real |
| Refund | `IMPL` | **Caso de saldo insuficiente del vendedor no probado** |
| Conciliación | `CI` | `test:payment-reconciliation` bloquea el merge · sin operación diaria |
| Revisión de payouts | `CI` | `test:payout-review` en `ci-critical-flows` |
| Riesgo transaccional | `CI` | `test:transaction-risk` en `ci-critical-flows` |
| Adaptador bancario para payout | — | **No existe** |

## Dispatch y geoespacial

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Ofertas privadas con TTL | `CI` | `test:postgres` bloquea el merge |
| Aceptación atómica `SKIP LOCKED` | `CI` | `test:postgres` bloquea el merge |
| Ranking explicable | `CI` | Selección en dos etapas · `test:dispatch-candidates` y `test:postgres` |
| Recorte `ST_DWithin` + KNN | `CI` | Etapa 1 sobre el índice GiST parcial · **falta `EXPLAIN ANALYZE` con padrón sintético** |
| Stats precomputadas de conductor | — | **No existe** · se recalcula historial de 30 días por oferta |
| Route Matrix para dispatch | `CI` | `describeRouteMatrix` con contrato verificado · falta conectarla al scoring |
| Zonas de demanda | `CI` | `test:driver-demand` en `ci-critical-flows` |
| Geocoding | `CI` | Adapter con `test:maps-provider` · producción rechaza instancias públicas · **sin API key habilitada** |
| Routing | `CI` | Adapter con Routes `TRAFFIC_AWARE` y Route Matrix · **sin API key habilitada** |
| Tarifa con distancia vial | `CI` | Comida/viaje/envío usan `resolveDrivingRoute` en prod/comercial (`distanceSource: road`); OSM de desarrollo etiqueta `geodesic_scaled` · `test:maps-provider` · **sin API key para calidad/costo reales** |
| Cotización firmada | `CI` | `test:maps` en `ci-critical-flows` |
| Dirección validada en checkout de comida | `CI` | Migración 136 + token geográfico ligado al usuario · `test:maps` y `test:postgres` rechazan manipulación y registros legacy · **sin veredicto de deliverability comercial** |
| Caché, circuit breaker y presupuesto | `CI` | `test:provider-resilience` |

## Realtime y notificaciones

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| SSE con replay por cursor | `LOCAL` | Sin puerta CI |
| Event log durable con secuencia | `LOCAL` | Sin puerta CI |
| Audiencia por usuario y rol | `CI` | Default-deny activo · `test:realtime-audience` cubre la clasificación sin base · `test:realtime-audience-runtime` cubre los resolutores de propiedad contra PostgreSQL con fixtures multiusuario |
| Retención y pruning | `LOCAL` | `realtime:prune` sin puerta CI |
| Outbox de notificaciones | `CI` | `test:notification-dead-letters` en `ci-critical-flows` |
| Preferencias de notificación | `CI` | `test:notification-preferences` en `ci-critical-flows` |
| Notificación in-app | `LOCAL` | Canal activo real en desarrollo |
| **Push productivo** | `CI` | Proveedor Expo con `test:push-provider` · **sin entrega en dispositivo físico** — ticket NOT-001 |
| Email SMTP | `IMPL` | Proveedor no habilitado |
| SMS | `IMPL` | **Sin cuenta Twilio habilitada** |

## Aplicaciones móviles

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Typecheck mobile | `CI` | `mobile-typecheck` |
| Variantes customer/driver/merchant | `CI` | `test:mobile-build-variants` |
| Runtime nativo | `CI` | `test:mobile-native-runtime` |
| Mapas nativos | `CI` | `test:mobile-maps` en `ci-fast` |
| Background location | `IMPL` | **Requiere development build · sin ensayo físico** |
| Registro de push token | `IMPL` | Sin proveedor de destino |
| Builds EAS firmados | — | **No existen** — ticket MOB-001 |
| Crash reporting | — | **No existe** |
| Entrypoints separados por audiencia | `CI` | `metro.config.js` resuelve la pantalla según `EXPO_PUBLIC_APP_VARIANT`; `test:mobile-variant-bundles` empaqueta las tres y exige que cada bundle Hermes lleve una sola |
| Variante instalada con fuente única | `CI` | `test:mobile-build-variants`. El runtime la leía del manifiesto de Expo, que en web no llega: el build de conductor pedía rol `customer` y rechazaba al conductor |
| Segmentación interna de Cliente | `CI` | Cuenta, Actividad, tracking, Viajes, Envíos, resolución de problemas y las cinco tareas de Comidas viven fuera de `CustomerScreen.tsx`; la sesión de Comidas vive en `useCustomerFood`; `test:responsive-layout` y `test:mobile-food-design` fijan el coordinador en 950 líneas o menos |

## Web y entrega

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Build productivo | `CI` | `check` |
| Presupuesto de bundle | `CI` | `test:web-bundle-budget` |
| Compresión y caché | `CI` | `test:web-delivery` |
| Contrato responsive | `CI` | `test:responsive-layout` |
| Segmentación interna de Cliente | `CI` | Wallet, perfil, libreta, dieta, Actividad, Envíos, descubrimiento, restaurante, catálogo/personalización, carrito/checkout, navegación, tarjeta de estado y los tres trackings viven en módulos propios; `test:responsive-layout`, `test:web-checkout` y `test:web-tracking-maps` fijan 375/95/130/155/95/110/690/35/25/575/130/315/165/195/180/340/285 líneas y APIs propietarias. Chromium verifica Cuenta, cotizador, home, restaurante, personalizador, carrito y los tres trackings a 390 × 844; el envío activo faltante se cotiza/crea por API real e idempotente |
| Contratos compartidos web/móvil | `CI` | `@flash/domain-contracts` con 28 tipos (incluye `User`/`UserRole`/`OrderStatus`/`RideStatus`); `test:domain-contracts` exige paquete, reexport y ausencia de cuerpos duplicados. Order/Restaurant siguen divergentes |
| Auditoría responsive en navegador real | `CI` | `test:responsive-browser` en `ci-nightly.yml`, una corrida por variante. Hasta el 27-08 pasaba sobre la pantalla de login |
| Degradación explícita sobre el respaldo | `CI` | `test:fallback-degradation`: 54 rutas × 4 audiencias sin 500. Encontró 17 rutas que reventaban con `TypeError` en vez de responder 503 |
| CSP activa | `LOCAL` | Sin puerta dedicada |
| Separación por audiencia | `CI` | `src/App.tsx` es shell de sesión/auth/enrutado; la sesión de comercio vive en `useCustomerCommerce`; `test:responsive-layout` fija el entry en 720 líneas o menos |

## Operación y soporte

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Backoffice de operaciones | `CI` | `test:operations-resources` bloquea el merge |
| Suscripción (Flash Más) | `CI` | `test:postgres` prueba umbral, alta duplicada, baja que conserva el beneficio y reactivación · `test:marketplace-ledger` prueba quién paga el subsidio · **no cobra**: depende de PAY-001 |
| Propina en el checkout | `CI` | `test:postgres` prueba retención, cargo único y liberación entera al conductor · `test:web-checkout` y `test:mobile-food-design` atan los topes del cliente a los del servidor |
| Servicios programados y reprogramación | `CI` | `test:dispatch-candidates` afirma los cuatro bordes de la ventana y que ningún router la reescriba · `test:postgres` prueba el movimiento y sus dos rechazos |
| Pedidos grupales | `CI` | `test:postgres` prueba el tope contra los precios de la base, que un grupo ajeno no se lee y que las líneas se entregan sumadas sin perder notas |
| Colas de trabajo y su tablero | `CI` | `test:postgres` ejecuta la consulta de las doce colas · los workers que las vacían corren fuera del servidor y `test:ci-coverage` verifica que tengan punto de entrada |
| Intervención operativa | `CI` | `test:postgres` prueba suspensión con motivo, que no cancela lo que está en curso, y la liberación de un servicio trabado |
| Routing de tickets y SLA | `CI` | `test:support-sla` y `test:support-routing` bloquean el merge · la cuarentena quedó vacía el 27-08 |
| Chat operativo cifrado | `CI` | `test:service-chat` en `ci-critical-flows` |
| KYC de conductores | `CI` | `test:driver-kyc` bloquea el merge · sin proveedor KYC |
| Revisión de vehículos | `CI` | `test:driver-vehicles` en `ci-critical-flows` |
| Feature flags | `CI` | `test:feature-flags` en `ci-postgres` |
| Readiness por zona | `CI` | `test:zone-readiness` en `ci-postgres` |
| Analytics first-party | `CI` | `test:product-analytics` en `ci-postgres` · sin consentimiento legal |
| Runbooks | `IMPL` | Documentados · **sin ensayo operativo** |
| Operación humana sostenida | — | **No existe** — ticket OPS-001 |

## Safety

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| PIN de retiro | `CI` | `test:ride-safety` en `ci-critical-flows` |
| Contactos de confianza cifrados | `CI` | `test:ride-safety` en `ci-critical-flows` |
| Compartir recorrido | `CI` | `test:ride-safety` en `ci-critical-flows` |
| Botón de emergencia | `LOCAL` | Sin procedimiento operativo detrás |
| Detección de desvío y parada anómala | — | **No existe** |
| Llamadas enmascaradas | — | **No existe** |
| Verificación biométrica | — | **No existe** |
| Safety team 24/7 | — | **No existe** |
| Seguros y habilitación | — | **Bloqueo legal** — precondición de la Fase 4 |

## Observabilidad

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| OpenTelemetry OTLP | `CI` | `test:telemetry` |
| Reglas de alerta Prometheus | `CI` | `test:observability-rules` |
| Apagado ordenado | `CI` | `test:graceful-shutdown` |
| Rate limiting distribuido | `CI` | `test:redis-rate-limit` |
| Colector y dashboards administrados | — | **No existen** |
| Paging productivo | — | **No existe** |
| Error tracking (Sentry) | — | **No existe** |

---

## Cómo se actualiza

Al cambiar una capacidad, el PR modifica su fila. Al agregar una capacidad, el PR agrega su fila con estado inicial y recalcula el consolidado.

Un PR que sube una capacidad a `CI` debe nombrar el workflow. Un PR que la sube a `PROV` debe adjuntar la evidencia del proveedor. Un PR que sube a `STG` o `PROD` debe nombrar el ambiente.

**Bajar de estado es legítimo y esperable.** Si una puerta CI se elimina o una credencial caduca, la fila baja en el mismo PR.
