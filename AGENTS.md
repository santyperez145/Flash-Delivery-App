# Lineamientos de ejecución de Flash

Estas reglas aplican a todo el repositorio y a cada entrega futura.

## Prioridad vigente — congelamiento de Fase 0

**Desde el 25 de agosto y hasta cerrar la Fase 0 (20 de septiembre de 2026) no se agregan verticales, pantallas ni capacidades de producto nuevas.**

Se admiten exclusivamente cuatro clases de cambio:

1. Los tickets P0 de [`docs/backlog-tecnico.md`](docs/backlog-tecnico.md).
2. Corrección de defectos que bloqueen un P0.
3. Pruebas, contratos, puertas CI y observabilidad.
4. Documentación que refleje lo anterior.

Cualquier otra propuesta se anota en `ROADMAP.MD` como candidata post-Fase 0 y no se implementa. Excepción única: un hallazgo de seguridad explotable se atiende de inmediato, con su prueba de regresión.

Documentos rectores, en orden de precedencia: [`docs/plan-de-accion.md`](docs/plan-de-accion.md) → [`docs/backlog-tecnico.md`](docs/backlog-tecnico.md) → [`docs/auditoria-2026-08-25.md`](docs/auditoria-2026-08-25.md) → `ROADMAP.MD`.

El motivo está en el veredicto de la auditoría: **la plataforma ya tiene más superficie funcional de la que puede validar, mantener y operar**. Agregar superficie durante la estabilización empeora exactamente la métrica que se quiere corregir.

## Producto y competencia

- Antes de diseñar una capacidad relevante, comprobar cómo resuelven el problema las aplicaciones competidoras y plataformas comparables. Priorizar fuentes oficiales, documentación técnica primaria, comportamiento verificable y material vigente.
- Registrar las referencias y la decisión derivada cuando influyan materialmente en arquitectura, seguridad, experiencia o costos. Comparar flujos y estándares; no copiar activos, texto, código ni identidad propietaria.
- Implementar lógica real, estados honestos y degradación explícita. No presentar mocks, datos inventados, proveedores sandbox o integraciones incompletas como capacidades productivas.
- Mantener la estrategia delivery/courier primero. Movilidad pública, dinero productivo, seguros, fiscalidad y comunicaciones externas permanecen bloqueados hasta disponer de proveedores, habilitación y verificación real.
- Toda pantalla nueva o modificada debe cumplir `docs/DESIGN_ROADMAP.md` y `docs/ui-layout-guidelines.md`: sistema visual Flash, cobertura competitiva, safe areas reales, composición compact/medium/expanded, barras estables, una sola hoja modal, texto variable y estados honestos sin desbordes.

## Tecnología

- Elegir la mejor tecnología para el problema medido, no por moda. Mantener TypeScript/Node, React/React Native y PostgreSQL/PostGIS mientras satisfagan confiabilidad, seguridad, rendimiento y velocidad de producto; introducir Go, Rust u otra tecnología sólo con un límite demostrado y una decisión documentada.
- Está autorizado instalar dependencias externas o construir componentes propios. Antes de conservar una dependencia, comprobar mantenimiento, licencia, compatibilidad, postura de seguridad, costo operativo y ventaja frente a una implementación propia.
- Preferir estándares abiertos y componentes sustituibles. Toda integración externa debe tener timeout, observabilidad, presupuesto/cuota, manejo de errores y degradación controlada cuando corresponda.

## Verificación y publicación

- Cada cambio debe incluir verificación proporcional al riesgo: pruebas automatizadas, contratos de autorización/ownership, migración real, build/typecheck y auditoría de dependencias cuando aplique.
- Nunca marcar un ítem del roadmap como completo si depende de una prueba física, proveedor o habilitación todavía ausente.
- **Una prueba que no corre en una puerta CI bloqueante no protege nada.** Si un cambio agrega una suite, el mismo PR la conecta a un workflow o declara por escrito por qué todavía no puede. Al 25 de agosto de 2026 había 89 de 104 scripts fuera de toda puerta: no se admite ampliar esa brecha.
- **Toda migración que crea una tabla incluye su política RLS y su prueba negativa por rol**, o declara por escrito por qué la tabla es global o de servicio. La clasificación se registra en `docs/matriz-rls.md`.
- **Toda migración que haga backfill sobre datos existentes agrega su derivación idempotente a `scripts/db-seed-derived.mjs`.** De lo contrario una base creada desde cero deja de ser equivalente a una migrada: las migraciones corren antes que los seeds y el backfill no alcanza a nada. Ocho migraciones ya cayeron en esto.
- **La matriz de madurez se actualiza en el mismo PR que cambia la capacidad**, nunca en un PR aparte. Ver [`docs/matriz-madurez.md`](docs/matriz-madurez.md). Un estado `PROV` o superior exige evidencia adjunta del proveedor o del dispositivo físico.
- **Ningún PR incrementa el tamaño de un archivo ya identificado como monolítico**, ni introduce líneas de código de más de 200 caracteres. Ver el hallazgo H-08 de la auditoría.
- Trabajar en entregas lógicas pequeñas. Antes de cada entrega, sincronizar con `origin/main`; después de verificarla, crear un commit descriptivo y hacer push. No publicar una entrega con pruebas relevantes fallando.
- Actualizar roadmap y documentación junto con el cambio, dejando explícitas las deudas, decisiones y condiciones de lanzamiento.
