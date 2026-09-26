# Lineamientos rectores de producto y ejecución

Este documento es obligatorio para cada cambio de Flash. Convierte la visión del producto en criterios verificables de arquitectura, experiencia, seguridad y entrega. Complementa `AGENTS.md`, `ROADMAP.md` y `docs/experience-surface-inventory.md`; si una propuesta contradice estas reglas, debe corregirse o documentar una decisión explícita antes de implementarse.

## 0. Mandato competitivo del dueño

El equipo agente actúa como CEO, CTO, CFO, PM, PO e inversor: prioriza solo, compara siempre
con Uber/DoorDash/PedidosYa y pares del dominio, e implementa la mejor tecnología medida
para el problema. Libertad total para el bien del producto; no para inventar alcance ni
presentar sandbox como producción. En Fase 0 la paridad es de ingeniería y operación
verificable; las verticales nuevas y el gasto cloud quedan acotados por el congelamiento y
por el dueño. Regla Cursor: `.cursor/rules/competitive-mandate.mdc`.

## 1. Producto competitivo, no imitación

- Antes de diseñar una capacidad relevante, estudiar cómo la resuelven aplicaciones comparables de primer nivel mediante documentación oficial vigente, comportamiento verificable y fuentes técnicas primarias.
- Registrar en `docs/research/` o en la documentación de la capacidad las referencias, fecha, diferencias entre competidores y decisión propia cuando afecte experiencia, seguridad, arquitectura, operación o costos.
- Adoptar patrones y estándares que resuelvan el problema; nunca copiar activos, textos, código, marca, identidad visual ni información propietaria.
- Comparar el flujo completo: entrada, permisos, carga, vacío, error, reintento, confirmación, cancelación, soporte, recuperación y cierre. Una pantalla principal sin sus estados y modales no está completa.
- Mantener un inventario rector sin duplicados para Cliente, Driver, Comercio y Operaciones en `docs/experience-surface-inventory.md`.

## 2. Alcance y segmentación

- Cliente separa claramente **Comidas**, **Viajes** y **Envíos**, con Inicio, Buscar, Actividad y Cuenta como navegación común cuando corresponda.
- Driver/Repartidor separa **Mapa**, **Ganancias**, **Inbox** y **Cuenta**. Su mapa es la superficie operativa primaria.
- La guía giro a giro, las maniobras, los reportes viales y el traspaso al navegador pertenecen exclusivamente a Driver. Cliente puede ver ubicación, ruta, ETA, progreso y seguridad, pero no instrucciones para conducir.
- Comercio dispone de una experiencia de escritorio/tablet para pedidos, preparación, catálogo, disponibilidad, operaciones, conciliación y soporte.
- Operaciones dispone de superficies diferenciadas por privilegio para soporte, dispatch, riesgo, conciliación, cumplimiento y auditoría.
- La estrategia de lanzamiento es delivery/courier primero. Movilidad pública, dinero productivo, seguros, fiscalidad y comunicaciones externas quedan bloqueados hasta disponer de proveedor, habilitación, operación y verificación reales.

## 3. Funcionalidad real y estados honestos

- Ninguna capacidad productiva puede depender de datos hardcodeados, temporizadores que simulen procesos, coordenadas ficticias, saldos inventados, asignaciones locales o proveedores falsos.
- El backend y PostgreSQL/PostGIS son autoritativos para identidad, permisos, catálogo, disponibilidad, cotizaciones, trabajos, dispatch, pagos, ledger, ubicación, mensajería, auditoría y configuración persistente.
- Los valores constantes sólo son válidos como reglas versionadas, enums, tokens de diseño, límites de seguridad o configuración explícita. Deben diferenciarse de datos de negocio y tener propietario y justificación.
- Un proveedor sandbox, una integración parcial o una credencial ausente debe mostrarse como no configurado, pendiente o degradado. Nunca como una operación completada.
- Toda acción debe cubrir loading, empty, error, retry, offline, permisos denegados, dato obsoleto, timeout y proveedor no disponible cuando apliquen.
- No se pronostica demanda, ETA, ingreso, precio dinámico o disponibilidad sin datos y modelo verificables. Las estimaciones deben indicar fuente, vigencia y limitaciones.

## 4. Arquitectura y tecnología

- Usar la mejor tecnología **medida para el problema**, no la más novedosa. TypeScript/Node, React/React Native y PostgreSQL/PostGIS continúan como base mientras cumplan confiabilidad, seguridad, rendimiento y velocidad de producto.
- Introducir otro lenguaje, framework, microservicio o servicio gestionado sólo ante un límite demostrado, con ADR que compare beneficio, costo de operación, seguridad, migración y reversibilidad. En Fase 0 eso es monolito modular + workers + adapters (Expo, Maps, Mercado Pago, PostGIS), no Kubernetes ni un recorte prematuro de servicios.
- Antes de conservar una dependencia externa, comprobar mantenimiento, licencia, compatibilidad, vulnerabilidades, tamaño/costo, soporte de plataforma y ventaja frente a una implementación propia.
- Preferir contratos abiertos, adaptadores sustituibles y datos portables. Toda integración externa debe tener timeout, presupuesto/cuota, observabilidad, manejo de errores, circuit breaker o degradación controlada según riesgo.
- Mantener fronteras claras entre dominio, persistencia, proveedores, API y presentación. El cliente no decide autorización, precio final, estado del trabajo ni saldo.

