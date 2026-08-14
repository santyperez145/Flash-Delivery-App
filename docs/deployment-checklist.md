# Deployment checklist

Fecha base: 14 de agosto de 2026.

Este checklist prepara Flash Delivery App para pasar de desarrollo local a staging/produccion.

## Antes del deploy

- Confirmar que `npm run build` pasa.
- Confirmar que `npm run test:security` pasa.
- Definir `NODE_ENV=production`.
- Definir `JWT_SECRET` fuerte y distinto al demo.
- Definir `CORS_ORIGIN` con dominios exactos del frontend/admin.
- Confirmar que `.env` no se versiona.
- Revisar que SQLite local no se sube al repo.
- Revisar migraciones si el ambiente usa Postgres.

## Seguridad

- Usar HTTPS obligatorio.
- Activar MFA para superadmin.
- Rotar `JWT_SECRET` si estuvo expuesto.
- Usar secret manager del proveedor cloud.
- Configurar rate limits por IP y usuario.
- Separar credenciales por ambiente.
- Revisar permisos de GitHub Actions.

## Datos

- Base transaccional productiva: Postgres.
- Geoespacial productivo: PostGIS.
- Backups automaticos diarios.
- Restore probado antes de abrir beta.
- Auditoria append-only para acciones administrativas.
- Ledger append-only para pagos y liquidaciones.

## Observabilidad

- Logs estructurados con `requestId`.
- Alertas por error rate, latencia p95, backlog de dispatch y pagos fallidos.
- Dashboard de API, DB, workers, realtime y colas.
- Trazas distribuidas con OpenTelemetry cuando haya servicios separados.
- Sentry o equivalente para errores frontend/mobile/backend.

## Operacion

- Runbook para caida de pagos.
- Runbook para zona sin drivers.
- Runbook para saturacion de comercios.
- Runbook para reintentos de dispatch.
- Rollback documentado.
- Canal de incidentes para soporte/operaciones.

## Criterio minimo para beta cerrada

- CI verde en `main`.
- Staging con datos separados.
- Superadmin protegido.
- Logs y alertas activos.
- Pagos en sandbox integrados.
- Realtime inicial para tracking.
- Primer build mobile instalable.
