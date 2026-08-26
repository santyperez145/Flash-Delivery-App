# Puertas CI de seguridad

## Estado al 26 de agosto de 2026

`ci.yml` se dividió en tres workflows y **los cinco jobs están en verde**. La cobertura pasó de **15 a 80 de 83 suites** detrás de una puerta, 79 de ellas bloqueantes.

Contexto: hasta el 25 de agosto, `package.json` declaraba 104 scripts y el workflow ejecutaba 15. La causa raíz era que CI sólo declaraba un servicio Redis, así que ninguna suite que necesitara base de datos podía correr. Hallazgo [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas), ticket [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo).

Además, `main` llevaba en rojo desde el 23 de agosto sin que nadie estuviera bloqueado. Es la prueba práctica del hallazgo: **una puerta que existe pero no se hace cumplir no protege nada.**

## Workflows

| Workflow | Cuándo | Contenido | Estado |
| --- | --- | --- | --- |
| `ci-fast.yml` | Cada PR | Build · contratos estáticos · contratos de pago sin proveedor · web y sesión · superficies mobile · secret scan · dependency gate · telemetría · alertas · resiliencia · contenedor · rate limit Redis · audiencias realtime · ratchet de línea · cobertura CI | **Verde** |
| `ci-postgres.yml` | Cada PR | PostGIS 17 · roles separados · migraciones desde cero · migración incremental sobre la base del PR · seeds reproducibles · RLS · cadena de auditoría · aislamiento por ciudad · datos sensibles · idempotencia · comercio, zonas y configuración | **Verde** |
| `ci-critical-flows.yml` | Cada PR | API levantada contra PostgreSQL · runtime smoke · pagos · conciliación · riesgo · payouts · propinas · KYC · vehículos · ganancias · safety · chat · siniestros · SLA · notificaciones · recursos por audiencia | **Verde** |
| `local-fallback` (en `ci-fast`) | Cada PR | API sobre el fallback SQLite · contratos que no son los de PostgreSQL | **Verde** |
| `ci-nightly.yml` | Cada noche | Playwright E2E · performance · carga k6 · provider sandbox · restore drill · dependency scan completo · mobile build preview | Pendiente |

### Qué descubrió cada primera corrida

Levantar las puertas de verdad destapó cuatro defectos que llevaban días o meses sin detectarse:

1. **`test:redis-rate-limit` fallaba desde el 23 de agosto.** node-redis 5+ emite un lote de claves por iteración de `scanIterator`, no una clave suelta; un lote vacío se traducía en `DEL` sin argumentos.
2. **Una base desde cero no era equivalente a una migrada.** Ocho migraciones hacen backfill de datos derivados de filas preexistentes. Ver [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada).
3. **Las cuentas sembradas no podían iniciar sesión.** La migración `052` verifica el email por `UPDATE` sobre los usuarios existentes; en una base nueva quedan sin verificar y la API rechaza todo login. 28 de 32 suites fallaban por esta única causa.
4. **`test:operations-resources` dependía del orden de ejecución.** Exige que ya exista un evento de auditoría y se apoyaba en que `test:postgres` corriera antes.

Que las suites corran en un bucle que registra cada resultado, en lugar de cortar en el primer fallo, es lo que permitió ver «28 fallos, una causa» en una sola corrida.

### Roles de base de datos en CI

`ci-postgres.yml` y `ci-critical-flows.yml` replican `database/docker-init/001-runtime-roles.sh`: crean `flash_app` (migrador y dueño de la base), `flash_runtime` y `flash_rls_audit`, los tres `NOSUPERUSER` y `NOBYPASSRLS`. Así el runtime en CI tiene exactamente los privilegios del runtime productivo, y `test:rls` puede demostrar denegación real desde un rol auditor sin ownership.

Las contraseñas de los workflows pertenecen a contenedores efímeros que sólo existen durante el run y nunca aceptan conexiones externas. **No son credenciales y no deben moverse a secretos**: hacerlo daría la impresión de que protegen algo.

### Seeds reproducibles

Las suites de aislamiento y de flujo afirman sobre catálogo, direcciones y trabajos reales: sin datos no pueden demostrar que un rol ve lo suyo y sólo lo suyo. Los workflows siembran `auth`, `addresses`, `commerce`, `orders`, `mobility`, `wallet` y **`derived`**.

`db:seed:derived` es obligatorio y va último. Reaplica los backfills que ocho migraciones hicieron sobre datos preexistentes y que en una base desde cero quedarían vacíos — incluida la verificación de email, sin la cual **nadie puede iniciar sesión**.

Las cuentas demo viven en contenedores efímeros y nunca llegan a un ambiente desplegado.

### Migración incremental

El job `migrate-from-base` existe porque **una migración puede pasar desde cero y romper sobre datos existentes**. Aplica primero el esquema de la rama base del PR y después las migraciones nuevas, que es lo que ocurre en un despliegue real. Sólo se activa en pull requests, y su primera ejecución fue el PR que introdujo `ci-critical-flows`.

### Rate limiting en flujos críticos

