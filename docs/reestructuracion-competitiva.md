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

La web todavía usa el esquema anterior: `ServiceToggle` (Comida · Taxi · Envíos) arriba y la
barra propia. **RES-02** la lleva a la misma estructura que el móvil.

### Repartidor

Flash Driver ya tiene la estructura de Uber Driver: Mapa · Ganancias · Inbox · Cuenta.

- **Falta verificar** si Ganancias ofrece el desglose semanal de lo que pagó el pasajero.
  Antes de construirlo se revisa `DriverEarningsPanel.tsx`.

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
| RES-02 | La misma estructura en la web del cliente | Pendiente |
| RES-03 | Inicio personalizado con datos reales: promociones vigentes, horario, favoritos | Pendiente |
| RES-04 | Servicios por ciudad: «disponible en tu ciudad» según la zona de la dirección | Pendiente |
| RES-07 | Comercio: pausa con tiempo y motivo que vence sola | Hecho en la app móvil; modo ocupado, pausa automática y web pendientes |
| RES-05 | Repartidor: verificar el desglose semanal de ganancias y cerrar lo que falte | Pendiente |

Las filas de funciones (P-02b, P-03 a P-10) siguen en [`paridad-competitiva.md`](paridad-competitiva.md).

## Lo que no se hace

Se copia la **lógica**: qué hay en el inicio, cómo se navega, dónde vive cada cosa. **No se
copia la identidad**: ni marca, ni textos, ni íconos, ni pantallas de otras apps.
