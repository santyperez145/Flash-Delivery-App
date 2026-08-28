# Contrato de distribución y composición visual

Fecha de contraste: 22 de agosto de 2026. Este documento es obligatorio para
Customer, Driver, Merchant, Operaciones, tracking público y toda superficie
nueva. Define composición y comportamiento; cada vertical conserva su identidad
y [`DESIGN_ROADMAP.md`](DESIGN_ROADMAP.md) determina sistema, apariencia,
jerarquía, cobertura y proporción.

## Referencias verificadas

- [Uber Base Web](https://www.uber.com/us/en/blog/introducing-base-web/): sistema
  común, responsive y accesible, componentes reutilizables, tokens y regresión
  visual por cambio.
- [DoorDash Business Manager](https://about.doordash.com/en-us/news/doordash-empowers-merchants-with-new-real-time-features):
  tickets desplazables, navegación reforzada y acciones rápidas dentro de la
  orden activa.
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout):
  respetar safe areas, tamaño/orientación, texto dinámico, ventanas redimensionables
  y jerarquía por alineación y espacio.
- [Apple HIG — Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars):
  la barra representa destinos superiores, permanece predecible y conserva el
  estado interno de cada sección.
- [Apple HIG — Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets):
  una hoja por vez, tarea acotada y retorno inequívoco al contexto anterior.
- [Expo safe-area-context](https://docs.expo.dev/versions/latest/sdk/safe-area-context/):
  proveedor raíz y medición nativa para notch, barras del sistema y gestos en
  Android, iOS y web.
- [Playwright — Emulation](https://playwright.dev/docs/emulation): viewports y
  dispositivos reproducibles para atravesar los mismos cortes sin depender del
  tamaño de la ventana del desarrollador.

Flash adopta patrones y estándares, no activos, textos, colores ni identidad de
terceros.

## Reglas no negociables

1. Ninguna vista puede depender de un alto fijo de pantalla. Se usa viewport
   dinámico (`dvh`) en web y flex/safe-area nativos en mobile.
2. No debe existir scroll horizontal de página. Los únicos desplazamientos
   horizontales permitidos son rails explícitos de categorías, filtros o
   destinos, con contenido siguiente parcialmente visible.
3. Todo contenedor flex/grid que recibe texto variable debe admitir `min-width: 0`,
   wrap o truncado explícito. Nombres, direcciones y traducciones largas no pueden
   empujar acciones fuera de pantalla.
4. El contenido crítico nunca queda detrás de notch, status bar, Dynamic Island,
   home indicator, teclado, tab bar ni controles del mapa.
5. Botones principales, tabs y controles de icono tienen objetivo táctil mínimo
   de 44 × 44. Foco de teclado, estado activo, disabled, loading y error deben ser
   visibles.
6. La navegación superior es estable. Mobile usa barra inferior para destinos;
   desktop usa sidebar y tablet una barra horizontal desplazable. Las acciones
   del contenido nunca se colocan como destinos de navegación.
7. Una hoja modal ejecuta una tarea acotada. Sólo se muestra una por vez, tiene
   cierre visible, ancho máximo, alto máximo desplazable y acción primaria dentro
   del área segura. En mobile, tracking y chat usan `MobileTaskSheet`: el marco
   mide el inset nativo, evita el teclado en iOS, limita títulos variables a dos
   líneas y conserva un cierre accesible de al menos 44 × 44.
8. Mapas llenan el contexto disponible, pero dirección, ETA, estado y próxima
   acción siguen legibles sin mapa. El conductor recibe cockpit/guía; cliente y
   comercio reciben seguimiento, no instrucciones de conducción.
9. Empty, loading, error, offline y dato retenido ocupan el mismo esqueleto que
   el estado exitoso para evitar saltos de composición.
10. Ningún check visual se cierra sólo con una captura desktop: requiere tamaños
    compact, medium y expanded, además de teclado/safe areas en build físico cuando
    intervenga código nativo.

## Tamaños y comportamiento

| Clase | Ancho de referencia | Composición |
|---|---:|---|
| Compact | 320–619 px | una columna, tab bar fija, sheets desde el borde inferior |
| Medium | 620–899 px | contenido centrado hasta 620 px; grids 1–2 columnas según densidad |
| Expanded | 900–1279 px | navegación desktop, contenido fluido y panel de detalle contextual |
| Wide | 1280 px o más | ancho de contenido acotado; no estirar texto, tickets ni formularios |

Los breakpoints representan cambios de composición y no modelos de dispositivo.
Una ventana redimensionable debe poder atravesarlos sin recargar ni perder estado.

## Contratos por audiencia

### Customer

- Comidas, Viajes y Envíos comparten selector superior; Inicio/Buscar/Actividad/Cuenta
  permanece fijo al pie.
- Checkout y cotizadores son una secuencia vertical; resumen y CTA no compiten
  con el teclado.
- Tracking usa mapa + hoja de estado y conserva chat/seguridad accesibles. El
  timeline comparte estructura, pero usa el acento de su vertical y anuncia cada
  etapa como completada, actual o pendiente; el color nunca es la única señal.
  Las cards que lo abren son botones nombrados por servicio, no contenedores
  enfocables sin rol.

### Driver

- Mapa/Cockpit es la raíz operacional. Ganancias, Inbox y Cuenta quedan separados.
- Con un trabajo activo, la próxima maniobra y la etapa dominan; acciones
  secundarias se agrupan en la hoja inferior.
- La guía completa es pantalla propia y respeta safe areas en ambas orientaciones.

### Merchant

- Desktop usa sidebar en expanded y barra superior desplazable en compact/medium.
- Mobile conserva Hoy/Pedidos/Catálogo/Cuenta al pie.
- Las comandas son tickets escaneables; detalle, nota, faltante, sustitución y chat
  pertenecen a una única hoja operativa.

### Operaciones

- La densidad nunca justifica una tabla rota. En compact, una fila pasa a tarjeta
  y las acciones se agrupan debajo de su entidad.
- Filtros y acciones masivas hacen wrap; mapas y métricas no fijan un ancho mínimo
  superior al viewport.

## Verificación por entrega

- `npm run test:responsive-layout` protege safe areas, viewport dinámico,
  breakpoints, barras, límites de sheets y el marco compartido de tracking/chat.
- `npm run test:responsive-browser` recorre Chromium real en 320×568, 390×844,
  768×1024, 1024×768 y 1440×900; valida acceso, overflow horizontal, destinos
  mobile, cambio compact/tablet/desktop, navegación sticky y targets mínimos.
- Driver y Merchant mobile se ensayan con `FLASH_MOBILE_VARIANT=driver` o
  `merchant` y `FLASH_SKIP_DESKTOP=1`; cada ejecución debe apuntar a una variante
  Expo iniciada con el mismo valor y `--clear`.
- `npm run mobile:typecheck` y `npm run build` deben quedar verdes.
- Inspección real mínima: 320×568, 390×844, 768×1024, 1024×768 y 1440×900.
- En cambios de mapa, teclado, cámara, firma o navegación: build Android/iOS y
  prueba física antes de marcar el ítem nativo como completo.

Los screenshots dorados no reemplazan estas aserciones geométricas: Playwright
advierte que el render puede variar por sistema operativo, navegador, hardware y
modo headless. Las capturas se guardan como `qa-responsive-*.png` al fallar para
diagnóstico; una futura comparación pixel a pixel deberá ejecutarse en una imagen
CI fija y versionada.
