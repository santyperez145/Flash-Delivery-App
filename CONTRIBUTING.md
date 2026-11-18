# Reglas de ingeniería y producto de Flash

Estas reglas aplican a todo el repositorio y a cada pull request. Son la vara con la que
Flash compite: un cambio que no las cumple no entra, aunque funcione.

## 1. El objetivo: paridad completa con Uber, Uber Eats y PedidosYa

Flash compite en comida, viajes y envíos contra las tres aplicaciones que los clientes,
comercios y repartidores ya usan. **El objetivo es la paridad completa y competitiva con
Uber, Uber Eats y PedidosYa, superficie por superficie: cliente, comercio, repartidor y
operaciones.** Decisión del dueño del 17 de noviembre de 2026.

- **La cola de trabajo es [`docs/paridad-competitiva.md`](docs/paridad-competitiva.md):**
  el registro de huecos medidos contra esas tres aplicaciones, con el estado de Flash
  verificado contra el código fila por fila.
- **Cada PR nombra la fila que cierra y cuál de los tres competidores ya la tiene.** Un
  cambio que no se puede ubicar en el registro es un cambio que nadie pidió.
- **No hay verticales ni superficies vedadas.** Lo único que condiciona una capacidad es
  si depende de un tercero (credencial, habilitación o dispositivo), y en ese caso se
  construye hasta ese borde (ver §3).

## 2. Cómo se elige el trabajo

El orden se decide por riesgo y valor, en esta prelación:

1. **Seguridad y dinero** antes que forma. Una tabla sin política RLS pesa más que cien
   líneas largas.
2. **Lo que desbloquea a otros** antes que lo aislado.
3. **Lo verificable** antes que lo que sólo se puede afirmar. Si a algo no se le puede
   escribir una puerta, el PR explica por qué.

Cuando algo se descarta o se pospone, **se deja escrito con el motivo** en el documento
correspondiente. Un criterio que se salta sin explicación reaparece como deuda que nadie sabe
si sigue vigente.

Son del dueño, siempre: las decisiones de negocio, el gasto, las credenciales y cualquier
acción sobre sus cuentas.

## 3. La vara competitiva: estar a la altura

1. **Comparar antes de construir, front y back.** Antes de diseñar una capacidad, se
   estudia cómo la resuelven Uber, Uber Eats y PedidosYa con fuentes primarias y
   comportamiento verificable. La decisión y sus referencias quedan en
   [`docs/investigacion-competitiva.md`](docs/investigacion-competitiva.md), **incluido
   dónde Flash queda por debajo**. Se comparan flujos y estándares; no se copian activos,
   textos, código ni identidad.
2. **Cableado antes que cantidad.** Una capacidad construida y no expuesta no cuenta: la
   ruta funciona, sus pruebas pasan y el producto no la ofrece. `test:api-wiring` lo mide.
3. **Web y móvil a la par.** La app móvil es la superficie principal del cliente: el portal
   web de escritorio lo deriva a ella. Una capacidad de cliente llega a la app en el mismo
   PR, o el PR dice por qué todavía no.
4. **Nada falso.** No se presentan mocks, datos inventados, proveedores sandbox ni
   integraciones incompletas como capacidades productivas. No se siembran comercios,
   usuarios ni pedidos ficticios para que una pantalla parezca llena. Las pruebas crean sus
   propios datos, rotulados como prueba, y los borran al terminar.
5. **Estados honestos.** Cada pantalla dice la verdad sobre lo que pasa: cargando, vacío,
   error con reintento, degradado. Un acceso que abre una lista vacía no se muestra.
6. **Diseño al nivel de la competencia.** Toda pantalla nueva o modificada cumple
   [`docs/DESIGN_ROADMAP.md`](docs/DESIGN_ROADMAP.md) y
   [`docs/ui-layout-guidelines.md`](docs/ui-layout-guidelines.md): sistema visual Flash,
   safe areas reales, composición compact/medium/expanded, barras estables, una sola hoja
   modal, texto variable sin desbordes.
7. **Lo que depende de un tercero se nombra, con dueño.** El cobro recurrente y el
   movimiento real de dinero necesitan credenciales productivas de Mercado Pago; el push a
   un teléfono, un dispositivo y credenciales EAS; el ETA vial, una API key comercial; un
   medicamento, una farmacia habilitada. Todo eso se construye **hasta el borde de la
   credencial**, con la degradación dicha en pantalla. Nunca se marca como completo algo que
   depende de una prueba física, un proveedor o una habilitación ausentes.

## 4. Tecnología

- Se elige la mejor tecnología para el problema **medido**, no por moda. TypeScript/Node,
  React/React Native y PostgreSQL/PostGIS se mantienen mientras satisfagan confiabilidad,
  seguridad, rendimiento y velocidad de producto; otra tecnología entra sólo con un límite
  demostrado y una decisión escrita.
- Antes de conservar una dependencia se comprueba mantenimiento, licencia, compatibilidad,
  postura de seguridad, costo operativo y ventaja frente a una implementación propia.