`ci-critical-flows.yml` eleva `RATE_LIMIT_MAX` y `AUTH_RATE_LIMIT_MAX`: treinta suites autenticando contra una sola instancia agotan el límite por defecto de 40 intentos por minuto, y las suites que esperan un `403` recibían un `429`.

**No se deja de verificar el rate limiting.** `test:redis-rate-limit` lo prueba en `ci-fast` con su propio límite bajo y dos réplicas compartiendo Redis, que es donde ese comportamiento corresponde.

## Cuarentena

Una sola suite corre en cada push **sin bloquear** el merge:

| Suite | Causa |
| --- | --- |
| `test:support-routing` | Ruteo atómico de un caso de safety a un agente con skill |

Eran cuatro. Las otras tres se cerraron el 26 de agosto y sus causas resultaron ser defectos reales, no fragilidad de las pruebas:

- **`test:postgres`** fallaba por tres causas encadenadas, todas variantes de [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada): declaraciones de alérgenos sobre ítems de catálogo que ya no existían, sucursales sin horario —que dejaban **todo el catálogo invisible**— y cuentas de fixture recién creadas que el motor de riesgo trataba como nuevas y bloqueaba.
- **`test:dietary-local`** y **`test:notification-local`** afirman el contrato del **fallback SQLite**, que no es el de PostgreSQL: devuelven etiquetas dietarias como strings donde el runtime PostgreSQL devuelve objetos con `.code`. No era interferencia de estado, como suponía la nota de cuarentena: era la prueba equivocada contra el runtime equivocado. Ahora corren en el job `local-fallback`, sin `DATABASE_URL`.

La cuarentena **no es una forma de esconder suites**: siguen corriendo, su salida se publica y `test:ci-coverage` imprime cada una con su motivo. Cerrarlas es condición para dar CI-001 por terminado.

## Contratos individuales

### Escáner de secretos

Revisa archivos tracked y nuevos no ignorados buscando claves privadas y formatos de credenciales AWS, GitHub, Slack, Stripe live y Google. No imprime secretos, sólo ruta, línea y tipo.

### Gate de dependencias

Bloquea vulnerabilidades **altas o críticas** en runtime web/API y mobile. Al 26-08-2026 ambos árboles reportan cero vulnerabilidades conocidas. Mobile fija parches compatibles de Metro y reemplaza las versiones transitivas vulnerables de `image-size` y `uuid` mediante `overrides`; TypeScript, configuración Expo y bundles web/iOS/Android forman parte de la verificación antes de conservar esos overrides.

### Audiencias realtime

`test:realtime-audience` extrae del código todas las publicaciones de `publishRealtimeEvent` y exige que cada una resuelva una audiencia explícita. La difusión a todos los roles se compara contra una lista aprobada: **ampliarla exige tocar el test**, lo que la convierte en una decisión revisable en lugar de un efecto secundario. Es un contrato estático, así que corre en la puerta rápida sin necesidad de PostgreSQL. Ver [`docs/realtime.md`](realtime.md).

El inventario recorre **todo el árbol de `server/`, no un archivo**. Leía sólo `server/index.js`, y cuando ARC-001 empezó a extraer grupos de rutas las publicaciones que se mudaban dejaban de contarse: al sacar las direcciones pasó de 43 a 37 publicaciones **y siguió en verde**, con un `entityType` menos cubierto. Un contrato acoplado a *dónde vive* el código es tan frágil como uno acoplado a *cómo está escrito*, sólo que degrada en silencio en lugar de fallar. El piso de publicaciones es explícito y bajarlo exige escribir por qué.

### Autorización

`test:authorization` afirma directamente las nueve reglas de permisos que viven en `server/http/authorization.js`: quién puede actuar como cliente, conductor o comercio, y quién puede avanzar o cancelar un pedido o un viaje.

