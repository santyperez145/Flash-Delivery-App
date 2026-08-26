# Puertas CI de seguridad

## Estado al 26 de agosto de 2026

`ci.yml` se dividió en **`ci-fast.yml`** y **`ci-postgres.yml`**. La cobertura pasó de **15 a 24 scripts** y, por primera vez, **CI levanta PostgreSQL 17 + PostGIS**. Ambos workflows están **en verde**, con 97 aserciones sobre una base migrada desde cero.

Antes de esta entrega, `main` llevaba en rojo desde el 23 de agosto sin que nadie estuviera bloqueado. Es la prueba práctica del hallazgo: **una puerta que existe pero no se hace cumplir no protege nada.** La primera corrida real destapó dos defectos:

- `test:redis-rate-limit` fallaba porque node-redis 5+ emite un lote de claves por iteración de `scanIterator`, no una clave suelta; un lote vacío se traducía en `DEL` sin argumentos.
- Una base creada desde cero **no era equivalente a una migrada**: ocho migraciones hacen backfill de datos derivados de filas preexistentes. Ver [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada) y `npm run db:seed:derived`.

Contexto: hasta el 25 de agosto, `package.json` declaraba 104 scripts y el workflow ejecutaba 15. La causa raíz era que CI sólo declaraba un servicio Redis, así que ninguna suite que necesitara base de datos podía correr. Hallazgo [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas), ticket [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo), **en curso**.

### Lo que ahora bloquea un merge y antes no

Migraciones desde cero · seeds reproducibles · RLS · cadena de auditoría · aislamiento por ciudad · datos sensibles · poda de claves idempotentes · contrato de audiencias realtime · ratchet de longitud de línea.

Se suma `migrate-from-base`, que sólo se activa en pull requests y por lo tanto **todavía no se ejecutó ninguna vez**.

### Lo que sigue fuera de puerta

Quedan **54 suites `test:*`** sin puerta. La mayoría necesita la API levantada — leen `API_URL` — no sólo una base de datos: pagos, Mercado Pago, conciliación, KYC, vehículos, safety, soporte y recursos por audiencia. Entran con **`ci-critical-flows.yml`**, que debe arrancar el servidor contra la misma instancia PostgreSQL.

`test:security` aparece fuera de la lista automática pero sí corre: está dentro de `npm run check`.

## Workflows

| Workflow | Cuándo | Contenido | Estado |
| --- | --- | --- | --- |
| `ci-fast.yml` | Cada PR | Build · contratos estáticos · secret scan · dependency gate · telemetría · alertas · resiliencia de proveedores · contenedor · rate limit Redis · audiencias realtime · ratchet de línea · typecheck y variantes mobile | **Activo** |
| `ci-postgres.yml` | Cada PR | PostGIS 17 · roles separados · migraciones desde cero · migración incremental sobre la base del PR · RLS · cadena de auditoría · aislamiento por ciudad · datos sensibles · idempotencia | **Activo** |
| `ci-critical-flows.yml` | Cada PR | Pago · webhook · refund · ledger · dispatch · conciliación · KYC · support SLA · safety | Pendiente |
| `ci-nightly.yml` | Cada noche | Playwright E2E · performance · carga k6 · provider sandbox · restore drill · dependency scan completo · mobile build preview | Pendiente |

### Roles de base de datos en CI

`ci-postgres.yml` replica `database/docker-init/001-runtime-roles.sh`: crea `flash_app` (migrador y dueño de la base), `flash_runtime` y `flash_rls_audit`, los tres `NOSUPERUSER` y `NOBYPASSRLS`. Así el runtime en CI tiene exactamente los privilegios del runtime productivo, y `test:rls` puede demostrar denegación real desde un rol auditor sin ownership.

Las contraseñas del workflow pertenecen a un contenedor efímero que sólo existe durante el run y nunca acepta conexiones externas. **No son credenciales y no deben moverse a secretos**: hacerlo daría la impresión de que protegen algo.

### Seeds reproducibles

