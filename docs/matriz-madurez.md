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

Al **26 de agosto de 2026**, sobre **91 capacidades inventariadas**:

| Estado | Capacidades | Proporción | Al 25-08 |
| --- | ---: | ---: | ---: |
| `IMPL` | 6 | 6,6% | 9 |
| `LOCAL` | 16 | 17,6% | 50 |
| `CI` | 51 | 56,0% | 14 |
| `PROV` | 0 | 0% | 0 |
| `STG` | 0 | 0% | 0 |
| `PROD` | 0 | 0% | 0 |
| No existe | 18 | 19,8% | 18 |

**Lectura:** de las 73 capacidades que existen, **22 (30%) siguen en `IMPL` o `LOCAL`** — sin puerta automática que las proteja de una regresión. Eran 59 (81%) el 25 de agosto.

El salto viene de las tres puertas del ticket CI-001. Las 51 en `CI` ya no son infraestructura: incluyen migraciones, RLS, cadena de auditoría, aislamiento por ciudad, audiencia realtime, ledger, conciliación, riesgo, payouts, KYC, vehículos, safety, chat, soporte y notificaciones.

**Ninguna capacidad alcanzó `PROV`.** Ni pagos, ni push, ni mapas, ni KYC fueron probados contra un proveedor real. Ese es el objetivo de la Fase 1, y es la distancia que esta matriz existe para no dejar olvidar: **una capacidad en `CI` está protegida contra regresiones, no demostrada contra el mundo real.**

### Lo que sigue sin puerta

| Capacidad | Motivo |
| --- | --- |
| Ofertas privadas, aceptación atómica, ranking | `test:postgres` está en cuarentena |
| SSE, event log, retención realtime | Sin suite dedicada |
| Geocoding y routing | Proveedores públicos — ticket GEO-001 |
| Backup y restore drill | Scripts PowerShell, van a `ci-nightly` |
| Wallet sandbox, moderación, notificación in-app | Sin suite dedicada |
| Registro y login | `test:security` corre sobre el fallback SQLite, no sobre PostgreSQL |

---

## Identidad y sesiones

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Registro y login | `LOCAL` | `test:security` corre en CI vía `check`, pero sin PostgreSQL |
| Access/refresh rotativo | `CI` | `test:web-auth-session` en `ci-fast` |
| Refresh en cookie HttpOnly | `CI` | `test:web-auth-session` en `ci-fast` |
| Sesiones remotas | `CI` | `test:remote-sessions` en `ci-critical-flows` |
| Recuperación de contraseña | `CI` | `test:password-recovery` en `ci-critical-flows` |
| Verificación de email | `CI` | `test:email-verification` bloquea el merge · SMTP real pendiente |
| Verificación telefónica | `CI` | `test:phone-verification` cubre el flujo sandbox · **sin prueba con cuenta Twilio habilitada** |
| MFA administrativo | `CI` | `test:mfa` en `ci-critical-flows` |
| Moderación y suspensión | `LOCAL` | Sin puerta CI |
| RBAC y ownership | `CI` | `test:security` dentro de `check` |

## Datos y aislamiento

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| PostgreSQL/PostGIS runtime | `CI` | `ci-postgres.yml` levanta PostGIS 17 con roles separados |
| 110 migraciones versionadas | `CI` | `ci-postgres.yml` corre desde cero y de forma incremental sobre la rama base |
| Row-Level Security | `CI` | `test:rls` bloquea el merge · **20 tablas siguen sin política** — ticket DAT-001 |
| `FORCE ROW LEVEL SECURITY` | — | **Cero sentencias** — ticket DAT-001 |
| Auditoría encadenada SHA-256 | `CI` | `test:audit-immutability` en `ci-postgres.yml` |
| Idempotencia y locks | `LOCAL` | `test:idempotency-prune` en CI; `test:postgres` necesita API levantada |
| Aislamiento por ciudad | `CI` | `test:city-isolation` en `ci-postgres.yml` |
| Backup y restore drill | `LOCAL` | `db:restore:drill` fuera de CI · sin cronometrar contra RTO |
| Separación de roles PostgreSQL | `CI` | `test:container-security` |

