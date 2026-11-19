# Perfil familiar (PAG-05)

Como en Uber: quien organiza paga los viajes, envíos y pedidos de su familia con su Flash
Wallet.

## Cómo funciona

- **Armar el perfil.** Desde la Wallet (web) o Cuenta (app), quien organiza invita por email
  a otras cuentas Flash, hasta nueve personas además de sí misma, como en Uber. A cada una
  le puede poner un **tope por mes** o dejarla sin tope, y cambiarlo cuando quiera. El perfil
  se crea con la primera invitación.
- **Invitar no dice quién tiene cuenta.** Un email que no es de un cliente activo se guarda
  como una invitación más, que nunca se acepta, y la respuesta es la misma.
- **Sumarse.** Quien fue invitado recibe una push y ve la invitación en el mismo panel; la
  acepta o la rechaza. Una persona paga con un solo perfil a la vez: quien ya es miembro de
  otro, o organiza uno con personas, tiene que dejarlo antes.
- **Pagar.** Un miembro elige «Perfil familiar» al pedir comida, un viaje o un envío. El cobro
  sale de la Wallet de quien organiza. El miembro ve quién paga y cuánto le queda del tope
  del mes, **nunca el saldo** de quien organiza. Si el pago supera lo que queda, responde 402
  con lo que queda y no se cobra nada.
- **El comprobante.** Quien organiza recibe un aviso con cada cobro («Ana pagó un viaje por
  $ 8.500 con tu Wallet»), que también se lee en la bandeja de notificaciones de las dos apps.
  En su panel ve los últimos 20 cobros del perfil, con lo devuelto, y abre el comprobante de
  cada servicio terminado.
- **Dejar o sacar.** El miembro deja el perfil, o quien organiza lo saca, cuando quiera. Desde
  ese momento sus pagos salen de su propia Wallet. Las dos partes se enteran.
- **Propinas.** La propina del checkout de un pedido viaja dentro del cobro, así que la paga
  quien organiza y, si vuelve, vuelve a quien organiza. El miembro la ve igual en su actividad,
  y la app no le ofrece dejar otra. La propina que un miembro deja
  después de terminado un servicio sale de su propia Wallet.
- **Dividir la tarifa (PAG-02)** no se ofrece en un viaje pagado con el perfil: lo pagó otra
  persona.

## El dinero

El cobro se asienta como cualquier pago con Wallet, pero de la billetera de quien organiza:
`payment_intents.customer_id` es **quien pagó** y `family_member_id` la membresía que lo usó
(migración 147). `jobs.customer_id` sigue siendo quien pidió.

**Todo reintegro vuelve a quien pagó**: la cancelación de un pedido, un viaje o un envío, el
reintegro de una incidencia, el de una sustitución más barata, la propina de un pedido que se
completó sin repartidor y el ajuste de una propina. Antes todos volvían a quien pidió. Con el
perfil familiar, eso habría pasado plata de quien organiza al miembro en cada cancelación.
Quien pagó recibe una push con cada reintegro de una cancelación.

**Si quien pagó borró su cuenta**, el reintegro va a quien pidió, que es quien recibió el servicio.
Un reclamo se puede abrir y aprobar después de que quien organiza borró su cuenta, y esa plata
quedaba en una billetera a la que nadie entra. Vale para cancelaciones, incidencias,
sustituciones, la propina sin repartidor y los ajustes de propina.

El tope se controla en la misma transacción del cobro, con la membresía bloqueada: dos pedidos
simultáneos del mismo miembro no pasan los dos. Lo gastado es lo capturado en el mes calendario
de Argentina, neto de reintegros, porque cada reintegro baja `captured_amount_cents`. Se restan
además las propinas que vuelven a quien organiza sin tocar el cobro: la del checkout de un pedido
que se completó sin repartidor y el ajuste aprobado de una propina. Si un pedido supera lo que
queda, la cotización ya lo avisa (402), y con el tope agotado las apps no ofrecen el perfil.

## Defectos cerrados en el camino

- **Envíos sin cobrar.** La API aceptaba cualquier texto como medio de pago de un envío, y uno
  que no dijera «wallet» creaba un envío sin cobrar, que después no se liquidaba al repartidor.
  Ahora sólo acepta «Flash Wallet» o «Perfil familiar», y el cobro elige el camino de forma
  explícita.
