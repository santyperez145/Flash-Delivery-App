# Acceso web y base visual compartida

Fecha de contraste: 28 de agosto de 2026.

## Evidencia verificada

- [Uber Base Web](https://www.uber.com/us/en/blog/introducing-base-web/) define un sistema como
  componentes reutilizables más tokens de color, espacio, tamaño y tipografía. Uber protege cada
  cambio con regresión visual y pruebas end-to-end, y trata accesibilidad como parte del componente,
  no como corrección posterior.
- [Uber — Design System at Scale](https://www.uber.com/en-UA/blog/design-system-at-scale/)
  registra que una biblioteca compartida reduce inconsistencias y permite desplegar cambios de tema
  y tipografía transversalmente. Flash adopta la medición y la reutilización; no adopta Base Web como
  dependencia porque el producto ya tiene un sistema React/React Native propio y dos stacks visuales
  que todavía deben converger.
- [DoorDash Design](https://about.doordash.com/en-us/design) organiza diseño, investigación y QA
  alrededor de consumidores, comercios, repartidores y equipos internos. La pantalla de acceso de
  Flash debe explicar esa plataforma multi-audiencia sin mezclar después las herramientas de cada rol.
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
  prioriza jerarquía, alineación, espacio para lo esencial y adaptación a ventanas, texto y safe areas.
  El formulario conserva una columna legible y el contexto de marca desaparece antes de comprimir los
  controles.

## Decisión Flash

1. `foundation.css` materializa tokens Flash para web y define controles, focos, superficies y targets
   táctiles comunes. Se carga después del CSS legado para permitir migración gradual sin reescribir
   siete mil líneas en un solo cambio.
2. El acceso web deja de reutilizar la tarjeta de loading. `WebLogin` es un módulo de autenticación con
   jerarquía propia, etiquetas accesibles, mostrar/ocultar contraseña, error con `role=alert` y el mismo
   submit real de email, contraseña y MFA que existía.
3. La portada pública sigue el patrón de uber.com —nav persistente, titular de conversión e ingreso—
   con identidad Flash. No se dibuja un cotizador anónimo ni ciudades/métricas inventadas: el CTA real
   es autenticarse. Compact conserva titular corto + formulario; no esconde la propuesta. No se dibujan
   Apple, Google, passkeys, SMS ni biometría porque esos proveedores no están integrados.
4. Las barras operativas admiten scroll interno. Elevar todos los targets a 44 px reveló que la navegación
   de Operaciones excedía 900 px y dejaba `Cerrar sesión` fuera del viewport; la base compartida corrige el
   defecto sin reducir el área táctil.
5. Cada audiencia web se carga bajo demanda con `React.lazy` y `Suspense`. Acceso, Customer, Merchant,
   Operaciones y Superadmin dejan de viajar juntos en el entry inicial; el fallback nombra honestamente la
   superficie que se está preparando.
6. Carga, indisponibilidad y derivación por rol usan una composición compartida, no tarjetas improvisadas.
   Mantienen safe areas, ancho legible, estado accesible y una sola acción real. La vista de acceso móvil
   ya no promete Comidas, Viajes y Envíos indiscriminadamente: remite a los servicios habilitados para la
   cuenta, porque los flags y permisos son autoridad del servidor.

## Diferencia pendiente frente a la referencia

- Flash todavía no tiene una biblioteca React de componentes web versionada: tiene tokens compartidos y
  familias CSS en migración. La próxima extracción de ARC-001 debe convertir cards, inputs, estados y
  navegación en primitivas con API estable.
- La regresión geométrica ya recorre cinco viewports; las capturas doradas continúan postergadas hasta
  disponer de un entorno CI visual fijo.
- Passkeys y proveedores sociales permanecen bloqueados por backend, asociación de dominio, credenciales,
  privacidad y prueba física. No se simulan para alcanzar paridad visual.

## Evidencia de esta entrega

- Build TypeScript/Vite y formato completos.
- Presupuesto web: entry **575,7 → 65,7 KiB** y carga JS inicial **455,8 KiB** en tres chunks cacheables.
- Contrato responsive estático conectado a `ci-fast.yml`.
- Chromium real: Customer mobile, Merchant desktop y Operaciones en 320×568, 390×844, 768×1024,
  1024×768 y 1440×900, sin overflow horizontal y con navegación accesible.
- Chromium real: derivación de una cuenta Customer desde web en 768×1024, 1024×768 y 1440×900,
  sin overflow y con la acción `Cambiar de cuenta` dentro del viewport.
- Inspección visual del acceso desktop en 1294×912: controles de 44/52 px, sin overflow y una sola acción
  primaria.
