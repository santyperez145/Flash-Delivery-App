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

## Esquema muerto

Dos tablas no las referencia ningún archivo de `server/` ni de `scripts/`:

| Tabla | Situación |
| --- | --- |
| `outbox_events` | Ninguna referencia. El outbox real de notificaciones usa otras tablas. |
| `user_security_factors` | Superada por `user_mfa`. Declara columnas para **secretos TOTP y credenciales WebAuthn** que nada escribe ni lee. |

`user_security_factors` es la más incómoda: una tabla con forma de almacén de credenciales, sin política RLS y con DML abierto al rol de runtime, que existe sólo porque nadie la borró. No guarda datos hoy, pero es superficie de ataque gratuita y confunde cualquier revisión.

**Ambas deberían eliminarse con una migración**, no clasificarse indefinidamente. Queda como trabajo de DAT-001.

## `FORCE ROW LEVEL SECURITY`

Sigue en **cero sentencias**. Sin `FORCE`, las políticas no se aplican al dueño de la tabla, que es `flash_app` — el rol migrador.

No es una brecha para el runtime, porque `flash_runtime` no es dueño y sí queda sujeto a las políticas. Pero significa que cualquier consulta hecha con las credenciales de migración omite RLS por completo, y que la separación de roles depende de que nadie use esa conexión para leer datos.

Aplicarlo requiere revisar antes qué migraciones y scripts de mantenimiento leen datos con el rol dueño; hacerlo a ciegas rompería el propio proceso de migración.

## Reglas

1. **Toda tabla nueva se clasifica en el mismo PR que la crea.** La puerta falla si no.
2. Una tabla `por-usuario` sin política sólo pasa si está en la deuda declarada, con su motivo.
3. El campo `rls` de la clasificación tiene que coincidir con las migraciones. Si no, la matriz está describiendo un esquema que ya no existe.
4. Una clasificación no puede sobrevivir a su tabla.
5. **Antes de aplicar una política, verificar si la tabla se consulta sin contexto de usuario.** El camino de login es el ejemplo, no la excepción.

## Qué no cubre esta puerta

`npm run test:rls-matrix` es análisis estático de las migraciones: comprueba que exista `ENABLE ROW LEVEL SECURITY`, no que la política sea **correcta**.

La prueba de denegación real es `npm run test:rls`, que corre en `ci-postgres.yml` contra PostgreSQL con un rol auditor sin ownership ni `BYPASSRLS`. Las dos son necesarias: una impide el olvido, la otra prueba el comportamiento.
