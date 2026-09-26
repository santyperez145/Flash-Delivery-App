# Deployment checklist

Revisado el **2 de septiembre de 2026** contra el runtime y los tickets P0. Sustituye
afirmaciones del 25-08 que seguían tratando H-04/INF-001 como abiertos cuando sus
criterios de código ya estaban cerrados.

## Bloqueadores de despliegue vigentes

Ninguno de estos puntos puede quedar abierto en un ambiente que reciba tráfico real.

| Bloqueador                                                                   | Hallazgo                                                                                                 | Estado                                                                                                                                                    |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~La imagen corre como root y arranca un entrypoint distinto al de Compose~~ | [H-05](auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root) | **Cerrado** ([INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida))                                                                         |
| ~~CI no ejecuta migraciones, RLS, pagos ni dispatch~~                        | [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas)                 | **Cerrado**; cuarentena vacía                                                                                                                             |
| ~~20 tablas sin política RLS y grants `ON ALL TABLES`~~                      | [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security)         | **Cerrado** ([DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny)); `test:rls-matrix` / `test:grant-scope`                                      |
| Push productivo sin evidencia en dispositivo físico                          | [H-02](auditoria-2026-08-25.md#h-02--push-productivo-es-imposible-por-configuración)                     | **Código cerrado** (`NOTIFICATION_PROVIDER=expo`); falta teléfono + EAS ([NOT-001](backlog-tecnico.md#not-001--push-real))                                |
| Geocoding/routing comerciales sin API key                                    | [H-07](auditoria-2026-08-25.md#h-07--proveedores-de-mapas-públicos-por-defecto)                          | **Parcial**: adapter y rechazo de instancias públicas listos; falta clave del dueño ([GEO-001](backlog-tecnico.md#geo-001--proveedor-de-mapas-comercial)) |
| Sin cuenta cloud / entorno desplegado                                        | —                                                                                                        | **Bloqueo del dueño**: destino GCP `southamerica-east1` decidido; falta cuenta                                                                            |

## Imagen de contenedor

### Defecto corregido el 26 de agosto de 2026

El `Dockerfile` era de una sola etapa, instalaba dependencias de desarrollo y producción juntas, copiaba todo el repositorio, **corría como root** y ejecutaba `server/index.js`, mientras `docker-compose.yml` sobrescribía el comando y sí usaba el entrypoint instrumentado.

**La imagen por sí sola y la imagen dentro de Compose no tenían el mismo comportamiento.** Todo lo que `server/start.js` instrumenta — telemetría, apagado ordenado, readiness — se perdía si alguien desplegaba la imagen tal cual.

El job `container-image` de `ci-fast.yml` construye la imagen en cada PR y verifica el resultado, no sólo el texto del Dockerfile.

### Estado

- [x] Build multi-etapa: `dependencies` → `build` → `runtime`.
- [x] `npm ci --omit=dev` en la etapa de runtime.
- [x] Copiar sólo `dist`, `server`, `database` y `scripts`.
- [x] Usuario y grupo `flash` no privilegiados, con `USER flash` — verificado: `uid=999(flash)`.
- [x] `CMD ["node", "server/start.js"]`.
- [x] Filesystem raíz de sólo lectura: `read_only: true` en Compose y corrida real en CI (`--read-only` + `touch` fallido). Escribible declarado: `/tmp` y `/app/server/data` (SQLite de respaldo, apertura **perezosa** en `store.js`; con PostgreSQL el import puro no escribe).
- [x] Capabilities eliminadas (`cap_drop: ALL`) y `no-new-privileges`. Perfil seccomp propio: pendiente (no bloquea INF-001).
- [x] SBOM CycloneDX y scan Trivy en el job `container-image` (bloquea CVEs del árbol propio).
- [ ] Secrets montados, nunca horneados en la imagen (entorno desplegado).
- [ ] Sin puertos públicos para Redis ni PostgreSQL (entorno desplegado).
- [ ] Firma de imagen y deploy inmutable (entorno desplegado).

Verificación mínima:

```bash
docker build -t flash:audit . && docker run --rm flash:audit id
```

No debe reportar `uid=0(root)`.

Detalle en el ticket [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida).

## Antes del deploy

- [ ] `npm run check` pasa.
- [x] La suite crítica completa pasa y es bloqueante en CI.
- [ ] `NODE_ENV=production`.
- [ ] `JWT_SECRET` fuerte y distinto al demo.
- [ ] `MFA_ENCRYPTION_KEY` independiente y presente.
- [ ] `CORS_ORIGIN` con dominios exactos del frontend y del backoffice.
- [ ] `.env` no versionado.
- [ ] Migraciones aplicadas y verificadas con `npm run db:check`.
- [ ] **Cero credenciales demo.** Los seeds `db:seed:*` no se ejecutan en un ambiente desplegado.

## Seguridad

- [ ] HTTPS obligatorio.
- [ ] MFA activo para superadmin.
- [ ] Rotar `JWT_SECRET` si estuvo expuesto.
- [ ] **Secret manager del proveedor cloud.** Ninguna credencial en `.env` de servidores permanentes.
- [ ] Rate limits por IP y por usuario.
- [ ] Credenciales separadas por ambiente.
- [ ] Permisos de GitHub Actions revisados.
- [x] Roles PostgreSQL separados: owner/migrador, runtime y auditor; ninguno con `BYPASSRLS`.
- [x] Grants explícitos por tabla: se retiró `ON ALL TABLES` y el DML sin uso; lo vigilan `test:grant-scope` y `test:runtime-write-scope`.

## Datos

- [ ] Base transaccional **desplegada** en producción: PostgreSQL 17 (el runtime del repo ya es Postgres/PostGIS; falta el entorno).
- [ ] Geoespacial **desplegado** en producción: PostGIS.
- [ ] Backups automáticos diarios.
- [ ] **Restore probado y cronometrado** contra el objetivo RTO ≤ 60 minutos y RPO ≤ 15 minutos.
- [x] Auditoría append-only para acciones administrativas, con verificación de la cadena de hashes (código + suites).
- [x] Ledger append-only para pagos y liquidaciones (código + suites).
- [x] Matriz RLS completa: toda tabla clasificada; `test:rls-matrix` en CI.
- [ ] Política formal de retención definida.

## Observabilidad

- [ ] Logs estructurados con `requestId`.
- [ ] Alertas por error rate, latencia p95, backlog de dispatch y pagos fallidos.
- [ ] Dashboard de API, DB, workers, realtime y colas.
- [ ] Trazas distribuidas con OpenTelemetry exportando por OTLP a un colector administrado.
- [ ] Error tracking (Sentry o equivalente) para frontend, mobile y backend.
- [ ] Paging productivo con rotación definida.

## Proveedores externos

Un ambiente productivo no se habilita con proveedores en `sandbox` o `disabled`.

- [ ] PSP marketplace conectado, con sellers reales y conciliación diaria operada.
- [ ] Proveedor de push activo, con receipts consultados.
- [ ] Proveedor comercial de geocoding y routing, con cuota y alerta de costo.
- [ ] Proveedor de SMS habilitado.
- [ ] SMTP productivo con manejo de bounces.
- [ ] Object storage S3 compatible con KMS.

## Dónde se despliega

Decidido el 28 de agosto de 2026: **Google Cloud, región `southamerica-east1` (São Paulo)**.
El razonamiento, el mapeo servicio por servicio, las tres trampas que salen de este código y
lo que se descartó están en [`docs/despliegue.md`](despliegue.md).

Nada de eso está ejecutado. Lo que cambió es que la ausencia de decisión dejó de ser el
bloqueador; ahora el bloqueador es la cuenta.

## Trabajos programados

**Sin planificador, cinco procesos no corren.** El proyecto no trae uno en proceso a
propósito: un `setInterval` dentro del servidor corre una vez por réplica y no sobrevive a
un reinicio en el momento equivocado. El planificador es del entorno que despliega — un
supervisor de procesos para los que hacen bucle, `cron` o un `CronJob` de Kubernetes para
los de una sola pasada.

`npm run test:ci-coverage` verifica que cada lote tenga su punto de entrada, y que nadie
meta un temporizador dentro del servidor. **Lo que ninguna puerta de este repositorio puede
verificar es que el entorno los ejecute**, y por eso están acá.

| Comando                      | Forma                              | Qué pasa si no corre                                                   |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `worker:dispatch`            | bucle propio, backoff de 0,5 a 3 s | **Un pedido pagado no recibe ninguna oferta de conductor.**            |
| `worker:notifications`       | bucle propio                       | Nada de lo encolado se entrega.                                        |
| `worker:support`             | bucle propio                       | Ningún ticket escala al vencer su SLA.                                 |
| `worker:push-receipts`       | bucle propio                       | Cada notificación queda en `sent` para siempre.                        |
| `job:payment-reconciliation` | una pasada, cada noche             | Las diferencias de pago aparecen igual; cambia cuánto tardan en verse. |

- [ ] Los cuatro workers supervisados, con reinicio automático y alerta si mueren.
- [ ] `job:payment-reconciliation` programado.
- [ ] Verificado que un pedido pagado en el entorno real recibe oferta sin intervención.

> El tercer punto es el que importa. Los dos primeros comprueban que los procesos existan;
> el tercero comprueba que **sirvan**, que es distinto.

## Operación

- [ ] Runbook para caída de pagos.
- [ ] Runbook para zona sin drivers.
- [ ] Runbook para saturación de comercios.
- [ ] Runbook para reintentos de dispatch.
- [ ] Rollback documentado y probado.
- [ ] Canal de incidentes para soporte y operaciones.
- [ ] Traspaso de turno definido.

## Criterio mínimo para beta cerrada

Corresponde a los criterios de salida de la Fase 1 en [`docs/plan-de-accion.md`](plan-de-accion.md).

- [x] CI verde en `main`, con PostgreSQL y flujos críticos bloqueantes.
- [ ] Staging con datos separados.
- [ ] Superadmin protegido con MFA.
- [ ] Logs, métricas y alertas activos.
- [ ] Pagos validados contra el proveedor en sandbox, con ledger balanceado.
- [x] Realtime con audiencia default-deny.
- [ ] Tres builds mobile internos instalables.
- [ ] Push recibido en dispositivos físicos.
- [ ] Restore drill ejecutado dentro del RTO.