## Pagos y finanzas

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Ledger de doble entrada | `CI` | `test:marketplace-ledger` en `ci-fast` |
| Payment intents | `CI` | `test:payment-methods` en `ci-critical-flows` |
| Wallet sandbox | `LOCAL` | Sandbox interno · **no custodial por decisión** |
| Mercado Pago OAuth PKCE | `CI` | `test:payment-oauth` cubre el contrato · **sin sellers de prueba vinculados** — ticket PAY-001 |
| Creación de pago con `application_fee` | `CI` | `test:mercadopago-payment` con fetch interceptado · **sin credenciales del proveedor** |
| Webhook firmado | `CI` | `test:mercadopago-webhook` en `ci-fast` · sin webhook real |
| Refund | `IMPL` | **Caso de saldo insuficiente del vendedor no probado** |
| Conciliación | `CI` | `test:payment-reconciliation` bloquea el merge · sin operación diaria |
| Revisión de payouts | `CI` | `test:payout-review` en `ci-critical-flows` |
| Riesgo transaccional | `CI` | `test:transaction-risk` en `ci-critical-flows` |
| Adaptador bancario para payout | — | **No existe** |

## Dispatch y geoespacial

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Ofertas privadas con TTL | `LOCAL` | Sin puerta CI |
| Aceptación atómica `SKIP LOCKED` | `LOCAL` | `test:postgres` está **en cuarentena**: corre pero no bloquea |
| Ranking explicable | `LOCAL` | Sin recorte espacial previo — ticket DSP-001 |
| Recorte `ST_DWithin` + KNN | — | **Cero ocurrencias en el repositorio** |
| Stats precomputadas de conductor | — | **No existe** · se recalcula historial de 30 días por oferta |
| Zonas de demanda | `CI` | `test:driver-demand` en `ci-critical-flows` |
| Geocoding | `LOCAL` | **Nominatim público por defecto** — ticket GEO-001 |
| Routing | `LOCAL` | **OSRM público por defecto** · sin tráfico ni Route Matrix |
| Cotización firmada | `CI` | `test:maps` en `ci-critical-flows` |
| Caché, circuit breaker y presupuesto | `CI` | `test:provider-resilience` |

## Realtime y notificaciones

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| SSE con replay por cursor | `LOCAL` | Sin puerta CI |
| Event log durable con secuencia | `LOCAL` | Sin puerta CI |
| Audiencia por usuario y rol | `CI` | Default-deny activo · `test:realtime-audience` bloquea el merge |
| Retención y pruning | `LOCAL` | `realtime:prune` sin puerta CI |
| Outbox de notificaciones | `CI` | `test:notification-dead-letters` en `ci-critical-flows` |
| Preferencias de notificación | `CI` | `test:notification-preferences` en `ci-critical-flows` |
| Notificación in-app | `LOCAL` | Canal activo real en desarrollo |
| **Push productivo** | — | **Imposible por configuración** — ticket NOT-001 |
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
| Entrypoints separados por audiencia | — | Un solo `App.tsx` de 433 KB — ticket ARC-001 |

## Web y entrega

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Build productivo | `CI` | `check` |
| Presupuesto de bundle | `CI` | `test:web-bundle-budget` |
| Compresión y caché | `CI` | `test:web-delivery` |
| Contrato responsive | `CI` | `test:responsive-layout` |
| CSP activa | `LOCAL` | Sin puerta dedicada |
| Separación por audiencia | — | Un solo `App.tsx` de 360 KB — ticket ARC-001 |

## Operación y soporte

| Capacidad | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Backoffice de operaciones | `CI` | `test:operations-resources` bloquea el merge |
| Routing de tickets y SLA | `CI` | `test:support-sla` bloquea · `test:support-routing` **en cuarentena** |
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
