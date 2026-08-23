# Lineamientos de ejecución de Flash

Estas reglas aplican a todo el repositorio y a cada entrega futura.

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
- Trabajar en entregas lógicas pequeñas. Antes de cada entrega, sincronizar con `origin/main`; después de verificarla, crear un commit descriptivo y hacer push. No publicar una entrega con pruebas relevantes fallando.
- Actualizar roadmap y documentación junto con el cambio, dejando explícitas las deudas, decisiones y condiciones de lanzamiento.