- Estándares abiertos y componentes sustituibles. Toda integración externa tiene timeout,
  observabilidad, presupuesto o cuota, manejo de errores y degradación controlada.

## 5. Cómo se revisa cada cambio

La revisión es **determinística**: reglas que se pueden ejecutar y que fallan igual para
todos, no opiniones.

1. **Puertas CI bloqueantes.** Los siete checks requeridos por la protección de `main`
   (`ci-fast`, `ci-critical-flows`, `ci-postgres`) tienen que pasar. `test:ci-coverage`
   verifica que ninguna suite quede fuera de una puerta sin justificación escrita.
2. **Análisis estático de seguridad con CodeQL**, por reglas, en cada PR y una vez por
   semana sobre `main` (`.github/workflows/codeql.yml`).
3. **Revisión de dependencias en cada PR**: una dependencia nueva con una vulnerabilidad
   alta o crítica bloquea el merge (`.github/workflows/dependency-review.yml`).
   `test:dependency-gate` audita además todo el árbol, raíz y móvil, producción y desarrollo.
   Un aviso sin versión corregida sólo se exceptúa por aviso, nunca por paquete, con motivo,
   mitigación y fecha de vencimiento en `scripts/dependency-audit-exceptions.json`, y con
   aprobación del dueño.
4. **Aprobación humana por área** según [`.github/CODEOWNERS`](.github/CODEOWNERS). Hoy el
   proyecto tiene un solo colaborador y GitHub no deja aprobar el PR propio; el día que se
   sume un segundo revisor se activan «Require approvals» y «Require review from Code
   Owners».
5. **Una prueba que no puede fallar no prueba nada.** Cada aserción nueva se falsifica:
   se rompe a propósito lo que vigila y se confirma que falla. Se afirman las dos mitades,
   la positiva y la negativa.
6. **Las observaciones de revisión se resuelven en el mismo PR**, con el commit que las
   corrige citado en el hilo.

## 6. Verificación y publicación

- Cada cambio incluye verificación proporcional al riesgo: pruebas automatizadas,
  contratos de autorización y ownership, migración real, build y typecheck, y auditoría de
  dependencias cuando aplica.
- **Una prueba que no corre en una puerta CI bloqueante no protege nada.** Si un cambio
  agrega una suite, el mismo PR la conecta a un workflow o declara por escrito por qué
  todavía no puede, y la documenta (`test:docs-coverage`).
- **Toda migración que crea una tabla la clasifica en
  [`database/rls-classification.json`](database/rls-classification.json) en el mismo PR**,
  con su política RLS y su prueba negativa por rol si es `por-usuario`
  (`npm run test:rls-matrix`). Antes de aplicar una política se comprueba si la tabla se
  consulta sin contexto de usuario: el camino de login lee `user_roles` antes de autenticar,
  y una política ingenua ahí rompe toda la plataforma. Ver
  [`docs/matriz-rls.md`](docs/matriz-rls.md).
- **Toda migración que haga backfill agrega su derivación idempotente a
  `scripts/db-seed-derived.mjs`.** Las migraciones corren antes que los seeds: sin eso, una
  base creada desde cero deja de ser equivalente a una migrada.
- **La matriz de madurez se actualiza en el mismo PR que cambia la capacidad**
  ([`docs/matriz-madurez.md`](docs/matriz-madurez.md)). Un estado `PROV` o superior exige
  evidencia del proveedor o del dispositivo físico.
- **Las cifras de la documentación son verificables o están fechadas**
  (`test:docs-drift`). Una cifra sin fecha es una afirmación sobre hoy.
- **El código va formateado con Prettier** (`npm run format`; lo verifica
  `npm run test:format`).
- **Un contrato que lee código fuente compara con `scripts/source-contract.mjs`**, nunca
  con `String.includes` sobre el texto crudo: una afirmación acoplada al espaciado bloquea
  cualquier refactor en lugar de protegerlo.
- **Ningún PR hace crecer un archivo monolítico** identificado en el hallazgo H-08 de la
  auditoría, ni introduce líneas de más de 200 caracteres. Una capacidad que choca con un
  techo de tamaño parte el archivo; no se deja afuera.
- Entregas lógicas pequeñas. Antes de cada una se sincroniza con `origin/main`; después de
  verificarla, commit descriptivo, push y PR. No se publica una entrega con pruebas
  relevantes fallando.
- Roadmap y documentación se actualizan junto con el cambio, con las deudas, decisiones y
  condiciones de lanzamiento explícitas.

## Documentos rectores

En orden de precedencia: [`docs/paridad-competitiva.md`](docs/paridad-competitiva.md) →
[`docs/plan-de-accion.md`](docs/plan-de-accion.md) →
[`docs/backlog-tecnico.md`](docs/backlog-tecnico.md) →
[`docs/auditoria-2026-08-25.md`](docs/auditoria-2026-08-25.md) → `ROADMAP.MD`.

El congelamiento de Fase 0 estuvo vigente del 25 de agosto al 17 de noviembre de 2026 y
está levantado; el motivo quedó escrito en `ROADMAP.MD`.
