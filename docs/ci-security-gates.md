# Puertas CI de seguridad

## Estado al 29 de agosto de 2026

`ci.yml` se dividió en cuatro workflows. La cobertura pasó de 15 a **106 de 109 suites** detrás de una puerta: **104 bloquean el merge**, 2 corren de noche y la cuarentena está vacía. `test:k6-local` está escrito; cablearlo al nocturno es bloqueo del dueño (scope `workflow`).

Desde el 27 de agosto la rama `main` **está protegida**: los siete checks son obligatorios, la rama debe estar al día, la historia es lineal y no hay excepción para administradores. Hasta ese día se habían mergeado once PR con CI en verde sin que nada lo exigiera.

Contexto: hasta el 25 de agosto, `package.json` declaraba 104 scripts y el workflow ejecutaba 15. La causa raíz era que CI sólo declaraba un servicio Redis, así que ninguna suite que necesitara base de datos podía correr. Hallazgo [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas), ticket [CI-001](backlog-tecnico.md#ci-001--pipeline-productivo).

Además, `main` llevaba en rojo desde el 23 de agosto sin que nadie estuviera bloqueado. Es la prueba práctica del hallazgo: **una puerta que existe pero no se hace cumplir no protege nada.**

## Workflows

| Workflow | Cuándo | Contenido | Estado |
| --- | --- | --- | --- |
| `ci-fast.yml` | Cada PR | Build · contratos estáticos · contratos de pago sin proveedor · web y sesión · superficies mobile · secret scan · dependency gate · telemetría · alertas · resiliencia · contenedor · rate limit Redis · audiencias realtime · ratchet de línea · cobertura CI | **Verde** |
| `ci-postgres.yml` | Cada PR | PostGIS 17 · roles separados · migraciones desde cero · Testcontainers aislado · migración incremental sobre la base del PR · seeds reproducibles · RLS · cadena de auditoría · aislamiento por ciudad · datos sensibles · idempotencia · comercio, zonas y configuración | **Verde** |
| `ci-critical-flows.yml` | Cada PR | API levantada contra PostgreSQL · runtime smoke · pagos · conciliación · riesgo · payouts · propinas · KYC · vehículos · ganancias · safety · chat · siniestros · SLA · notificaciones · recursos por audiencia | **Verde** |
| `local-fallback` (en `ci-fast`) | Cada PR | API sobre el fallback SQLite · contratos que no son los de PostgreSQL | **Verde** |
| `ci-nightly.yml` | 06:00 UTC y a mano | Auditoría responsive en navegador real, una corrida por variante · latencia de endpoints contra PostgreSQL | **Existe** desde el 27-08. `test:k6-local` listo en repo; cablear YAML = dueño (`workflow`). Sin sandbox de proveedores ni builds EAS |

### Qué descubrió cada primera corrida

Levantar las puertas de verdad destapó cuatro defectos que llevaban días o meses sin detectarse:

1. **`test:redis-rate-limit` fallaba desde el 23 de agosto.** node-redis 5+ emite un lote de claves por iteración de `scanIterator`, no una clave suelta; un lote vacío se traducía en `DEL` sin argumentos.
2. **Una base desde cero no era equivalente a una migrada.** Ocho migraciones hacen backfill de datos derivados de filas preexistentes. Ver [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada).
3. **Las cuentas sembradas no podían iniciar sesión.** La migración `052` verifica el email por `UPDATE` sobre los usuarios existentes; en una base nueva quedan sin verificar y la API rechaza todo login. 28 de 32 suites fallaban, al 25-08, por esta única causa.
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

### Vitest y Testcontainers

`test:authorization` es la primera suite unitaria migrada al runner estándar Vitest 4.1: sus
siete casos conservan la matriz completa de ownership y MFA, y siguen corriendo en
`ci-fast`. La segunda mitad de `test:runtime-role-shape` inicia `postgis/postgis:17-3.5` en
un puerto asignado por Docker, crea `flash_app`, `flash_runtime` y `flash_rls_audit`, ejecuta
las 137 migraciones con el rol migrador y comprueba PostGIS 3.5 y la ausencia de ownership,
`SUPERUSER` y `BYPASSRLS` en runtime y auditoría.

La suite de contenedor corre encadenada a una puerta ya bloqueante del job
`schema-and-isolation`; agregar un script sin conectarlo al workflow sólo habría cambiado la
herramienta, no la protección. El servicio
PostgreSQL declarado por GitHub se mantiene porque aloja las suites extensas y el restore drill;
el contenedor aislado prueba que el arranque no depende de esa preparación previa.

**Decisión tecnológica.** Se eligió Vitest porque el repositorio ya usa Vite 7, ESM y Node 22:
comparte resolución y transformaciones sin introducir la segunda cadena de compilación que
exigiría Jest. Vitest 4 requiere Vite 6 o superior y Node 20 o superior según su
[guía oficial](https://v4.vitest.dev/guide/), por lo que no baja ni altera el runtime soportado.
Se eligió el módulo específico
[`@testcontainers/postgresql`](https://node.testcontainers.org/modules/postgresql/) en lugar del
paquete genérico usado directamente: limita la API de prueba al recurso que necesitamos y permite
usar la misma imagen PostGIS versionada que CI. Ambos proyectos usan licencia MIT, son
dependencias sólo de desarrollo y no viajan en la imagen productiva. El costo aceptado es tiempo
de Docker en CI; por eso no se arranca un contenedor por cada caso ni se reemplaza el servicio
compartido de las suites extensas.

### Rate limiting en flujos críticos

`ci-critical-flows.yml` eleva `RATE_LIMIT_MAX` y `AUTH_RATE_LIMIT_MAX`: treinta suites autenticando contra una sola instancia agotan el límite por defecto de 40 intentos por minuto, y las suites que esperan un `403` recibían un `429`.

**No se deja de verificar el rate limiting.** `test:redis-rate-limit` lo prueba en `ci-fast` con su propio límite bajo y dos réplicas compartiendo Redis, que es donde ese comportamiento corresponde.

## Cuarentena

**La cuarentena está vacía desde el 27 de agosto.** No queda ninguna suite corriendo sin bloquear, y el paso que las ejecutaba se quitó del workflow en lugar de dejarlo iterando sobre una lista vacía.

Si hiciera falta volver a usarla, el patrón era un paso con `continue-on-error: true` que corre las suites en un bucle y publica su salida: no bloquean el merge, pero su resultado aparece en cada corrida para que la deuda sea visible en lugar de silenciosa.

Las cuatro se cerraron, y **en las cuatro la causa anotada estaba equivocada o incompleta**:

- **`test:support-routing`** figuró un mes bajo la causa «ruteo atómico de un caso de safety a un agente con skill». No era eso: `POST /api/support/tickets` exige una cabecera `Idempotency-Key` y responde 400 sin ella, y la suite no la mandaba en ninguno de sus seis POST. **Nunca llegó a ejercitar el ruteo**, se caía en la validación. Con la cabecera puesta, sus diez afirmaciones pasan sin tocar una línea de producto.

  Parte de por qué duró un mes es que todo colgaba de una única aserción compuesta cuyo mensaje era `failed: new safety case routes atomically to skilled available agent` —que no distingue «no se creó» de «se asignó a otro» de «se asignó sin historial»—. Separarla en tres, cada una diciendo qué obtuvo, resolvió el diagnóstico en una corrida.

Y las otras tres, cerradas el 26 de agosto, resultaron ser defectos reales y no fragilidad de las pruebas:

- **`test:postgres`** fallaba por tres causas encadenadas, todas variantes de [H-11](auditoria-2026-08-25.md#h-11--una-base-creada-desde-cero-no-es-equivalente-a-una-migrada): declaraciones de alérgenos sobre ítems de catálogo que ya no existían, sucursales sin horario —que dejaban **todo el catálogo invisible**— y cuentas de fixture recién creadas que el motor de riesgo trataba como nuevas y bloqueaba.
- **`test:dietary-local`** y **`test:notification-local`** afirman el contrato del **fallback SQLite**, que no es el de PostgreSQL: devuelven etiquetas dietarias como strings donde el runtime PostgreSQL devuelve objetos con `.code`. No era interferencia de estado, como suponía la nota de cuarentena: era la prueba equivocada contra el runtime equivocado. Ahora corren en el job `local-fallback`, sin `DATABASE_URL`.

La cuarentena **no era una forma de esconder suites**: seguían corriendo y su salida se publicaba. Pero el patrón tiene un costo que conviene recordar la próxima vez que se use: **una causa anotada con cautela se lee después como un hecho**. Ninguna de las cuatro causas registradas sobrevivió al contacto con la evidencia, y la de `test:support-routing` mandó a buscar un defecto de concurrencia que no existía. Si una suite entra en cuarentena, la causa debería decir **qué se midió**, no qué se supone.

## Contratos individuales

### Escáner de secretos

Revisa archivos tracked y nuevos no ignorados buscando claves privadas y formatos de credenciales AWS, GitHub, Slack, Stripe live y Google. No imprime secretos, sólo ruta, línea y tipo.

### Gate de dependencias

Bloquea vulnerabilidades **altas o críticas** en runtime web/API y mobile. Al 26-08-2026 ambos árboles reportan cero vulnerabilidades conocidas. Mobile fija parches compatibles de Metro y reemplaza las versiones transitivas vulnerables de `image-size` y `uuid` mediante `overrides`; TypeScript, configuración Expo y bundles web/iOS/Android forman parte de la verificación antes de conservar esos overrides.

### Audiencias realtime

`test:realtime-audience` extrae del código todas las publicaciones de `publishRealtimeEvent` y exige que cada una resuelva una audiencia explícita. La difusión a todos los roles se compara contra una lista aprobada: **ampliarla exige tocar el test**, lo que la convierte en una decisión revisable en lugar de un efecto secundario. Es un contrato estático, así que corre en la puerta rápida sin necesidad de PostgreSQL. Ver [`docs/realtime.md`](realtime.md).

El inventario recorre **todo el árbol de `server/`, no un archivo**. Leía sólo `server/index.js`, y cuando ARC-001 empezó a extraer grupos de rutas las publicaciones que se mudaban dejaban de contarse: al sacar las direcciones pasó de 43 a 37 publicaciones **y siguió en verde**, con un `entityType` menos cubierto. Un contrato acoplado a *dónde vive* el código es tan frágil como uno acoplado a *cómo está escrito*, sólo que degrada en silencio en lugar de fallar. El piso de publicaciones es explícito y bajarlo exige escribir por qué.

### Autorización

`test:authorization`, ejecutado por Vitest, afirma directamente las nueve reglas de permisos que viven en `server/http/authorization.js`: quién puede actuar como cliente, conductor o comercio, y quién puede avanzar o cancelar un pedido o un viaje.

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

### Referencias sin resolver

`test:module-references` recorre `server/**` con un AST y reporta cualquier nombre que no esté ligado ni importado. Existe por un error concreto de [ARC-001](backlog-tecnico.md#arc-001--modularización) que se repitió tres veces: el bloque de rutas movido usaba algo que se quedaba en `server/index.js`, y el import no se agregaba.

Node no lo detecta al importar el módulo, porque la referencia está dentro del handler: falla recién cuando llega un request. Así el error llegaba a CI como suite roja en vez de fallo de arranque, con un mensaje que no dice qué falta.

Pagó su costo repetidas veces. Dos de ellas evitaron un borrado silencioso: un `app.use(...)` que estaba entre las rutas de un grupo se venía con el bloque, y sin esta puerta el router quedaba desmontado —sus rutas dejaban de existir— con `npm run check` en verde, porque el respaldo SQLite no las ejercita.

### Declaraciones internas muertas

`test:dead-code` busca lo contrario que la puerta de arriba: una definición sin uso, no un uso sin definición. Existe porque extraer rutas hace fácil **copiar en lugar de mover**, y el resultado —dos definiciones idénticas, una muerta— no rompe nada y por eso no lo ve nadie.

Encontró dos al escribirse: `publicRestaurantFallback`, duplicada al extraer el router de catálogo, y `GOOGLE_PLACES`, sobrante de [GEO-001](backlog-tecnico.md#geo-001--proveedor-de-mapas).

Cuenta apariciones del identificador en vez de resolver referencias. Es una sobreaproximación hacia «está usado»: puede dejar pasar código muerto, pero **no puede acusar a código vivo**, que es la única forma de que una puerta así no termine desactivada.

### Redacción del usuario

`test:user-view` verifica que `sanitizeUser` siga sacando el hash de contraseña, la clave primaria interna y el bloqueo de login, y que **nadie duplique esa redacción**. La duplicación es el riesgo real: encontró una copia escrita a mano en `auth-repository.js` el día que se escribió.

Busca la redacción de los tres campos y no cualquier `{ password, ... }`, porque el respaldo SQLite tiene su propia proyección que saca sólo `password` y **es correcta**: ahí los usuarios no tienen las otras dos columnas.

### Conversión de dinero

`test:money` impide una cuarta copia de `pesos`, que estaba definida tres veces con el mismo cuerpo, y fija en **26** las conversiones en línea que la unificación dejó a la vista.

El trinquete no es cosmético. Las tres copias llevaban una guarda `|| 0` que convierte una columna ausente en cero —«no se cobró nada»—; las 26 restantes no la tienen y dan `NaN`. Las dos respuestas son defendibles y ninguna se eligió: se escribieron distinto en momentos distintos. El número sólo puede bajar, así que quien toque una tiene que decidir.

### Negativa de arranque por rol con bypass de RLS

`test:rls-guard` recorre la tabla de casos de `server/rls-guard.js`, que impide arrancar en producción con un rol de PostgreSQL que puede saltear las políticas. Cubre el riesgo que `FORCE ROW LEVEL SECURITY` no puede cubrir sin romper las migraciones — ver [la matriz](matriz-rls.md#force-row-level-security).

Lo que se prueba es **cuándo se dice que no**, porque una guarda así se rompe por los dos lados: negarse de más deja la plataforma sin arrancar por una caída transitoria de base, y de menos deja servir datos con las políticas apagadas. Las tres excepciones —fuera de producción, sin base configurada, base caída— están declaradas.

### Una pantalla por bundle móvil

`test:mobile-variant-bundles` empaqueta las tres variantes con `expo export` y busca en el bytecode Hermes una cadena propia de cada pantalla, exigiendo una diagonal: cada bundle con la suya y sin las otras dos. Cierra los dos criterios de build de [ARC-001](backlog-tecnico.md#arc-001--modularización), que no se pueden verificar leyendo código porque dependen de qué módulos alcanza Metro.

Los marcadores son ASCII a propósito: el primero llevaba tilde y daba ausente en el bundle que sí contenía esa pantalla, porque Hermes no guarda las cadenas no ASCII donde una búsqueda por bytes las encuentra. Un marcador así convierte la puerta en una que pasa siempre.

### Degradación sobre el respaldo SQLite

`test:fallback-degradation` levanta la API sin `DATABASE_URL` y sondea 54 rutas `GET` con las cuatro audiencias sembradas. **Ninguna puede responder 500.**

El respaldo es el runtime del job `local-fallback` y el de cualquier persona que clone el repositorio sin PostgreSQL. Una ruta que ahí revienta no es un detalle de desarrollo: es la diferencia entre poder trabajar en el proyecto y no poder.

Encontró **17 rutas rotas** —24 respuestas contando audiencias—, entre ellas tres del flujo de conductor que dejaban esa aplicación inutilizable, y toda la cola administrativa: payouts, conciliación, riesgos, tarifas, propinas, cartas muertas y agentes de soporte.

El defecto tiene una forma reconocible y el repositorio ya la había documentado al corregir `PUT /api/cart`: el handler llama a un repositorio de PostgreSQL sin preguntar por `usesPostgresCommerce()`, el pool es `null`, el repositorio lanza un `TypeError` y el `catch` lo convierte en 500. El comentario de aquella corrección sigue siendo la mejor explicación: **un 503 que dice por qué es honesto; un 500 con un `TypeError` no.**

Lo que se afirma es la degradación, no la funcionalidad. Una ruta puede responder 200 vacío, 400, 401, 403, 404 o **503 porque necesita PostgreSQL**. Lo único inadmisible es 500: significa que el servidor no anticipó su propio runtime.

Apareció levantando la aplicación de conductor en un navegador. Ninguna puerta estática lo veía, y no por descuido: estáticamente el código es correcto —la llamada existe, el nombre está importado, el error está capturado—. Es el argumento a favor de tener una suite que ejerza el runtime además de las que leen el código.
### Nocturnas frente a bloqueantes

Desde el 27 de agosto `test:ci-coverage` distingue tres categorías y no dos. Una suite nocturna **tiene** puerta, pero no bloquea un merge, así que contarla junto a las que sí diría que un PR queda frenado por algo que en realidad corre ocho horas después.

Las dos nocturnas están ahí por motivos distintos y los dos son legítimos: `test:performance` mide latencia en un runner compartido, donde bloquear un merge produce reintentos y no calidad; `test:responsive-browser` necesita un navegador real, tres servidores y un bundle de Expo por variante, que es demasiada infraestructura para cada PR.

Lo que la categoría **no** permite es esconder una suite: si una nocturna no aparece invocada en ningún workflow, la puerta falla igual. La etiqueta explica por qué no bloquea, no la exime de correr.

La auditoría de navegador vale la pena de noche por lo que encontró al arreglarse: hasta el 27 de agosto pasaba **sobre la pantalla de login**, porque su marcador de cliente era también el rótulo de un chip previo a autenticarse. Corregida, las tres variantes se auditan ya autenticadas.
### Qué encontró la primera corrida del nocturno

Las tres variantes del navegador pasaron. La latencia falló, y por dos motivos que sólo se ven corriéndola:

**`test:performance` medía `/api/state`**, retirado hace tiempo y que responde 410 desde entonces. La suite llevaba midiendo un endpoint inexistente sin que nadie lo notara, porque estaba fuera de toda puerta. Es exactamente el óxido que acumula una suite excluida, y el argumento a favor de tener nocturno.

**El job medía contra el respaldo SQLite.** Ahí la mitad de los escenarios degrada con 503 y los que responden lo hacen sobre un archivo local, que no se parece en nada a la latencia de producción. Ahora levanta PostgreSQL con roles separados, migra y siembra, como `ci-critical-flows`.

### Alcance de los permisos del runtime

`test:grant-scope` impide que `flash_runtime` recupere el permiso general que la migración 010 le había dado: DML sobre todas las tablas, más una regla de privilegios por omisión que repetía ese permiso sobre **toda tabla futura**.

Esa segunda parte es la que dejó alcanzable un almacén de credenciales muerto durante meses. Nadie tuvo que otorgar nada: `user_security_factors` nació con DML porque la regla existía.

La migración 116 revocó la escritura sobre las ocho tablas de referencia donde el código nunca escribe, y retiró la herencia. **No revoca nada existente** —el permiso se materializa al crear la tabla— pero a partir de ahora una tabla nueva nace sin acceso y hay que otorgárselo a mano en la misma migración que la crea.

Eso cambia el modo de fallar, y a mejor: antes una tabla sin revisar quedaba silenciosamente escribible; ahora falla fuerte y temprano, en CI, con «permission denied for table».

La puerta persigue la forma `ON ALL TABLES` porque es la que uno escribe sin pensar cuando una migración falla por permisos, y resuelve el síntoma deshaciendo la decisión. La migración 010 queda exceptuada: es el registro histórico y las migraciones son de sólo agregar.

**El inventario mecánico no alcanzaba.** Buscar `INSERT`/`UPDATE`/`DELETE` por tabla en `server/**` daba diez candidatas de sólo lectura, y dos eran falsas: `drivers` tiene disparadores que insertan en `driver_availability_sessions` y `driver_job_sessions` cuando alguien se pone en línea, y esas funciones **no** son `SECURITY DEFINER`, así que corren con los permisos de quien las dispara. Revocar ahí habría roto que un conductor se conecte, con un error de permisos dentro de un trigger.
### Dependencias: qué se audita y qué se despliega

Son dos puertas distintas y el orden entre ellas importó.

`test:dependency-gate` audita **cuatro alcances**: raíz y móvil, cada uno en producción y en desarrollo. Antes auditaba sólo lo que se despliega —la pregunta correcta para decidir si un despliegue es seguro— y dejaba fuera el empaquetador, el formateador y el navegador de pruebas. Un compromiso ahí llega igual al artefacto, sólo que por el camino de la construcción.

Los alcances se reportan por separado a propósito: «¿es seguro lo que desplegamos?» y «¿es seguro lo que usamos para construirlo?» son preguntas distintas, y mezclarlas haría que una vulnerabilidad del empaquetador se leyera como un problema de producción.

`test:production-deps` exige que **cada paquete de `dependencies` esté importado por `server/` o `scripts/`**. La imagen instala con `--omit=dev`, así que todo lo que quede ahí se despliega, lo use el servidor o no. Siete paquetes que sólo usa el frente —React, React DOM, `lucide-react`, `maplibre-gl`, el SDK de Mercado Pago, `qrcode` y `concurrently`— viajaban en cada imagen.

Eso no es sólo tamaño: cada paquete en la imagen es superficie —un `postinstall`, una dependencia transitiva, algo que un escáner mira y alguien actualiza—. Un paquete que el proceso nunca importa es riesgo sin contrapartida.

**La auditoría se amplió antes de mover nada.** Con la versión anterior, pasarlos a desarrollo los habría sacado de la auditoría: se habría cambiado tamaño por cobertura, que no es una mejora.

La segunda puerta nació sin poder fallar y hubo que corregirla dos veces. Buscaba el nombre del paquete como cadena suelta, y **los propios contratos de `scripts/` mencionan nombres de paquetes como dato**: `domain-purity-contract.mjs` explica su regla escribiendo `from "react"` en un comentario, así que React figuraba importado por el servidor. Ahora busca formas de importación reales y descarta los comentarios antes de mirar. Se comprobó devolviendo dos paquetes a `dependencies`: los reporta a los dos.

### SBOM y scan de la imagen

El job `container-image` genera un SBOM en CycloneDX y lo publica como artefacto de la corrida. Sirve para responder después *«¿esta imagen tenía el paquete X?»* sin reconstruirla — que es exactamente la pregunta que aparece el día que se publica una vulnerabilidad, cuando reconstruir una imagen de hace tres semanas no da el mismo resultado.

Se usa Trivy por **imagen fijada** y no por una acción del marketplace. Una acción es código de terceros corriendo con el token del workflow, y para esto no hace falta: una etiqueta fija es revisable y se actualiza a propósito.

**La política de fallo bloquea lo que este equipo puede arreglar** — que resultó no ser lo mismo que lo que tiene parche publicado.

La primera versión de esta puerta usaba sólo `--ignore-unfixed` y falló en su primera corrida, con cuatro CVEs altas en `brace-expansion`, `ip-address` y `tar`. Ninguna era del proyecto: son dependencias del propio npm que viene dentro de `node:24-bookworm-slim`, en `/usr/local/lib/node_modules`. Tienen versión corregida upstream, así que `--ignore-unfixed` las conservaba, pero acá no se pueden actualizar sin cambiar de imagen base. La capa Debian, por su parte, dio cero.

El detalle importa porque `npm audit` reportaba **cero** al mismo tiempo. No es que una de las dos se equivoque: miran cosas distintas. `npm audit` mira el árbol declarado del proyecto; Trivy mira todo lo que quedó dentro de la imagen, incluido lo que trae la base. Ninguna de las dos sola responde «¿qué estamos desplegando?».

Bloquear por lo heredado dejaría el merge cerrado por algo que el equipo no puede resolver, y el desenlace conocido de eso es que alguien desactive la puerta — el hallazgo [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas) otra vez, por otro camino. Por eso el scan que corta se salta el `node_modules` de npm y mira lo que agregamos nosotros, que es donde una CVE con arreglo sí es una orden de actualizar.

Lo heredado **no se ignora, se informa**: el paso siguiente lista todo sin cortar, para que cambiar de imagen base siga siendo una decisión con datos y no un descubrimiento.

Que la puerta siguiera pudiendo fallar después de estrecharle el alcance se verificó fijando `jsonwebtoken` en `8.5.1` —CVEs altas con arreglo, dentro de `/app`— y confirmando que el paso corta: 1 HIGH en la capa Node, 0 en Debian. Estrechar el alcance de una puerta es justo el cambio que más fácil la deja inerte.

Esa distinción es la diferencia entre una puerta que se respeta y una que se saltea.

### Partida doble garantizada por la base

`ledger_entries` es un libro de partida doble: cada transacción agrupa débitos y créditos que tienen que sumar lo mismo, y un `CONSTRAINT TRIGGER` diferido lo obliga al commit.

> **Corrección.** La primera versión de esta sección decía que hasta la migración 118 nada lo obligaba. Era falso: la migración **003** ya creaba `ledger_entries_must_balance`, con la misma forma y el mismo momento de disparo. La 118 agregó un duplicado por haber buscado tablas y políticas sobre `ledger_entries` pero no triggers, y la 121 lo quitó. Se conserva el original, que además exige al menos dos asientos.

Lo que sí era nuevo, y es lo que esta sección describe, es la **puerta**.

La matriz de madurez ya declaraba esta capacidad en `CI`. La puerta que la respaldaba era `test:marketplace-ledger`, que prueba `calculateFoodSettlement` —la aritmética del split— y no toca la base. Es una prueba correcta de otra cosa.

El trigger `ledger_entries_must_balance` rechaza al commit toda transacción que no cuadre. Es **diferido y no inmediato** por una razón concreta: la reversión proporcional de incidencias inserta N débitos en un bucle y después un solo crédito por el total, así que un chequeo por sentencia fallaría en el primer débito, que es correcto individualmente. `DEFERRABLE INITIALLY DEFERRED` mira el estado al commit, que es cuando la pregunta tiene sentido. Es seguro porque ninguna transacción se arma entre commits: nada escribe `ledger_transactions` en estado `pending` ni actualiza el estado después.

`test:ledger-balance`, en `ci-postgres`, hace cinco cosas y las cinco hacen falta:

1. **Barre lo ya escrito.** El trigger sólo mira lo que se escribe con él activo; un desbalance anterior seguiría ahí, callado.
2. **Exige que el trigger exista y siga siendo diferido.** Volverlo inmediato no es «más estricto», es romper la reversión proporcional. Esta comprobación se ganó su lugar sola: el trigger llevaba desde la migración 003 sin que nadie verificara que seguía vivo, y precisamente por eso se lo dio por inexistente al escribir la 118.
3. **Le prueba las dos mitades en cada corrida.** Intenta escribir una transacción torcida y exige que la base la rechace; después escribe una que cuadra y exige que la acepte. Un constraint que rechaza todo aprobaría la mitad negativa y rompería el producto. Un constraint que no se ejerce es una afirmación, no una garantía.
4. **Exige que `ledger_transactions.idempotency_key` siga siendo única.** De ahí sale que un pago repetido no genere un segundo asiento. Si alguien quitara el UNIQUE nada fallaría a la vista y la idempotencia moriría en silencio.
5. **Prueba que el barrido sabe encontrar.** En CI la base viene recién migrada, así que el punto 1 recorre cero transacciones: pasaría igual con un `HAVING` mal escrito, y seguiría pasando para siempre. Se escriben asientos torcidos sin llegar al commit —el trigger es diferido, todavía no mira— y se le exige al barrido que los vea, con las sumas correctas. Las dos consultas son **la misma constante**: tener una copia probaría que la copia funciona.

Nada de esto deja datos: las pruebas corren dentro de una transacción que termina en `ROLLBACK`, y el chequeo diferido se adelanta con `SET CONSTRAINTS ... IMMEDIATE` en lugar de llegar al commit.

### Reparto proporcional de un reintegro

Cuando se aprueba una incidencia con reintegro, `resolveOrderIssue` revierte la liquidación del pedido: debita a cada parte —comercio, repartidor, plataforma— en proporción a lo que cobró, acredita el total a la cuenta de compensación, y en una segunda transacción acredita al cliente. **El módulo entero estaba sin cobertura.**

`test:order-refund-split` lo ejercita contra PostgreSQL con números elegidos para que el redondeo importe: una liquidación de 3333/3333/3334 sobre 10000 y un reintegro de 1000. Los ideales caen en 333,3 y 333,4, así que el reparto tiene que dar 333/333/334. Con proporciones exactas cualquier implementación pasa; el valor de la prueba está en los números.

**Lo que destapó:** la consulta que alimenta el prorrateo no tenía `ORDER BY`. El bucle reparte con `floor` y le da el resto al último renglón, y cuál era el último lo elegía el planificador. El centavo sobrante caía en una parte u otra sin regla, y el mismo reintegro podía repartirse distinto al repetirse. No es un error de importes —el total siempre cerraba— sino contabilidad no determinista, que es peor de diagnosticar que un número mal.

La regla ahora está escrita: **el resto lo absorbe la parte con mayor participación**, que es la que menos se distorsiona en términos relativos, y `account_id` desempata. La prueba lo verifica, no sólo comprueba que la suma cierre.

El fixture sembrado tiene que cuadrar como cualquier otra transacción: el trigger de la migración 118 no hace excepciones con las pruebas, y eso es deseable.

La misma prueba cubre el saldo en negativo. Antes del reintegro le vacía la cuenta a la parte mayor con una transacción que cuadra —como haría una liquidación ya cobrada—, así que el reintegro la deja en −334. Sin eso las tres partes terminan en positivo y la mitad interesante del comportamiento no se ejercita nunca. Verifica que se abra **un** caso `negative_balance`, que apunte a la cuenta que efectivamente quedó en rojo, y que registre el saldo real y no sólo el aviso de que hubo un reintegro. Las dos partes que siguen en positivo no abren caso: una implementación que abriera uno por cada reintegro llenaría la bandeja de ruido y aprobaría la comprobación igual.

La regla de negocio detrás está en [Finanzas de comercios](merchant-finance.md#saldo-en-negativo-por-reintegro): el reintegro al cliente nunca se bloquea por el saldo de un tercero.

### Un pago repetido no duplica asientos

`recordMarketplaceCapture` inserta la transacción contable con `ON CONFLICT(idempotency_key) DO NOTHING` y clave `marketplace-capture-<providerPaymentId>`. De ahí sale la idempotencia: si el webhook de Mercado Pago llega dos veces —cosa que pasa, los proveedores reintentan— la segunda no escribe nada y el dinero no se cuenta dos veces.

La garantía tiene dos mitades. La **estructural** es que la columna siga siendo UNIQUE, y la exige `test:ledger-balance`: sin el UNIQUE nada fallaría a la vista y la idempotencia moriría en silencio. La **de comportamiento** es que el código efectivamente use esa clave y trate el conflicto como «ya estaba», y la cubre `test:payment-idempotency`.

La prueba llama a la captura dos veces con el mismo pago y verifica que quede una sola transacción y un solo par de asientos. Después llama con un pago distinto y verifica que **sí** se registre: una implementación que considere duplicado todo pasaría la primera comprobación y perdería pagos, que es peor que contarlos dos veces.

De paso adelanta el chequeo diferido con `SET CONSTRAINTS ... IMMEDIATE`, así que también queda probado que la captura escribe asientos que cuadran y no sólo que no los duplica. Todo termina en `ROLLBACK`.

### Una auditoría que no se escribe hace ruido

`recordPostgresAudit` inserta con `INSERT ... SELECT ... FROM users WHERE public_id = $1`. Si el actor no existe eso inserta **cero filas y no falla**: la acción privilegiada ocurre y su rastro desaparece sin que nadie se entere.

Apareció al escribir la conciliación programada, que no tiene persona detrás. **No era un agujero abierto**: `requireAuth` verifica que el usuario exista antes de dejar pasar la petición, así que las 87 llamadas actuales pasan un actor que siempre resuelve. Era una trampa puesta para el próximo que llamara desde fuera de una sesión — y el próximo era yo.

Ahora hay tres formas, distintas a propósito:

| Actor | Qué pasa |
| --- | --- |
| existe | evento normal, con su `actor_id` |
| no se pasa ninguno | evento anónimo, `actor_id` nulo — «alguien hizo esto y no sabemos quién» es peor que un nombre y muchísimo mejor que nada |
| se pasa y no existe | **error**, porque eso es un defecto de quien llama |

Para lo que sí origina el sistema hay `recordSystemAudit`, que exige declarar un `origin`. Está separada y no es «un actor nulo» porque un evento de sistema y uno cuyo actor no se pudo identificar son cosas distintas, y quien lee la auditoría necesita poder distinguirlas: `actor_id` nulo por sí solo no dice cuál de las dos es.

`test:audit-actor` cubre las cinco formas. La tercera es la que importa; las otras están para que la puerta no pase por el motivo equivocado — una implementación que lance siempre aprobaría la comprobación del error y rompería las 87 llamadas que hoy andan.

Los eventos que la prueba escribe **no se borran**. `audit_events` es append-only por diseño, con su trigger y su cadena de hashes, y abrir el portillo de mantenimiento para limpiar una prueba sería usar la llave equivocada por comodidad.

### La conciliación de pagos corre sola

Hasta ahora `scanPaymentReconciliation()` sólo se disparaba desde `POST /api/admin/payment-reconciliation/scan`, es decir cuando alguien se acordaba de apretar el botón. Una conciliación que depende de que alguien se acuerde no es una conciliación: la diferencia aparece igual, lo que cambia es cuánto tarda en verse.

`npm run job:payment-reconciliation` es el punto de entrada sin persona detrás. **No trae su propio planificador a propósito.** Un `setInterval` dentro del servidor corre una vez por réplica —con dos réplicas se concilia dos veces— y no sobrevive a un reinicio en el momento equivocado. El planificador es del entorno que despliega: `cron`, un `CronJob` de Kubernetes, lo que haya. Acá está lo que ese planificador invoca.

Corre desatendido cada noche en `ci-nightly`, que no reemplaza al planificador productivo pero prueba la mitad que sí depende de este repositorio: que el punto de entrada funcione sin sesión.

**Sale con cero aunque haya casos abiertos, y eso es deliberado.** Encontrar diferencias es el resultado esperado de conciliar, no una falla del trabajo. Un trabajo que se pone rojo cada vez que encuentra algo termina silenciado en dos semanas, y ahí sí se pierden las diferencias — el mismo mecanismo de [H-01](auditoria-2026-08-25.md#h-01--ci-no-ejecuta-el-86-de-su-propia-matriz-de-pruebas), una vez más. Lo que sale distinto de cero es que la conciliación no haya podido correr.

El rastro queda en `audit_events` con `origin: scheduled-reconciliation`. Escribir esto es lo que destapó que `recordPostgresAudit` perdía el evento en silencio cuando no había actor: la conciliación programada habría corrido sin dejar rastro, que es justamente lo que un trabajo automático no puede permitirse.

### Un lote que nadie corre es peor que una suite que nadie corre

`test:ci-coverage` verificaba que ninguna suite quedara fuera de los workflows: una suite
que no corre no protege nada. Desde el 28 de agosto verifica también la otra mitad —que cada
lote operativo tenga un punto de entrada desatendido— porque **el lote silencioso no deja
pasar el defecto: es el defecto.**

La puerta comprueba dos cosas opuestas: que el lote **tenga** su entrada en `npm run
worker:*` o `job:*`, y que **no** tenga un `setInterval` dentro del servidor. La segunda
parece la buena mientras hay una sola réplica, y deja de serlo en silencio en cuanto hay dos.

> **Corrección del 28 de agosto, el mismo día.** La primera versión de esta sección afirmaba
> haber descubierto que el despacho, las notificaciones y el SLA de soporte **no tenían**
> punto de entrada, y que por eso un pedido pagado se quedaba sin oferta de conductor. Era
> falso. `worker:dispatch`, `worker:notifications` y `worker:support` existían desde antes,
> con bucle, backoff y apagado ordenado, y estaban documentados en
> [`docs/operations.md`](operations.md). El error fue buscar sólo `job:*` y `setInterval`,
> encontrar lo que se esperaba, y escribirlo como hallazgo.
>
> Queda anotado y no borrado porque es exactamente el mecanismo que este archivo describe en
> otras cuatro ocasiones —**una causa anotada con cautela se lee después como un hecho**— y
> esta vez lo cometió quien escribe las puertas. El trabajo duplicado que salió de ahí se
> borró; la puerta se quedó, apuntando a lo que sí existe.

Las dos primeras versiones de la comprobación pasaron al falsificarlas, y por motivos
distintos que conviene registrar. La primera usaba `includes`: sacarle la llamada al lote no
la ponía en rojo porque el nombre seguía apareciendo en el comentario de cabecera del propio
trabajo —una puerta que se satisface con una mención en prosa no verifica nada—. La segunda
buscaba `setInterval\([^)]*nombreDelLote`, y `setInterval(() => procesarLote(...))` tiene un
`()` en el medio que un `[^)]*` no cruza. Ahora se ignoran los comentarios, se exige el
nombre en posición de llamada, y el temporizador se busca por vecindad.

Lo que la puerta **no** puede verificar es que el entorno ejecute los procesos. Eso vive en
[`docs/deployment-checklist.md`](deployment-checklist.md), con su casilla y su consecuencia
escrita al lado.

### Una tabla que no existe es una referencia sin resolver

`test:module-references` existía porque al extraer grupos de rutas el bloque movido usaba
algo que vivía en `server/index.js` y el import no se agregaba: Node no lo detecta al
importar el módulo, la referencia está dentro del handler, y sólo falla cuando llega un
request.

Un `FROM tabla_que_no_existe` falla de la misma forma y por el mismo motivo, así que desde
el 28 de agosto la misma puerta compara los nombres de tabla que usa el servidor contra las
que crean las migraciones. Apareció escribiendo el tablero de colas de trabajo, que nombra
doce tablas y sus estados: una sola mal tipeada rompe la consulta entera, y sin base local
no había forma de saberlo antes de CI.

**La primera versión reportó 150 referencias y ninguna era real.** Vale registrar por qué,
porque son cuatro formas distintas de que un análisis estático de SQL se equivoque:

- **Comentarios.** Media docena explican una consulta en prosa y contienen `FROM` y `JOIN`.
- **`FOR UPDATE OF c,i`, `DO UPDATE SET x=1`, `FOR UPDATE SKIP LOCKED`.** Palabras clave que
  siguen a `UPDATE` sin ser tablas.
- **Funciones que devuelven filas.** `FROM generate_series(...)` no nombra una tabla; se
  distinguen porque llevan paréntesis pegado.
- **`server/store.js`.** Es el respaldo SQLite con su propio esquema, creado en el mismo
  archivo. Compararlo contra las migraciones de PostgreSQL reportaba todas sus tablas como
  inexistentes, que es exactamente al revés.

Quedó en cero falsos positivos sobre 117 módulos y 113 tablas. Falsificada con dos typos
reales: una tabla del tablero de colas y una referencia a un nombre en singular.

### La audiencia realtime, contra la base

`test:realtime-audience` es estático: comprueba `classifyRealtimeAudience` —una función pura— y que ninguna publicación del servidor difunda a todos los roles por omisión. Es una buena puerta y corre en cada PR sin necesitar base de datos.

Lo que no puede tocar es la mitad donde viviría una fuga de verdad. `ownerOfDriver`, `ownerOfMerchant`, `ownerOfSupportTicket`, `ownerOfAddress` y `participantsOfJob` son consultas SQL con JOINs, y un JOIN mal escrito devuelve al usuario equivocado sin que ninguna comprobación estática se entere. **La clasificación puede estar perfecta y el evento llegar igual a quien no debe.**

`test:realtime-audience-runtime` no verifica `resolveAudience` en aislamiento: publica de verdad sobre los datos sembrados y después le pregunta al **replay** qué recibiría cada usuario, que es la consulta que decide la entrega. La propiedad que interesa no es «el arreglo guardado tiene los ids correctos» sino «este usuario no recibe este evento».

El ticket de soporte se **siembra** en lugar de buscarse. La primera corrida no encontró ninguno en los datos de CI y el caso se saltó con una nota prolija, que es exactamente la forma en que una puerta pierde cobertura sin ponerse roja: `ownerOfSupportTicket` es uno de los cinco resolutores que esto viene a cubrir. Crear la fila ejercita el mismo JOIN contra la misma tabla, y si el fixture no se puede sembrar la puerta falla en lugar de avisar.

Cada caso tiene sus dos mitades: el dueño recibe y un tercero no. Sin la primera, una implementación que no entregara nada a nadie pasaría entera y rompería el producto; sin la segunda no se estaría probando nada de lo que SEC-001 vino a arreglar. El ticket de soporte y la dirección se eligen con dueño distinto del usuario de control, para que el negativo no pase por casualidad.

Se ejercitan además los tres caminos que tienen que cerrarse —`entityType` inventado, evento sin entidad, e identificador mal formado en `address`, que tiene su propia guarda antes de consultar— y en los tres se exige que **sí** llegue a operaciones: un default-deny que también le cierre la puerta a quien tiene que diagnosticar convierte cada incidente en una excavación.

### La ruta del panel de audiencias

`test:realtime-audience-runtime` prueba `getRealtimeAudienceHealth` llamándola directamente, lo que cubre la consulta y la agregación. No cubre la ruta: quién puede pedirla, qué devuelve por HTTP y qué pasa con un parámetro hostil.

Importa porque la respuesta **enumera eventos mal clasificados con su tipo y su entidad**, que no es material para alguien con rol de cliente. `test:realtime-audience-api` exige 401 sin sesión, 403 para un cliente autenticado y 200 para operaciones con la forma que el panel consume.

También acota la ventana: un `hours` gigante no puede convertirse en un barrido de la tabla entera desde una ruta autenticada. El log retiene siete días, así que más allá de eso el número sólo sirve para hacer trabajar a la base. Un `hours` no numérico cae en el valor por omisión en lugar de producir un intervalo inválido.

La última comprobación es la que evita que la puerta pase por el motivo equivocado: el total que devuelve la ruta tiene que **coincidir con lo que hay en la base**. Sin eso, una implementación que devolviera la forma correcta con ceros aprobaría todo lo anterior.

### Artefactos que sobreviven a la corrida

`ci-critical-flows` corre treinta y una suites en un solo paso. El log de Actions sirve para leer mientras pasa, pero es un muro de texto donde el error que importa queda lejos del final, y buscar dentro o comparar contra otra corrida no es práctico.

Cada suite escribe además su propia salida a `test-artifacts/suites/<suite>.log`, y todo se sube como artefacto junto con el log completo de la API. `ci-fast` hace lo mismo con el del respaldo SQLite, donde el fallo típico está en el arranque —justo lo que un `tail -200` se come—.

Se escribe a archivo y después se imprime, en vez de `| tee`: en una tubería el código de salida es el del último comando, así que `tee` convertiría cualquier suite roja en verde. Es el tipo de detalle que apaga una puerta sin que nadie lo note.

**Se suben pase o falle la corrida.** Guardarlos sólo ante un fallo impide la comparación que más sirve: la de una corrida verde contra una roja. Retención de 14 días.

No amplía quién ve qué: un artefacto lo descarga quien ya puede leer el log de la corrida, que hoy publica un `tail` del mismo archivo. Lo que cambia es que el contenido deja de estar truncado.

### Ensayo de restore en cada PR

Un backup que nunca se restauró no es un backup. `scripts/restore-drill.ps1` hace el ensayo que importa —levanta un cluster nuevo, restaura el dump más reciente y verifica invariantes— pero corre sobre la máquina que guarda los backups y es PowerShell: no puede estar en CI.

`test:restore-drill` es **otro** ensayo, no un reemplazo. Vuelca la base de CI, la restaura en una segunda base y corre los invariantes contra la copia.

No prueba que los backups del dueño sean restaurables —eso sólo se puede probar donde están—, pero prueba lo que el ensayo local no puede probar en cada PR: que el esquema, las extensiones, las políticas y los permisos **sobreviven al viaje por `pg_dump`**, en la versión de hoy del esquema. Lo que se rompe en un restore no suele ser el dump; es algo que el dump no lleva.

Lo que verifica: migraciones completas y la última coincidiendo con el repositorio, PostGIS presente, ninguna restricción sin validar, los conteos de filas iguales a los del origen, el ledger cuadrado, **las mismas tablas con RLS activo**, el mismo número de políticas, los mismos permisos de `flash_runtime` y `flash_rls_audit` tabla por tabla, y la cadena de auditoría válida sobre los datos restaurados.

La comprobación de RLS es la que más rinde: una tabla restaurada sin `ENABLE ROW LEVEL SECURITY` responde a todo el mundo **y no falla nunca**. La de permisos cubre el caso de alguien que agrega una tabla y olvida su GRANT — en la base viva no se nota, porque el rol ya tiene permiso sobre las demás.

`pg_dump` y `pg_restore` corren **dentro del contenedor de servicio**: el runner trae un cliente más viejo que el servidor 17 y `pg_dump` se niega a volcar un servidor mayor que él. Adentro la versión coincide por construcción; las comprobaciones corren desde Node por TCP, donde la versión del cliente no importa.

**Limitación declarada:** restaura en el mismo cluster, así que los roles ya existen. Un `pg_dump` de una base no lleva las definiciones de rol, que son de cluster y salen de `pg_dumpall --roles-only`. Que los roles sean recuperables es una pregunta legítima y ésta no la responde.

### Alcance de escritura del runtime

La migración 116 le quitó a `flash_runtime` la escritura sobre las ocho tablas de referencia donde nunca escribe, y retiró la herencia automática que hacía nacer con DML a toda tabla nueva. Quedaba acotar **por operación**, que exige decidir tabla por tabla.

`test:runtime-write-scope` no decide: reúne la evidencia y evita que la lista crezca. Cruza tres fuentes —los permisos de la base, las tablas que un `INSERT`, `UPDATE` o `DELETE` nombra en `server/`, y las que se escriben de rebote por un trigger sin `SECURITY DEFINER`— y trinquetea la cuenta de pares (tabla, operación) que el rol tiene y nadie usa.

Se cuenta por operación y no por tabla porque ésa es la pregunta: la mayoría de las tablas que sobran permisos escriben algo, sólo que menos de lo que pueden. Una tabla que sólo recibe INSERT y UPDATE no necesita DELETE.

**Por qué no revoca solo.** Un inventario mecánico ya se equivocó una vez y por poco mete un fallo en producción: decía que `driver_availability_sessions` y `driver_job_sessions` eran de sólo lectura porque ningún `INSERT` del servidor las nombra. Las escriben triggers sobre `drivers` que **no** son `SECURITY DEFINER`, así que corren con los permisos de quien dispara. La herramienta las detecta ahora, y ése es el motivo de que el análisis de triggers no sea un extra.

Escribirla destapó la misma clase de error en otra forma: `INSERT ... ON CONFLICT ... DO UPDATE` **exige el permiso UPDATE**, y la primera versión sólo veía el INSERT. Reportaba UPDATE como sobrante en `ledger_accounts`, y hacerle caso habría roto `systemAccount`. Hay 27 upserts en `server/`, sobre al menos doce tablas.

La detección se queda del lado seguro: un falso «esta tabla se escribe» conserva un permiso de más, un falso «nadie la escribe» propone quitar uno que hace falta. El primero cuesta una revisión, el segundo un incidente.

La medida inicial: **114 permisos de más en 86 tablas**, sobre 98 con escritura. La lista se acota por lotes, con la suite entera corriendo detrás — y esa verificación es real, porque en CI la API se conecta como `flash_runtime`.

El primer lote (migración 122) quitó **16**, todos de tablas que se escriben una vez y no se tocan más: el libro contable, los registros de eventos, los cobros y los reintegros. Pasan a ser **append-only para el runtime**.

El segundo (migración 123) quitó **26**, la misma idea aplicada a lo que el producto anota porque pasó: un mensaje enviado, una propina dada, un pedido cancelado, una incidencia reportada. Ninguna de esas filas se corrige editándola; si algo estuvo mal, corresponde otra fila que lo diga, que además es lo único que deja rastro de que hubo una corrección.

Ese lote enseñó además la **tercera forma de permiso implícito**, después de los triggers y de `ON CONFLICT DO UPDATE`: un `SELECT ... FOR UPDATE` exige el permiso UPDATE, porque PostgreSQL lo pide para tomar el candado de fila. La encontró `test:tip-adjustments` al ponerse roja — que es exactamente para lo que se acota de a lotes con la suite corriendo como `flash_runtime`.

La herramienta la aprendió, y con un matiz que costó una iteración: sólo cuentan las tablas del nivel exterior. Buscar el `SELECT` más cercano hacia atrás devuelve el de la subconsulta, y `mobility-repository.js` lee `schema_migrations` dentro de un subselect de una sentencia con `FOR UPDATE`. Darla por bloqueada habría conservado la escritura sobre el registro de migraciones — justo el hallazgo que sigue.

Ese lote incluyó el hallazgo más serio del inventario: **`flash_runtime` tenía INSERT, UPDATE y DELETE sobre `schema_migrations`**, el registro de qué migraciones se aplicaron. Con eso, un handler comprometido podía declarar aplicada una migración que no corrió, o borrar el rastro de una que sí — y tanto el despliegue como el ensayo de restore, que compara ese registro contra los archivos del repositorio, descansan en que diga la verdad.

Es la contraparte del trigger de balance. El trigger impide *escribir* una transacción torcida; esto impide *enderezar* una que ya cuadra, o hacerla desaparecer. Sin lo segundo, lo primero se puede rodear en dos sentencias.

El tercer lote (migración 131) quita **11 DELETE** sobre artefactos de identidad y
autorización: sesiones, MFA, dispositivos, verificaciones, enlaces de safety,
OAuth y step-up de payouts. Todos se consumen o revocan con `UPDATE`; borrarlos
desde el proceso que atiende tráfico sólo podría eliminar evidencia. La puerta
no se limita a bajar el total de 71 a 60: consulta PostgreSQL y exige por nombre
que ninguna de esas once tablas conserve DELETE. Las purgas de retención quedan
reservadas para un worker futuro con rol separado y auditoría propia.

### Las cifras de la documentación

El hallazgo [H-10](auditoria-2026-08-25.md#h-10--documentación-desalineada-del-runtime) era el único de los once **sin ticket**, y su ejemplo principal ya derivó dos veces: `ROADMAP.MD` decía «migraciones hasta 105», se corrigió a 110, y hoy hay 122.

No es prolijidad: es la falla que explica a las demás. Una causa de cuarentena que resultó falsa, notas de deuda RLS más restrictivas que el esquema, un criterio cumplido y sin marcar, la matriz declarando una capacidad respaldada por otra prueba. **Una nota escrita con cautela se lee después como un hecho.**

`test:docs-drift` automatiza la parte mecánica: una cifra que el repositorio puede calcular no debería poder mentir. Hoy verifica dos —el recuento de migraciones y el total de suites— y encontró **16 cifras obsoletas en 9 archivos** en su primera corrida.

**La regla tiene dos mitades, y la segunda es la que la hace utilizable:**

> Una cifra vale si coincide con la realidad **o** si su línea declara cuándo fue cierta.

Sin la segunda, la puerta obligaría a reescribir el registro histórico para que diga lo de hoy — y eso lo volvería falso. La auditoría dice «110 migraciones» y lo era, el 25 de agosto. La regla obliga a **escribir la distinción** en lugar de dejarla implícita, que es exactamente la cura para H-10: un número sin fecha es una afirmación sobre hoy; con fecha, es historia.

De las 16, seis eran afirmaciones vigentes —se corrigieron— y diez eran registros históricos, que recibieron la fecha que les faltaba. El documento de auditoría queda excluido entero: es un registro fechado por construcción, lo dice su propio encabezado.

Los hechos se agregan de a uno y **sólo si el repositorio puede calcularlos sin adivinar**. Una puerta que produce fallos falsos enseña a ignorarla, que es el desenlace de H-01 otra vez.

### El plan del recorte espacial

El hallazgo [H-06](auditoria-2026-08-25.md#h-06--dispatch-sin-recorte-espacial-previo) era que el dispatch evaluaba a todos los conductores para cada oferta. La solución fue el recorte con `ST_DWithin` y orden KNN sobre el índice GiST, y `test:dispatch-candidates` cubre que la consulta exista y devuelva lo correcto.

Lo que no cubría nadie es lo único que hace que valga la pena: **que el planificador use el índice**. Una consulta con `ST_DWithin` que termina en un `Seq Scan` devuelve exactamente las mismas filas y no arregla nada. La diferencia sólo se ve en el plan.

`test:dispatch-plan` explica la consulta **real** —importa `SHORTLIST_SQL` del módulo que la ejecuta en producción, porque explicar una copia probaría que la copia usa el índice— y exige `drivers_available_location_gix` en el árbol del plan.

**Corre sobre mil conductores sintéticos por una razón concreta.** Con los tres del sembrado, PostgreSQL elige un `Seq Scan` y hace bien: recorrer tres filas es más barato que abrir un índice. Una puerta que explicara la consulta sobre esos datos mediría el caso que no importa, y pasaría o fallaría por el motivo equivocado.

Y trae su otra mitad: con `enable_indexscan` y `enable_bitmapscan` apagados se exige que el mismo plan **deje** de usar el índice. Sin eso, un detector que encuentre cualquier índice en cualquier parte del plan aprobaría siempre.

El tiempo de ejecución del plan **se informa y no se afirma** en `test:dispatch-plan`. El runner comparte CPU y una latencia medida ahí sería intermitente.

**La carga concurrente** reutiliza el padrón de mil conductores (`dispatch-synthetic-padron.mjs`) y se ejecuta al final de `test:dispatch-plan`: shortlist concurrente, emisión de ofertas, workers en paralelo y aceptación forzada. Afirma p95 ≤ 5 s para la primera oferta y cero dobles asignaciones bajo contención.

Todo ocurre dentro de una transacción que termina en `ROLLBACK` en el plan, o con limpieza por marca en la carga.

### Cableado de la API

El servidor expone **191 rutas**. El frente web y el móvil llaman a casi todas, pero nadie cruzaba las dos listas, así que una ruta podía quedar viva y sin consumidor —trabajo hecho que el producto no ofrece— sin que ninguna puerta lo dijera.

Es la forma más cara de deuda porque no se ve: la ruta funciona, sus pruebas pasan, y la capacidad no existe para el usuario. `test:api-wiring` la mide y la trinquetea.

La medida inicial: **16 rutas que ningún cliente nombra**, más 12 con consumidor externo declarado —sondas, webhooks, callbacks OAuth, trabajos de cola y una lápida deliberada, `/api/state`, que responde 410 para que un cliente viejo sepa que el recurso se retiró en vez de recibir un 404 indistinguible de un error—.

Al 28 de agosto **quedan cero**, y la línea base está en cero: a partir de acá, una ruta nueva sin consumidor hace fallar el merge. Dos se cerraron borrando duplicados y catorce cableando.

El cierre encontró un **falso positivo de la propia puerta**. `/api/payment-provider/client-configuration` figuraba huérfana y el checkout ya la llamaba: su literal lleva una plantilla dentro de la interpolación —`` `/ruta${x ? `?y=${z}` : ""}` ``— y el patrón se cortaba en el backtick interno. Casi termino cableando algo que ya estaba cableado, que es exactamente el defecto que esta puerta busca en otros. Ahora las interpolaciones se reemplazan por `*` **antes** de buscar literales, que es más simple que recorrer plantillas y no depende de adivinar dónde empieza una.

Ensancharle el alcance a una puerta es el cambio que más fácil la deja inerte, así que se falseó después: con una ruta inventada sin consumidor, la puerta la nombra y corta.

Cablear destapó una asimetría del contrato que no era una pantalla faltante: `PATCH /api/zones/:id` acepta `active`, pero `GET /api/zones` no lo devuelve —la consulta trae nombre, nivel de demanda y multiplicadores, nada más—. Un interruptor podría apagar una zona sin poder mostrar nunca que quedó apagada, así que ese campo no se cableó hasta que la lectura lo exponga.

El sentido contrario ya está limpio y la puerta también lo vigila: **ningún literal del frente apunta a una ruta que no exista.**

**Sobredetectar del lado del cliente es el lado seguro.** Se toma como posible llamada cualquier literal que empiece con `/`, sin exigir que esté dentro de un `request(...)`. Un falso «esta ruta sí se usa» deja pasar una huérfana; un falso «nadie la usa» manda a borrar algo que hace falta.

La detección costó cuatro iteraciones y cada una encontró un defecto real: prettier parte las declaraciones de ruta en varias líneas, el tipo genérico de `request<...>` cortaba el patrón en su primer `>`, una clase de caracteres se detenía en el paréntesis de una interpolación, y `logout`, `refresh` y el stream de eventos se llaman como `${API_BASE}/ruta`, sin empezar con `/`. Las cuatro versiones anteriores habrían publicado una lista con huérfanas falsas.

La lista de excepciones **no es una alfombra**: cada entrada dice quién consume esa ruta. Una que ya no exista hace fallar la puerta, para que una explicación no sobreviva a lo que explicaba.

### Motivo en las decisiones operativas

El criterio de [OPS-001](backlog-tecnico.md#ops-001--operación-real) pide que «toda acción operativa registre actor y motivo». El actor estaba. El motivo no.

En ocho decisiones que cambian el estado de un tercero —cerrar un caso de conciliación, revisar una transacción marcada por riesgo, aprobar o rechazar un ajuste de propina, un pago a comercio, un documento de conductor, una incidencia de pedido, un siniestro o una devolución— el esquema **exigía** una nota de al menos cinco caracteres, la nota se guardaba en la tabla del dominio, y el evento de auditoría registraba nada más que el resultado.

La diferencia aparece el día del incidente. Lo que se lee entonces es el log: si dice quién cerró qué y con qué estado pero no por qué, hay que reconstruir el motivo desde otra tabla — que **pudo cambiar después**, porque el log es append-only y la tabla del caso no.

La puerta que lo sostiene —`test:audit-reason`— está escrita y **todavía no subida**: el token no tiene permiso para modificar workflows, y una suite que no corre en ninguno no protege nada. Cuando entre, listará las acciones **por nombre y no por patrón**. Un patrón sobre «revoke» arrastra las autogestionadas —revocar la propia sesión, dar de baja el propio dispositivo, rechazar una oferta— y una puerta que pide motivos donde no corresponden llena la interfaz de campos vacíos y enseña a escribir «-» para pasar. La primera versión usaba el prefijo `merchant.payout_` y reportó las dos acciones que el comercio ejecuta sobre lo suyo.

También tuvo su falso positivo: `driver_document` ya registraba `rejectionReason` y el patrón de nombres aceptables no lo contemplaba, así que la puerta reclamó por una decisión que sí lo hacía. Un falso positivo en una puerta de auditoría cuesta el rato de arreglar algo que ya estaba bien.

Y una entrada declarada que ya no aparece en el código hace fallar la puerta, para que la lista no proteja una acción que se renombró o se borró.

### Cobertura documental de las puertas

`test:docs-coverage` exige que cada script `test:` esté nombrado en algún documento de `docs/`. Una puerta que nadie sabe que existe no se mantiene: cuando falla, quien la encuentra no sabe qué protegía ni si conviene arreglarla o borrarla.

Al escribirse había **14 suites sin mencionar en ningún lado**, casi todas anteriores a la auditoría. Es un trinquete: el número sólo puede bajar, así que una puerta nueva se documenta en el mismo PR que la crea, y la deuda heredada se paga cuando se toca cada suite.
### Raíz de sólo lectura, verificada arrancando

El job `container-image` arranca la imagen con `--read-only` hasta que responde, y **después comprueba que un `touch` sobre la raíz falle**. Esa segunda mitad importa: sin ella el paso pasaría igual aunque la raíz fuera escribible, y estaríamos verificando que la imagen arranca, que ya se sabía.

Es la diferencia entre un contenedor comprometido que puede dejar algo escrito —un binario, una tarea, una clave— y uno que no.

Lo escribible queda declarado y es poco: `/tmp` y `/app/server/data`. El segundo existe porque **`server/store.js` abre la base SQLite del respaldo al importarse**, sin mirar si hay `DATABASE_URL`. Es una consecuencia de cómo arranca el respaldo, no una necesidad del producto: con PostgreSQL configurado esa base no se usa. Hacer esa inicialización perezosa eliminaría el último punto de escritura, y queda anotado en INF-001.

El arranque tampoco pasa por `npm run`: npm escribe su caché y su log en el home, que con la raíz de sólo lectura no acepta escrituras. El comando invoca `scripts/db-migrate.mjs` directamente.

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
| ~~Rama `main` protegida con PR obligatoria~~ | **Hecho** (27 de agosto de 2026): PR obligatoria, los 7 checks exigidos, rama al día, historia lineal, sin force push ni borrado, y `enforce_admins` activo |
| Dos aprobaciones para pagos y seguridad | **Pendiente: requiere más de un revisor** |
| Artefactos de test almacenados tras el run | Pendiente |

`CODEOWNERS` por sí solo no bloquea nada: necesita que la rama esté protegida. Desde el 27 de
agosto de 2026 lo está, con los 7 checks exigidos por nombre exacto.

Lo que **no** se activó es «Require review from Code Owners», y tampoco «Require approvals».
No es un olvido: el proyecto tiene un solo colaborador y GitHub no deja aprobar el PR propio,
así que exigir una aprobación dejaría el repositorio sin poder mergear nada. Las dos opciones
se suben el día que haya un segundo revisor; hasta entonces `CODEOWNERS` documenta quién
debería mirar cada área sin poder exigirlo.

Sí se activó **«Do not allow bypassing the above settings»** (`enforce_admins`). Sin eso la
protección es decorativa para el dueño del repositorio, que es justamente quien más mergea.

Se comprueba con:

```bash
gh api repos/santyperez145/Flash-Delivery-App/branches/main/protection --jq '{checks:.required_status_checks.contexts|length,estricto:.required_status_checks.strict,admins:.enforce_admins.enabled}'
```

## Comprobar la cobertura

```bash
npm run test:ci-coverage
```

Falla cuando un script `test:*` no está referenciado por ningún workflow, cuando una excepción quedó obsoleta, o cuando una suite en cuarentena ya no existe. Cada excepción y cada cuarentena necesita un motivo escrito, y se imprimen en cada corrida.