Las suites de aislamiento afirman sobre catálogo, direcciones y trabajos reales: sin datos no pueden demostrar que un rol ve lo suyo y sólo lo suyo. El workflow siembra `auth`, `addresses`, `commerce`, `orders`, `mobility` y **`derived`**.

`db:seed:derived` es obligatorio y va último. Reaplica los backfills que ocho migraciones hicieron sobre datos preexistentes y que en una base desde cero quedarían vacíos — ver [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada).

Las cuentas demo viven en un contenedor efímero y nunca llegan a un ambiente desplegado.

### Migración incremental

El job `migrate-from-base` existe porque **una migración puede pasar desde cero y romper sobre datos existentes**. Aplica primero el esquema de la rama base del PR y después las migraciones nuevas, que es lo que ocurre en un despliegue real.

Sólo se activa en pull requests. Como esta entrega llegó por push directo a `main`, **el job no se ejecutó todavía**: su primera validación real será el primer PR.

## Contratos individuales

### Escáner de secretos

Revisa archivos tracked y nuevos no ignorados buscando claves privadas y formatos de credenciales AWS, GitHub, Slack, Stripe live y Google. No imprime secretos, sólo ruta, línea y tipo.

### Gate de dependencias

Bloquea vulnerabilidades **altas o críticas** en runtime web/API y mobile. Al 26-08-2026 ambos árboles reportan cero vulnerabilidades conocidas. Mobile fija parches compatibles de Metro y reemplaza las versiones transitivas vulnerables de `image-size` y `uuid` mediante `overrides`; TypeScript, configuración Expo y bundles web/iOS/Android forman parte de la verificación antes de conservar esos overrides.

### Audiencias realtime

`test:realtime-audience` extrae del código todas las publicaciones de `publishRealtimeEvent` y exige que cada una resuelva una audiencia explícita. La difusión a todos los roles se compara contra una lista aprobada: **ampliarla exige tocar el test**, lo que la convierte en una decisión revisable en lugar de un efecto secundario. Es un contrato estático, así que corre en la puerta rápida sin necesidad de PostgreSQL. Ver [`docs/realtime.md`](realtime.md).

### Ratchet de longitud de línea

`test:line-length` fija una línea base por archivo y sólo admite bajarla. Existe porque el código tiene hoy **1.543 líneas de más de 200 caracteres en 120 archivos**, con máximos de 4.061: no se puede exigir el objetivo final antes de reformatear, pero sí impedir que el problema crezca mientras avanza [ARC-001](backlog-tecnico.md#arc-001--modularización).

Tras mejorar un archivo, fijar la mejora con:

```bash
node scripts/line-length-ratchet.mjs --update
```

### Contrato de contenedor

`test:container-security` valida principalmente separación de roles de PostgreSQL: owner/migrador, runtime y auditor, y rechaza roles con `BYPASSRLS`. **No valida** usuario Linux, capabilities, seccomp ni filesystem de sólo lectura — ver el hallazgo [H-05](auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root) y el ticket [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida).

## Reglas de merge

| Regla | Estado |
| --- | --- |
| Un PR queda bloqueado si falla cualquier suite de `ci-fast` o `ci-postgres` | Activo |
| `CODEOWNERS` declara propiedad de dinero, aislamiento y puertas de calidad | Activo |
| Rama `main` protegida con PR obligatoria | **Pendiente: configuración manual en GitHub** |
| Dos aprobaciones para pagos y seguridad | **Pendiente: requiere más de un revisor** |
| Artefactos de test almacenados tras el run | Pendiente |
| Ningún script de riesgo fuera de una puerta sin justificación escrita | Pendiente |

`CODEOWNERS` por sí solo no bloquea nada: exige activar «Require review from Code Owners» en Settings > Branches.

## Comprobar la cobertura

```bash
node -e "const p=require('./package.json'),fs=require('fs');const ci=fs.readdirSync('.github/workflows').map(f=>fs.readFileSync('.github/workflows/'+f,'utf8')).join('');const out=Object.keys(p.scripts).filter(s=>s.startsWith('test:')&&!ci.includes('npm run '+s));console.log(out.length+' suites fuera de CI');console.log(out.join(' '))"
```
