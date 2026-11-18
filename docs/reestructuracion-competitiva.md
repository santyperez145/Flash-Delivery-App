# Reestructuración competitiva — estructura y lógica de las apps

**Vigente desde el 18 de noviembre de 2026.** Pedido del dueño: que Flash tenga **la misma
lógica y el mismo rumbo** que Uber, Uber Eats y PedidosYa, no sólo las mismas funciones.

[`paridad-competitiva.md`](paridad-competitiva.md) compara **funciones**: propina, retiro,
lotes. Este documento compara **estructura**: cómo se entra, cómo se navega, qué hay en el
inicio y dónde vive cada cosa. Una app puede tener todas las funciones y seguir sintiéndose
distinta si las ordena distinto.

## Fuentes

Sólo se afirma lo que tiene fuente. Lo que no se pudo confirmar se dice.

- **Uber.** El rediseño de 2023 cambió el mapa del inicio por accesos cuadrados a cada servicio.
  Sumó una pestaña **Servicios** con todo lo disponible en la ciudad, una **Actividad**
  para viajes y pedidos pasados y en curso, y **«¿A dónde vas?»** con lugares guardados y
  destinos sugeridos ([Uber Newsroom](https://www.uber.com/newsroom/were-redesigning-the-uber-app-just-for-you),
  [Engadget](https://www.engadget.com/uber-app-redesign-120016462.html)).
- **Uber Driver.** La barra tiene cuatro pestañas: Inicio, Ganancias, Bandeja y Menú. El
  rediseño de 2024 sumó un inicio que orienta cuándo conectarse y un desglose semanal de lo
  que paga el pasajero ([Uber Newsroom, Only on Uber 2024](https://www.uber.com/newsroom/onlyonuber24)).
- **PedidosYa.** En 2025 rehízo su app desde cero, con una inversión en tecnología de
  US$ 87 millones ([Forbes Argentina](https://www.forbesargentina.com/negocios/pedidosya-lanza-nueva-version-su-app-inversion-us-87-millones-tecnologia-n75019)).
  Ofrece restaurantes, súper, farmacias y comercios de cercanía. **No se encontró una
  fuente que confirme sus pestañas exactas.**
- **Uber Eats como app aparte.** No se encontró una fuente actual de sus pestañas: las que
  aparecieron eran de 2019 y 2020, y no se usan.

## Superficie por superficie

### App del cliente (móvil)

| | Antes | Modelo de referencia | Ahora |
| --- | --- | --- | --- |
| Entrada | La portada de comidas, con un selector Comidas · Viajes · Envíos arriba | Inicio con todos los servicios (Uber 2023) | **Inicio con todos los servicios** (RES-01) |
| Barra | Inicio · Buscar · Actividad · Cuenta; «Inicio» era comidas | Inicio · Servicios · Actividad · Cuenta (Uber 2023) | **Inicio · Servicios · Actividad · Cuenta** |
| Búsqueda | Pestaña propia, sólo de comidas | Arriba del inicio | **Arriba del inicio**, y dentro de cada tienda |
| Viajes | Una ventana del selector | «¿A dónde vas?» y destinos recientes en el inicio | **En el inicio**, y el destino elegido llega al viaje |
| En curso | Sólo en Actividad | Arriba de todo | **Tarjeta arriba del inicio** con pedidos, viajes y envíos |
| Volver a pedir | `POST /reorder` existía, no había acceso en el inicio | Pedidos anteriores en el inicio | **En el inicio**: comercios abiertos donde ya hubo una entrega |
| Servicios apagados | El móvil no leía los interruptores: mostraba viajes y envíos igual | Sólo lo disponible en la ciudad | **Respeta `public_rides` y `shipment_beta`**, como la web |

### App del cliente (web)

Usaba el esquema anterior: el selector Comida · Taxi · Envíos arriba y la barra Inicio ·
Actividad · Wallet · Perfil. **RES-02** la lleva a la misma estructura que el móvil:

- inicio con todos los servicios, lo que está en curso, «¿A dónde vas?» y «Volver a pedir»;
- barra Inicio · Servicios · Actividad · Cuenta;
- la Wallet dentro de Cuenta, con el saldo a la vista.

**RES-03** corrigió la portada de comidas de la web, que mezclaba cosas reales con otras
que no lo eran:

- La tarjeta «Hot deal · Comida en minutos · con backend activo» no se apoyaba en ninguna
  promoción.
- Cuatro atributos fijos afirmaban cosas como «Garantía · Crédito si falla».
- «Más pedidos» eran los siete primeros platos de la lista.

Ahora abre como las portadas de Uber Eats y PedidosYa: buscador, rubros, promociones
vigentes (sólo las reales), el plan Flash Más real, cocinas y comercios. Los seguimientos
dejan de hablarle al cliente de «backend autenticado».

La web del cliente, además, se mostraba dentro de la maqueta de staff: lo resolvió RES-06,
en la sección siguiente.

### La web del cliente como sitio (RES-06)

En el celular, la web le mostraba al cliente el marco de demostración:

- la barra de un teléfono con la hora y «Live»;
- un selector Cliente · Local · Driver · Ops;
- en anchos medianos, un panel con métricas de toda la operación («Pedidos activos»,
  «Drivers online»).

Ninguna app de la competencia le muestra eso a quien pide, y las métricas de la plataforma
no son datos del cliente. **Una cuenta que sólo pide ve ahora su app a pantalla
completa.** Las cuentas con varios roles conservan ese armado, que es su herramienta.

- Las piezas salieron de `App.tsx` a `src/shell/StaffShell.tsx`: el monolito bajó 108
  líneas.
- En escritorio, la web le seguía indicando al cliente que use la app móvil. **FE-01 lo
  cambió**: ver la sección siguiente.

### Pedidos y Viajes separados (FE-01)

Uber y Uber Eats son dos apps; PedidosYa sólo hace pedidos. Flash tenía una portada con
todo junto: el auto al lado de la pizza, y una Actividad con viajes y pedidos mezclados.
El dueño pidió separarlos.

- **Un selector Pedidos | Viajes** arriba de todo (`src/customer/CustomerScope.tsx`). Se
  recuerda, y `/viajes` abre Viajes directo.
- **Pedidos** (comida, súper, farmacia, kiosco, tiendas): barra Inicio · Explorar ·
  Pedidos · Cuenta. El inicio es un feed: en curso, rubros, promociones vigentes, cocinas,
  «Volver a pedir» y «Cerca tuyo».
- **Viajes** (viajes y envíos, que Uber también ofrece desde su app de viajes): barra
  Inicio · Servicios · Actividad · Cuenta, sin carrito. El inicio pone «¿A dónde vas?»
  primero, y después los lugares guardados y los destinos recientes con el destino cargado.
- **Cada ámbito ve sólo lo suyo** en curso y en su actividad. Los pedidos grupales viven
  en Pedidos.
- **El sitio en escritorio.** El cliente pide desde la computadora, como en ubereats.com:
  barra del sitio arriba, contenido en grilla. La puerta «seguí en la app» queda para quien
  sólo maneja.

### Repartidor

Flash Driver ya tiene la estructura de Uber Driver: Mapa · Ganancias · Inbox · Cuenta.

- **Verificado (RES-05):** Ganancias ya mostraba la semana, los días, las propinas, los
  ajustes y los movimientos contables.
- **Faltaba** lo que Uber Driver sumó en 2024: por cada servicio, cuánto pagó el cliente y
  cuánto retuvo la plataforma. **Ahora cada viaje y cada envío lo muestra**, sacado del
  mismo asiento contable: «Cobrado · Flash · Para vos».
- **Comida queda afuera, y es deliberado.** El repartidor cobra dentro de la liquidación del
  comercio, cuyo total es el del pedido entero. Mostrarlo como «lo que pagó el cliente por
  tu reparto» sería falso: hace falta separar esa parte en la liquidación.

### Comercio

Flash Negocios tiene Hoy · Pedidos · Catálogo · Cuenta.

- **Uber Eats Orders**, según su ayuda oficial
  ([merchants.ubereats.com](https://merchants.ubereats.com/ar/en/resources/learning-center/uber-eats-orders-app/)):
  - pausa los pedidos por un tiempo elegido y con motivo, y reanuda sola;
  - tiene un modo ocupado que suma minutos de preparación;
  - pausa sola a la tienda que deja pedidos sin aceptar;
  - cambia la disponibilidad de los platos, aun durante un pedido;
  - maneja horarios con feriados, una bandeja de mensajes y muestra el repartidor
    asignado.
- **Flash Negocios ya tenía:** disponibilidad de platos, horarios con excepciones (en la
  web) y el repartidor asignado.
- **RES-07** suma la pausa con tiempo y motivo, que vence sola.
- **Pendientes:**
  - el modo ocupado, porque hoy hay un «+5 min» que no se deshace;
  - la pausa automática por pedidos sin aceptar;
  - la misma pausa en la consola web.
- **PedidosYa:** no hay documentación oficial de su app de comercios; no se compara.

## Fases

| Fase | Qué | Estado |
| --- | --- | --- |
| RES-01 | Inicio con todos los servicios, barra Inicio · Servicios · Actividad · Cuenta, búsqueda arriba, «¿A dónde vas?», en curso y volver a pedir, en el móvil | Hecho |
| RES-02 | La misma estructura en la web del cliente, con la Wallet dentro de Cuenta | Hecho |
| RES-03 | Portada de comidas con datos reales: promociones vigentes en lugar de textos fijos, y seguimientos en el idioma del cliente | Hecho (web) |
| RES-04 | Servicios por ciudad: «disponible en tu ciudad» según la zona de la dirección | Pendiente |
| RES-05 | Repartidor: desglose por servicio de lo cobrado y lo que retuvo Flash | Hecho en viajes y envíos; comida pendiente |
| RES-06 | La web del cliente como sitio: sin marco de teléfono, sin selector de perfiles, sin métricas de la operación | Hecho |
| RES-07 | Comercio: pausa con tiempo y motivo que vence sola | Hecho en la app móvil; modo ocupado, pausa automática y web pendientes |
| FE-01 | Pedidos y Viajes separados en la web, inicio con feed, Actividad rehecha y el sitio del cliente en escritorio | Hecho (web) |
| FE-02 | La misma separación en la app móvil | Pendiente |

Las filas de funciones (P-02b, P-03 a P-10) siguen en [`paridad-competitiva.md`](paridad-competitiva.md).

## Lo que no se hace

Se copia la **lógica**: qué hay en el inicio, cómo se navega, dónde vive cada cosa. **No se
copia la identidad**: ni marca, ni textos, ni íconos, ni pantallas de otras apps.
