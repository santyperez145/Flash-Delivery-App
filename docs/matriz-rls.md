# Matriz de cobertura RLS

Ticket [DAT-001](backlog-tecnico.md#dat-001--matriz-rls-default-deny), hallazgo [H-04](auditoria-2026-08-25.md#h-04--20-tablas-sin-política-rls-y-cero-force-row-level-security). Versión: **26 de agosto de 2026**.

La fuente de verdad es [`database/rls-classification.json`](../database/rls-classification.json), que es legible por máquina y la verifica `npm run test:rls-matrix` en cada PR. Este documento explica las clases y las decisiones; los números salen del archivo.

## Por qué existe

El hallazgo no fue «hay tablas sin RLS». Fue que **nada hacía evidente cuáles**, y que el rol de runtime tiene DML sobre todas:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flash_runtime;
```

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

Cinco tablas están clasificadas `por-usuario` y todavía no tienen política. La lista vive en `scripts/rls-matrix-check.mjs` y **sólo puede achicarse**: la puerta falla si aparece una sexta sin motivo escrito, y también si una de estas gana política y no se la quita de la lista.

| Tabla | Por qué todavía no |
| --- | --- |
| `user_roles` | **Se lee antes de autenticar.** Ver abajo. |
| `drivers` | 39 archivos la consultan, varios sin contexto de usuario |
| `merchants` | 23 archivos la consultan, varios sin contexto de usuario |
| `shipment_details` | Candidata más limpia: vínculo único por `job_id`. Falta la prueba negativa por rol |
| `promotion_redemptions` | Falta la prueba negativa por rol |

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