Existe porque hasta [ARC-001](backlog-tecnico.md#arc-001--modularización) paso 3 esas reglas estaban dentro de un archivo de 9.500 líneas y **la única forma de ejercitarlas era levantar la API entera**. Eso cubre los caminos que alguien recordó probar, no la regla. Al quedar puras —sin base de datos, sin Express— se afirman una por una sin red ni credenciales, incluidos los casos que un smoke de extremo a extremo no llega a montar: el administrador con MFA habilitado y sin verificar, el pedido cuyo comercio ya no existe, y el conductor que no es el asignado.

La suite también afirma que **el módulo no vuelve a depender de la base**. Sin esa aserción, la propiedad que hace verificable a todo lo demás se pierde en el primer PR que la olvide.

### No divulgación en errores 5xx

`test:error-disclosure` verifica que un 500 no describa su causa. Tiene dos mitades: afirma la política sobre `failFrom` directamente, y recorre las **316 llamadas a `fail()`** del árbol del servidor para impedir que el patrón vuelva.

El manejador global ya aplicaba la política, pero **130 handlers la puenteaban** capturando el error ellos mismos y respondiendo `error.message` en un 500. Se encontró **abriendo la aplicación en un navegador**: `/api/admin/payouts` sobre el fallback devolvía `Cannot read properties of null (reading query)` al cliente. Ningún contrato estático lo veía, porque el código no estaba roto — sólo era indiscreto.

La comprobación analiza cada llamada completa contando paréntesis, no una forma de escribirla. La primera versión buscaba una cadena línea por línea y **tenía un punto ciego**: no veía el 500 escrito como literal. Lo encontró otra vez el navegador, no la suite.

### Contratos sobre código fuente

Nueve suites del frente y varias del servidor afirman que cierta lógica existe leyendo el código. Dependen de dos propiedades, y las dos costaron un hallazgo cada una.

**No dependen del formato.** `contains` compara ignorando el espaciado. Al reformatear en ARC-001 paso 1, ocho suites fallaron porque afirmaban sobre `entry.lat!==null` y Prettier escribió `entry.lat !== null`.

**No dependen de la ubicación.** `readAudienceSource` lee el árbol de una audiencia entera, no un archivo. Un contrato con la ruta fija no se rompe cuando el código se mueve: **se vacía**, que es peor. Ya pasó dos veces en este repositorio — `test:realtime-audience` bajó de 43 a 37 publicaciones y `test:web-tracking-maps` contaba 4 de 5 usos del mapa desde que `RideHome` se extrajo, las dos en verde.

**Y no pueden pasar sobre nada.** `section` lanza si el marcador de inicio falta o si la región entre marcadores colapsa por debajo de un piso; `containsNone` se niega a responder sobre una región demasiado chica. Una aserción de ausencia sobre una región vacía pasa siempre: no es una aserción débil, es ninguna.

### Formato

`test:format` verifica que todo el código pase por Prettier. Es la puerta que impide que el código vuelva a derivar al estado del hallazgo [H-08](auditoria-2026-08-25.md#h-08--concentración-monolítica-extrema): líneas de hasta 4.061 caracteres que hacían ilegible cualquier diff.

El ratchet acota el daño heredado; el formateador impide que se genere daño nuevo.

### Ratchet de longitud de línea

`test:line-length` fija una línea base por archivo y sólo admite bajarla. Existe porque el código tiene hoy **1.543 líneas de más de 200 caracteres en 120 archivos**, con máximos de 4.061: no se puede exigir el objetivo final antes de reformatear, pero sí impedir que el problema crezca mientras avanza [ARC-001](backlog-tecnico.md#arc-001--modularización).

Tras mejorar un archivo, fijar la mejora con:

```bash
node scripts/line-length-ratchet.mjs --update
```

### Contrato de contenedor

`test:container-security` valida principalmente separación de roles de PostgreSQL: owner/migrador, runtime y auditor, y rechaza roles con `BYPASSRLS`. **No valida** usuario Linux, capabilities, seccomp ni filesystem de sólo lectura — ver el hallazgo [H-05](auditoria-2026-08-25.md#h-05--la-imagen-docker-no-corresponde-al-arranque-real-y-corre-como-root) y el ticket [INF-001](backlog-tecnico.md#inf-001--imagen-productiva-endurecida).

## Relanzar una corrida

Los tres workflows aceptan `workflow_dispatch`: se relanzan a mano desde la pestaña **Actions**, eligiendo el workflow y pulsando **Run workflow**.

No es una comodidad. El **26 de agosto de 2026** una corrida murió en `startup_failure` **con cero jobs**, y las otras dos ni siquiera se crearon. Los blobs de los tres workflows eran byte-idénticos a los de la corrida verde de quince minutos antes, el YAML parseaba con 7 jobs, el repositorio es público —así que no hay límite de minutos— y GitHub no reportaba incidentes. Fue un fallo de agendamiento de la plataforma.

Sin `workflow_dispatch`, la única forma de limpiar eso era **empujar otro commit**. En un repositorio donde CI es la puerta de merge, eso convierte un problema transitorio de la plataforma en un commit basura en el historial, o —peor— en una entrega que se publica sin verificar porque relanzar costaba demasiado.

## Reglas de merge

| Regla | Estado |
| --- | --- |
| Un PR queda bloqueado si falla cualquier suite de las tres puertas | Activo |
| Una suite nueva no puede quedar fuera de toda puerta sin motivo escrito | Activo (`test:ci-coverage`) |
| `CODEOWNERS` declara propiedad de dinero, aislamiento y puertas de calidad | Activo |
| Rama `main` protegida con PR obligatoria | **Pendiente: configuración manual en GitHub** |
| Dos aprobaciones para pagos y seguridad | **Pendiente: requiere más de un revisor** |
| Artefactos de test almacenados tras el run | Pendiente |

`CODEOWNERS` por sí solo no bloquea nada: exige activar «Require review from Code Owners» y «Require status checks» en Settings > Branches.

## Comprobar la cobertura

```bash
npm run test:ci-coverage
```

Falla cuando un script `test:*` no está referenciado por ningún workflow, cuando una excepción quedó obsoleta, o cuando una suite en cuarentena ya no existe. Cada excepción y cada cuarentena necesita un motivo escrito, y se imprimen en cada corrida.