- **Cancelar después de un reintegro parcial.** Un pedido con un reintegro parcial previo (una
  incidencia o una sustitución) se cancelaba sin devolver el resto. Ahora vuelve lo que quedó
  cobrado.
- **Una billetera que falta.** Cancelar rompía si quien pidió no tenía una fila de billetera.
  Ahora la billetera de quien pagó se crea si falta.

## Seguridad

- Invitar a alguien y cambiar su tope es darle permiso para gastar de tu Wallet. Con la
  verificación en dos pasos activa ([`account-mfa.md`](account-mfa.md)) piden el código.
- Las rutas que cambian algo tienen su propio límite de pedidos por minuto.
- RLS: el perfil lo ve quien lo organiza; los miembros los ve quien organiza y cada miembro su
  propia fila. La política del perfil no consulta a los miembros: dos políticas que se
  consultan entre sí son una recursión infinita para PostgreSQL. La auditoría no ve el email
  escrito.
- **Borrar la cuenta.** Quien organiza no puede borrar su cuenta con un servicio en curso que
  pagó: una cancelación le va a devolver plata. Al borrarla, el perfil se disuelve. Un miembro
  que borra su cuenta deja el perfil. Los emails escritos en invitaciones se borran.
- La cuenta de quien organiza se bloquea durante el cobro (`FOR SHARE`), contra su borrado,
  **antes** que la membresía: el borrado bloquea la cuenta y después, con su trigger, las
  membresías. En el orden inverso, cobro y borrado se esperaban mutuamente y la base abortaba
  uno. Aceptar una invitación sigue el mismo orden.
- Dejar el perfil y sacar a alguien bloquean primero la cuenta que recibe el aviso y después la
  membresía, el mismo orden que el borrado de esa cuenta.
- La cotización de un pedido usa su propia conexión para leer el perfil: pedir otra mientras la
  sostiene agotaba el pool con muchas cotizaciones a la vez.
- Invitar y aceptar se ordenan por persona con un bloqueo consultivo: organizar y ser miembro se
  excluyen, y dos aceptaciones simultáneas de la misma persona ya no terminan en un 500.
- Quien organiza tampoco borra su cuenta con una incidencia abierta o un ajuste de propina
  pendiente sobre algo que pagó: ese reintegro también vuelve a quien pagó.

## Brechas

- Uber deja ver al organizador el detalle de cada viaje en vivo; en Flash recibe el aviso y el
  comprobante.
- No hay perfiles para adolescentes (Uber los tiene en algunos países con verificación de
  edad).
- Se paga sólo con la Wallet de quien organiza. Cargarla con Mercado Pago depende de las
  credenciales de producción (PAG-07, dueño).

## Validación

`npm run test:family-profiles` (en `ci-critical-flows`) usa cuentas sintéticas y la API real:

- invitar (un email sin cuenta responde igual, repetido 409, a sí misma 400, nueve como máximo);
- responder (aceptar, rechazar, ajena 404, repetida 409) y que un miembro no organice otro;
- un viaje con el perfil, por la API: se cobra de quien organiza, con la membresía en el cobro y
  el aviso; no se divide; quien organiza no borra su cuenta con él en curso; al cancelarlo, la
  plata vuelve a quien organiza;
- un envío con el perfil, por la API, y uno con un medio desconocido (400);
- el tope: un viaje que lo supera (402, sin cobro), lo gastado y lo que queda;
- un pedido con un reintegro parcial previo: al cancelarlo vuelve el resto, a quien pagó;
- dejar el perfil, ser sacado y borrar la cuenta de un miembro.

Comprueba los saldos del libro contable en cada paso. Si falla, alguien puede pagar sin cobro,
recibir plata de otra persona o pasarse del tope. Borra todo lo que crea.

`npm run test:family-profiles-contract` (en `ci-fast`) vigila lo que esa prueba no ve: que cada
camino de reintegro use a quien pagó, que los tres servicios cobren por un camino explícito,
la membresía bloqueada, el segundo factor, la RLS sin recursión y las dos apps.
`test:rls` prueba que un conductor y otro cliente no ven un perfil ajeno.
