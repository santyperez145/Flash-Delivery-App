# Base local PostgreSQL/PostGIS

## Estado verificado

- PostgreSQL 17.11 y PostGIS 3.6.2.
- Instancia aislada en `127.0.0.1:55432`.
- Base `flash`, propiedad del rol sin privilegios `flash_app`.
- Autenticacion local `scram-sha-256`.
- Credenciales separadas: owner/migrador `flash_app`, servicio `flash_runtime`
  sin `BYPASSRLS`, y auditor restringido `flash_rls_audit`.
- Migraciones `001` a `041` aplicadas transaccionalmente.
- Binarios y datos fuera de Git en `%LOCALAPPDATA%\FlashDelivery`.

La clave local y `DATABASE_URL` viven en `.env.local`, que está ignorado por
Git. No reutilizar esas credenciales en staging ni produccion.

## Uso diario

```bash
npm run db:start
npm run db:migrate
npm run db:check
npm run dev
```

`db:start` es idempotente: si la instancia ya esta activa solamente comprueba
su readiness. `db:migrate` aplica archivos nuevos de `database/migrations` una
sola vez mediante `schema_migrations`.

## Produccion

Esta instancia es exclusivamente de desarrollo. Produccion requiere PostgreSQL
administrado con PostGIS, TLS obligatorio, secretos en un secret manager,
backups con recuperacion punto en el tiempo, replicas/HA y monitoreo. La API ya
rechaza el arranque productivo sin `DATABASE_URL` y un `JWT_SECRET` propio.
El restore local completo se ensaya con `npm run db:restore:drill`; la evidencia
administrada/PITR sigue siendo un requisito de despliegue.

## Deuda de migracion visible

PostgreSQL ya contiene el esquema real, valida readiness y opera autenticacion,
sesiones, perfiles, agregado de usuarios, catálogo, carrito, pedidos de comida,
viajes, envíos y supply/GPS de drivers.
Wallet, capturas y reintegros de comida/viajes/envíos y ganancias ya usan ledger
de doble entrada. Los webhooks de pago se verifican y deduplican en PostgreSQL.
`server/store.js` permanece como fallback aislado y proveedor de fixtures para
tests sin `DATABASE_URL`. El runtime PostgreSQL construye su estado y cuentas
directamente desde los repositorios PostgreSQL; el smoke integral comprueba cero
lecturas del fallback y que tampoco modifica su archivo. Soporte, notificaciones,
auditoría operacional, favoritos y ratings
operan en PostgreSQL.
Promociones y redenciones también son transaccionales, y las zonas operativas se
persisten como polígonos PostGIS con multiplicadores consumidos por el cotizador.
No se debe eliminar hasta migrar y probar esos
dominios. El
estado se mantiene expresamente marcado como transitorio en `/api/ready` y en
`ROADMAP.md`, para evitar presentar datos demo como produccion.
