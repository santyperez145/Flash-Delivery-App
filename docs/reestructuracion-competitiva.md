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

**Pendiente para RES-03:** la portada de comidas de la web abre con una tarjeta de marketing
(«Comida en minutos», «con backend activo») y cuatro atributos fijos. Uber Eats y PedidosYa
abren directo en rubros y comercios: se reemplaza por promociones y comercios reales.

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

- **Sin fuente** sobre la estructura actual de las apps de comercio de Uber Eats y
  PedidosYa: no se compara hasta tenerla.

## Fases

| Fase | Qué | Estado |
| --- | --- | --- |
| RES-01 | Inicio con todos los servicios, barra Inicio · Servicios · Actividad · Cuenta, búsqueda arriba, «¿A dónde vas?», en curso y volver a pedir, en el móvil | Hecho |
| RES-02 | La misma estructura en la web del cliente, con la Wallet dentro de Cuenta | Hecho |
| RES-03 | Inicio personalizado con datos reales: promociones vigentes, horario, favoritos | Pendiente |
| RES-04 | Servicios por ciudad: «disponible en tu ciudad» según la zona de la dirección | Pendiente |
| RES-05 | Repartidor: desglose por servicio de lo cobrado y lo que retuvo Flash | Hecho en viajes y envíos; comida pendiente |

Las filas de funciones (P-02b, P-03 a P-10) siguen en [`paridad-competitiva.md`](paridad-competitiva.md).

## Lo que no se hace

Se copia la **lógica**: qué hay en el inicio, cómo se navega, dónde vive cada cosa. **No se
copia la identidad**: ni marca, ni textos, ni íconos, ni pantallas de otras apps.
