# Matriz de cobertura RLS

Ticket [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny), hallazgo [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security). Versión: **26 de agosto de 2026**.

La fuente de verdad es [`database/rls-classification.json`](../database/rls-classification.json), que es legible por máquina y la verifica `npm run test:rls-matrix` en cada PR. Este documento explica las clases y las decisiones; los números salen del archivo.

## Por qué existe

El hallazgo no fue «hay tablas sin RLS». Fue que **nada hacía evidente cuáles**, y que el rol de runtime tiene DML sobre todas:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flash_runtime;
```

Desde la migración 116 eso está acotado en dos frentes: el runtime perdió la escritura sobre las ocho tablas de referencia donde nunca escribe, y **se retiró la regla de privilegios por omisión** que hacía nacer con DML a toda tabla nueva. `test:grant-scope` impide que cualquiera de las dos vuelva. Falta acotar por operación las 96 restantes.

Donde no hay política, la única barrera es el código de aplicación. Un bug de ownership en un handler equivale a exposición total de esa tabla. Y sin una matriz, cada tabla nueva reproduce el problema en silencio.

## Estado

| Clase | Tablas | Significado |
| --- | ---: | --- |
| `por-usuario` | 65 | Las filas pertenecen a un usuario o a los participantes de un trabajo. **Debe** tener política RLS. |
| `global-lectura` | 24 | Configuración o catálogo público. Legible por cualquier sesión; la escritura se restringe por RBAC en la API. |
| `servicio` | 15 | Sólo la tocan el runtime o los workers. No hay camino de acceso directo desde una sesión de usuario. |
| `sin-uso` | 2 | Esquema muerto. |
| **Total** | **106** | |

**Cobertura de la clase que importa: 60 de 65 tablas `por-usuario` tienen política.**

## Deuda declarada

Una tabla está clasificada `por-usuario` y todavía no tiene política. La lista vive en `scripts/rls-matrix-check.mjs` y **sólo puede achicarse**: la puerta falla si aparece una sexta sin motivo escrito, y también si una de estas gana política y no se la quita de la lista.

| Tabla | Por qué todavía no |
| --- | --- |
| `user_roles` | **Se lee antes de autenticar.** Ver abajo. |

### Cerrada: `shipment_details`

La migración `113_shipment_details_rls.sql` le aplicó política el 27 de agosto de 2026, y era la que más incomodaba de las cinco: guarda `recipient_name`, `recipient_phone` y `delivery_pin_hash` — el nombre y el teléfono de una persona que **ni siquiera es usuaria de la plataforma**, más el hash del PIN con el que se prueba la entrega.

Sin `ENABLE ROW LEVEL SECURITY`, cualquier rol con un `GRANT SELECT` leía los datos de contacto de todos los destinatarios del sistema.

La forma es la de `job_items_via_job` y no una nueva: la visibilidad cae en cascada por la política de `jobs`, que ya decide quién participa de un trabajo. Copiar esa decisión habría dejado dos reglas de acceso que en algún momento dejan de coincidir.

**El `GRANT SELECT` al rol auditor se agregó en la misma migración, a propósito.** Sin él la prueba negativa demostraría que falta el permiso, no que la política funciona: con el permiso puesto, que el auditor siga viendo cero filas sólo lo puede explicar RLS.

`test:rls` afirma las dos mitades, y la segunda importa tanto como la primera: **una política que niega a todo el mundo pasa el test negativo y rompe el producto.** Por eso se comprueba también que un cliente autenticado no vea destinatarios de envíos ajenos, lo que sólo puede pasar si la política discrimina en lugar de cerrar.

### Cerrada: `promotion_redemptions`

La migración `114_promotion_redemptions_rls.sql` la cerró el mismo día. Dice qué promoción usó cada persona, cuándo y por cuánto dinero: sin `ENABLE`, cualquier rol con un grant reconstruye el historial de descuentos de todos.

El vínculo es directo por `user_id`, así que la política es la de `addresses_owner`. **Lo delicado no fue la forma sino a quién debía alcanzar.**

Tres consultas del runtime cuentan filas de todos los usuarios a propósito: `order-repository.js` resuelve el cupo global con `count(*) total, count(*) FILTER(WHERE user_id=$2) user_total`, y `configuration-repository.js` publica `usage_count` por promoción con `postgresPool.query` directo, sin contexto de usuario.

Si la política alcanzara al runtime, el efecto no sería un error visible sino algo peor: **una promoción con tope de 100 no se agotaría nunca**, porque cada persona contaría sólo sus propias redenciones. Un descuento sin tope efectivo es dinero.

Aplicarla destapó que **nada afirmaba que ese conteo global funcionara**. `postgres-runtime-smoke.mjs` verificaba la redención leyendo con el rol migrador, que es dueño del esquema y saltea RLS: no podía demostrar nada sobre visibilidad. Ahora hay una afirmación que consulta `usageCount` por la API —es decir, como `flash_runtime`— y exige que siga contando todo.

### Cerradas: `drivers` y `merchants`

La migración `115_driver_merchant_rls.sql` las cerró el 27 de agosto de 2026, y el motivo registrado para no hacerlo —«39 y 23 archivos las consultan, varios sin contexto»— **no resistió el inventario**.

El conteo real sobre `drivers` da **55 consultas SQL en 20 archivos**: 26 corren con contexto (`client.query` dentro de `withDatabaseContext`) y 16 usan `postgresPool.query` directo. Entre esas 16 hay casos que **tienen que** ver filas ajenas: `ownerOfDriver` resuelve de quién es una entidad justo antes de saber a quién mostrarla, y el listado de backoffice cruza inquilinos por definición.

Pero eso sólo bloquearía si la política tuviera que alcanzar al runtime, y no tiene: `flash_runtime` recibe su política de servicio como en las otras 66 tablas. **La objeción heredada asumía una política más estricta de la que este esquema usa en todas partes.**

Lo que sí estaba abierto era peor de lo que decía la nota: **`flash_rls_audit` tiene `GRANT SELECT` sobre las dos desde la migración 011 y ninguna tenía `ENABLE`.** El rol que existe para demostrar aislamiento leía el nombre, la patente, la posición en vivo y la calificación de todos los conductores, y el dueño y la ubicación de todos los comercios.

Las políticas incluyen `support` además de `admin`, igual que `jobs_participants`: soporte atiende casos sobre conductores y comercios que no son suyos.

### El caso difícil: `user_roles`

`server/auth-repository.js` resuelve la identidad con un `JOIN` a `user_roles` **antes de que exista contexto de usuario** — es el propio camino de login, y usa `postgresPool.query` directo en lugar de `withDatabaseContext`.

Una política del estilo `USING (user_id = app.current_user_id())` devolvería cero filas en esa consulta y **rompería el login de toda la plataforma**.

Aplicar RLS acá exige primero mover el camino de login a una función `SECURITY DEFINER` acotada, que resuelva credenciales y roles sin exponer la tabla al resto de las consultas. Es un cambio de diseño, no una migración mecánica, y por eso queda declarado en lugar de improvisado.

Esto vale como advertencia general: **antes de aplicar una política hay que saber si la tabla se consulta sin contexto.** El resto de la deuda comparte esa incógnita en distinto grado.

## Esquema muerto — eliminado

La migración `112_drop_dead_schema.sql` borró las dos tablas que ningún archivo
de `server/` ni de `scripts/` referenciaba. La matriz pasó de 106 tablas a 104.

| Tabla | Por qué se borró |
| --- | --- |
| `outbox_events` | El patrón outbox de la migración 001, nunca implementado. La entrega diferida real vive en `notifications` y `notification_deliveries`. |
| `user_security_factors` | Superada por `user_mfa`. Declaraba columnas para **secretos TOTP y credenciales WebAuthn** que nada escribía ni leía. |

`user_security_factors` era la incómoda, y conviene entender por qué antes de
que alguien cree otra igual: una tabla con forma de almacén de credenciales, sin
política RLS, alcanzable por el rol de runtime a través del `GRANT ... ON ALL
TABLES` que este ticket todavía debe restringir. Existía un depósito de segundos
factores sin condición de fila y sin nadie vigilándolo, precisamente porque nadie
lo usaba. El día que alguien la hubiera adoptado, habría heredado esa ausencia de
política sin notarlo.

Se borran en lugar de dejarlas clasificadas: **una tabla sin uso no se puede
probar**, así que su deuda de RLS no se cierra de otra forma. Si alguna vuelve a
hacer falta, vuelve con su política y su prueba negativa en el mismo PR.

Borrarlas expuso que la puerta contaba `CREATE TABLE` y nunca `DROP TABLE`, así
que una tabla eliminada habría seguido clasificada —y contando como cubierta por
una política que se fue con ella— para siempre. La regla 4 de abajo ya lo exigía;
ahora `test:rls-matrix` la verifica.

## `FORCE ROW LEVEL SECURITY`

Sigue en **cero sentencias**, y esta es la explicación de por qué no alcanza con
aplicarlo y listo.

Sin `FORCE`, las políticas no rigen para el dueño de la tabla. El dueño es
`flash_app`, el rol migrador, que es también el que corre las migraciones y
`scripts/db-seed-derived.mjs` —trabajo que por definición tiene que tocar filas
de todos los usuarios—. Aplicar `FORCE` a todo rompería ese trabajo, así que no
es una casilla pendiente por descuido: es una decisión con un costo real del otro
lado.

**No es una brecha para el runtime.** `flash_runtime` no es dueño y es
`NOBYPASSRLS`, así que las políticas se le aplican enteras.

El riesgo concreto es otro y es de configuración: si `DATABASE_URL` apuntara
alguna vez a `flash_app` en lugar de a `flash_runtime` —una copia de `.env`, una
sesión de depuración, un despliegue mal armado—, **todas las políticas dejarían
de aplicarse en silencio**. Ninguna consulta fallaría; simplemente devolverían
las filas de todo el mundo.

Contra eso hay dos capas. `GET /api/ready` devuelve 503 en producción cuando el
rol conectado puede saltear RLS —`least_privilege` compara `rolbypassrls` y el
dueño de `users` contra el rol actual—, lo que quita la instancia del
balanceador. Y desde `server/rls-guard.js`, **el proceso directamente no
arranca**: un proceso que falla readiness sigue respondiendo a quien lo alcance
directo, y «directo» incluye un balanceador mal configurado, un `port-forward` y
cualquier tráfico interno.

La negativa tiene tres excepciones, cada una por un motivo distinto:

| Caso | Por qué arranca igual |
| --- | --- |
| Fuera de producción | El desarrollador corre migraciones y aplicación con la misma URL; negarse volvería inusable el entorno local sin proteger nada real. |
| Sin `DATABASE_URL` | Corre el respaldo SQLite, que no tiene RLS que saltear. |
| Base caída | No se puede afirmar nada del rol. Negarse convertiría una caída transitoria en un proceso que no levanta —daño seguro a cambio de uno hipotético— y `/api/ready` ya devuelve 503 mientras tanto. |

`test:rls-guard` recorre esa tabla sin levantar base ni proceso, porque la
decisión es una función pura sobre el resultado de `postgresReadiness()`.

## Reglas

1. **Toda tabla nueva se clasifica en el mismo PR que la crea.** La puerta falla si no.
2. Una tabla `por-usuario` sin política sólo pasa si está en la deuda declarada, con su motivo.
3. El campo `rls` de la clasificación tiene que coincidir con las migraciones. Si no, la matriz está describiendo un esquema que ya no existe.
4. Una clasificación no puede sobrevivir a su tabla.
5. **Antes de aplicar una política, verificar si la tabla se consulta sin contexto de usuario.** El camino de login es el ejemplo, no la excepción.

## Qué no cubre esta puerta

`npm run test:rls-matrix` es análisis estático de las migraciones: comprueba que exista `ENABLE ROW LEVEL SECURITY`, no que la política sea **correcta**.

La prueba de denegación real es `npm run test:rls`, que corre en `ci-postgres.yml` contra PostgreSQL con un rol auditor sin ownership ni `BYPASSRLS`. Las dos son necesarias: una impide el olvido, la otra prueba el comportamiento.