## 5. Experiencia visual y responsive

- Las pantallas deben respetar la jerarquía, proporciones, densidad y ritmo visual de los Figma aprobados, adaptados al sistema Flash y sin deformar su composición.
- La barra inferior mobile permanece fija al borde seguro de la pantalla; el contenido reserva su espacio y no puede quedar tapado.
- Mapas, hojas inferiores, modales, snackbars, banners, selectores, tarjetas de oferta y confirmaciones deben tener estados y transiciones coherentes entre las verticales.
- Cada superficie visual se verifica como mínimo en anchos mobile pequeño/medio/grande, desktop relevante, safe areas, teclado abierto, orientación soportada, texto largo, escalado de fuente y conectividad degradada.
- Ningún mapa puede deformar geometrías, dibujar movimiento inexistente ni ocultar atribución. La ubicación debe informar vigencia y precisión; una ruta vial debe venir del adaptador de routing configurado.
- Accesibilidad, contraste, targets táctiles, foco, etiquetas y lectura de estados forman parte de la definición de terminado.

## 6. Seguridad, privacidad y dinero

- Aplicar mínimo privilegio, ownership en servidor, RLS donde corresponda, cifrado, secretos fuera del repositorio, rotación, auditoría inmutable e idempotencia para escrituras sensibles.
- No aceptar identificadores de usuario, conductor o comercio desde el cliente cuando puedan derivarse de la sesión.
- Reducir ubicación y datos personales a la granularidad, audiencia y retención necesarias. Nunca exponer coordenadas de terceros para construir una visualización agregada.
- Todo movimiento monetario exige ledger balanceado, transacción, idempotencia, conciliación y estado externo verificable. Sin PSP/KYC/habilitación real, la liquidación productiva permanece bloqueada.
- Capacidades de alto riesgo requieren threat model, abuso esperado, rate limits, alertas, runbook y prueba de recuperación proporcional.

## 7. IA, KYC y decisiones sensibles

- La IA automatiza captura, validación, priorización, detección de anomalías y casos claros; las
  reglas legales permanecen determinísticas y versionadas.
- Un fallo técnico, una captura incierta o un score bajo no puede producir silenciosamente una
  exclusión, suspensión definitiva o pérdida de fondos. Debe existir reintento, motivo legible,
  revisión proporcional y apelación.
- Biometría exige consentimiento, finalidad acotada, minimización, retención/borrado,
  evaluación de impacto, métricas por cohorte y proveedor homologable.
- Sandbox, OCR o face match local no equivalen a KYC productivo. La estrategia y puertas están
  en [`estrategia-kyc-automatizado.md`](estrategia-kyc-automatizado.md).

## 8. Definición de terminado

Una capacidad sólo puede marcarse completa cuando:

1. Tiene contrato backend autoritativo, persistencia real y migración reversible cuando aplica.
2. Autenticación, rol, ownership, validación, idempotencia, rate limit y auditoría están cubiertos según riesgo.
3. La interfaz consume ese contrato y cubre todos sus estados sin datos simulados.
4. Existen pruebas de dominio/API/DB y build, typecheck, auditoría de dependencias y verificación visual proporcional.
5. OpenAPI, roadmap, inventario de superficies, ADR/runbook y deuda operativa están actualizados.
6. Las condiciones dependientes de dispositivo, proveedor u operación externa permanecen `[~]` o `[ ]` hasta verificarse físicamente.
7. La entrega está sincronizada con `origin/main`, tiene commit descriptivo y push con pruebas relevantes verdes.

## 9. Secuencia de ejecución

1. Seleccionar el siguiente riesgo o flujo vertical completo del roadmap, no una pantalla aislada.
2. Investigar fuentes oficiales y registrar la decisión.
3. Modelar estados, permisos, datos, fallos, métricas y condición de lanzamiento.
4. Implementar base de datos y backend antes o junto al frontend.
5. Verificar automáticamente y en runtime real las superficies afectadas.
6. Actualizar `ROADMAP.md` con checks honestos y deudas explícitas.
7. Publicar una entrega lógica pequeña; repetir.

## 10. Prohibiciones explícitas

- No afirmar que Flash puede procesar un viaje, pago, retiro, SMS, seguro o navegación productiva sin proveedor y prueba real.
- No completar checks por apariencia visual, fixtures, mocks, seeds o respuestas sandbox.
- No duplicar pantallas con nombres distintos si comparten el mismo objetivo y estado de dominio.
- No usar investigación competitiva como justificación para copiar ni para introducir una capacidad fuera de la estrategia de lanzamiento.
- No relajar pruebas, ownership, RLS, seguridad, presupuestos de bundle o observabilidad para acelerar una demo.
