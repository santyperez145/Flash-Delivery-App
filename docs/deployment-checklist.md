# Deployment checklist

Revisado el **25 de agosto de 2026** contra los hallazgos de [`docs/auditoria-2026-08-25.md`](auditoria-2026-08-25.md). Sustituye la versión del 14 de agosto, que todavía trataba SQLite como preocupación de despliegue.

## Bloqueadores de despliegue vigentes

Ninguno de estos puntos puede quedar abierto en un ambiente que reciba tráfico real.

| Bloqueador | Hallazgo | Estado |
| --- | --- | --- |
| La imagen corre como root y arranca un entrypoint distinto al de Compose | [H-05](auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root) | Abierto |
| CI no ejecuta migraciones, RLS, pagos ni dispatch | [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas) | Abierto |
| 20 tablas sin política RLS y grants `ON ALL TABLES` | [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security) | Abierto |
| Push imposible en producción por configuración | [H-02](auditoria-2026-08-25.md#h-02--push-productivo-es-imposible-por-configuración) | Abierto |
| Geocoding y routing apuntan a servicios públicos | [H-07](auditoria-2026-08-25.md#h-07--proveedores-de-mapas-públicos-por-defecto) | Abierto |

## Imagen de contenedor

### Defecto actual

El `Dockerfile` es de una sola etapa, instala dependencias de desarrollo y producción juntas, copia todo el repositorio, **corre como root** y ejecuta `server/index.js`. `docker-compose.yml` sobrescribe el comando y sí usa `server/start.js`, el entrypoint instrumentado.

**La imagen por sí sola y la imagen dentro de Compose no tienen el mismo comportamiento.** Todo lo que `server/start.js` instrumenta — telemetría, apagado ordenado, readiness — se pierde si alguien despliega la imagen tal cual.

### Objetivo

- [ ] Build multi-etapa: `dependencies` → `build` → `runtime`.
- [ ] `npm ci --omit=dev` en la etapa de runtime.
- [ ] Copiar sólo `dist`, `server`, `database` y `scripts`.
- [ ] Usuario y grupo `flash` no privilegiados, con `USER flash`.
- [ ] `CMD ["node", "server/start.js"]`.
- [ ] Filesystem raíz de sólo lectura, con `/tmp` temporal.
- [ ] Capabilities eliminadas y perfil seccomp aplicado.
- [ ] Secrets montados, nunca horneados en la imagen.
- [ ] Sin puertos públicos para Redis ni PostgreSQL.
- [ ] Scan de imagen, SBOM y firma en el pipeline.
- [ ] Deploy inmutable.

Verificación mínima:

```bash
docker build -t flash:audit . && docker run --rm flash:audit id
```

No debe reportar `uid=0(root)`.

Detalle en el ticket [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida).

## Antes del deploy

- [ ] `npm run check` pasa.
- [ ] La suite crítica completa pasa y es bloqueante en CI.
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
- [ ] Roles PostgreSQL separados: owner/migrador, runtime y auditor; ninguno con `BYPASSRLS`.
- [ ] Grants explícitos por tabla, no `ON ALL TABLES`.

## Datos

- [ ] Base transaccional productiva: PostgreSQL 17.
- [ ] Geoespacial productivo: PostGIS.
- [ ] Backups automáticos diarios.
- [ ] **Restore probado y cronometrado** contra el objetivo RTO ≤ 60 minutos y RPO ≤ 15 minutos.
- [ ] Auditoría append-only para acciones administrativas, con verificación de la cadena de hashes.
- [ ] Ledger append-only para pagos y liquidaciones.
- [ ] Matriz RLS completa: toda tabla clasificada como `por-usuario`, `global-lectura`, `servicio-append-only` o `interna`.
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

- [ ] CI verde en `main`, con PostgreSQL y flujos críticos bloqueantes.
- [ ] Staging con datos separados.
- [ ] Superadmin protegido con MFA.
- [ ] Logs, métricas y alertas activos.
- [ ] Pagos validados contra el proveedor en sandbox, con ledger balanceado.
- [ ] Realtime con audiencia default-deny.
- [ ] Tres builds mobile internos instalables.
- [ ] Push recibido en dispositivos físicos.
- [ ] Restore drill ejecutado dentro del RTO.
