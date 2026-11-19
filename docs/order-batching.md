# Pedidos agrupados (P-03)

Uber Eats y DoorDash le ofrecen a quien reparte sumar un segundo pedido del mismo local:
lo retira junto con el que ya iba a buscar y los entrega uno después del otro. Uber Eats
lo describe como aceptar varios pedidos del mismo comercio, con un aviso para aceptar o
rechazar el segundo, y limita el agrupado cuando las entregas se demorarían demasiado
([Uber, entregar varios pedidos](https://www.uber.com/drive/delivery/basics/delivering-multiple-orders/);
[Uber Australia, pedidos agrupados para restaurantes](https://www.uber.com/au/en/newsroom/batched-orders-how-do-they-work-for-restaurants/)).
DoorDash los llama ofertas agrupadas, suelen salir del mismo local y la app sugiere el
orden del recorrido
([DoorDash, por qué recibí varias ofertas juntas](https://help.doordash.com/dashers/s/article/Why-did-I-receive-multiple-orders-at-once)).

Es la palanca más directa sobre el costo por entrega: un viaje al local en lugar de dos.

## Cómo funciona

- **Cuándo se ofrece.** Un pedido de comida queda listo para retirar y otro repartidor ya
  tiene asignado un pedido de **la misma sucursal** que todavía no retiró (asignado o
  llegando). Si la entrega del nuevo queda en el camino, a ese repartidor se le ofrece
  sumarlo antes que a nadie: «Sumá un pedido del mismo local». En esa ronda el pedido no se
  le ofrece suelto a nadie más; si nadie acepta el lote, la ronda siguiente, cuando vencen
  las ofertas (45 s), lo abre a los repartidores libres.
- **El tope de desvío.** Lo que espera de más el segundo cliente por pasar antes por la
  casa del primero, en línea recta:
  `local→casa 1 + casa 1→casa 2 − local→casa 2`. No puede pasar de
  `FOOD_BATCH_MAX_DETOUR_M` (2.500 m por defecto). Los minutos que suma se le avisan a quien
  reparte en la oferta y se le suman al horario estimado del segundo cliente al aceptar.
- **El primer cliente no espera de más.** Su pedido se entrega primero. El lote se arma con
  el primero todavía en el local, así que sólo se suma el tiempo de retirar otra bolsa.
- **Como mucho dos pedidos.** El primero no puede ser a su vez un segundo, y un índice único
  impide que un pedido sostenga dos. Quien reparte no puede tener ningún otro servicio en
  curso, de ningún tipo: ni un envío ni un viaje con pasajero.
- **A quien ya lleva un pedido no le llega uno suelto.** Antes, un repartidor con un pedido
  podía aceptar otro de cualquier local, sin orden ni tope de desvío. Ahora, con un pedido en
  curso, uno de comida sólo se acepta si forma lote con él. Quien lleva un servicio se saca
  **en la lista corta**, antes del corte y antes de decidir si el radio alcanza: sacarlo
  después dejaba el pedido sin ofertas cuando los más cercanos, que suelen ser los que ya
  están en un local, llevaban uno, aunque hubiera repartidores libres un poco más lejos.
- **En cada ronda, otro repartidor.** Quien ya recibió la oferta de un lote no ocupa un lugar
  en la ronda siguiente: el lote le llega a otro repartidor del mismo local.
- **Al aceptar se vuelve a controlar.** Entre la oferta y la aceptación el primero pudo
  retirarse, cancelarse o recibir otro segundo. El repartidor se bloquea, después el primer
  pedido, y el lote se vuelve a calcular para ese repartidor. Si ya no se forma, la
  aceptación se rechaza con un 409.
- **Efectivo.** Un lote en efectivo respeta el tope de deuda de quien reparte (PAG-01), con lo
  que va a deber al cobrar los dos. Se filtra antes de elegir los dos repartidores: si los
  mejores deben de más, el lote le llega al siguiente.
- **El lote se deshace solo.** Si uno de los dos se cancela, o la operación le saca un pedido
  al repartidor y vuelve a la cola, un trigger de la base corta el vínculo y le resta al
  segundo los minutos de desvío. Se hace en la base porque las cancelaciones y liberaciones
  vienen de varios caminos: un vínculo viejo mostraría «Entrega 2 de 2» a quien lleva uno solo,
  impediría volver a agrupar el pedido y le sumaría el desvío dos veces. Las vistas, además,
  sólo muestran el lote mientras los dos están en curso. Un pedido que ya es parte de un lote
  nunca se suma a otro: no hay cadenas de tres.
- **Se puede apagar** por ambiente con `FOOD_BATCHING_ENABLED=false`.

## Lo que ve cada uno

- **Quien reparte**, en web y en la app:
  - la oferta destacada, con el detalle «Retirás los dos juntos · lo entregás segundo · +N
    min»;
  - en toda oferta de comida, lo que gana (el envío y la propina del checkout, como los paga
    la liquidación) en lugar del total que paga el cliente;
  - sus pedidos activos en el orden del recorrido, cada uno con «Entrega 1 de 2» o «Entrega 2
    de 2»;
  - el aviso «Retirá los 2 pedidos del local» mientras falte retirar alguno;
  - la próxima parada: en la app, la navegación va al local mientras falte retirar y después a
    la entrega 1; en la web, una línea «Próxima parada».
- **Quien pidió**, en el seguimiento: si va segundo, «Tu repartidor entrega primero otro pedido
  del mismo local. Ya está contado en el horario estimado.»; si va primero, que es la primera
  entrega. Del otro pedido no se muestra nada: es de otra persona.
- **El comercio** no ve nada distinto: entrega dos pedidos al mismo repartidor.

## Brechas

- **Sólo dos pedidos y sólo del mismo local.** Uber Eats agrupa hasta tres en algunos
  mercados
  ([Uber Australia, lotes de tres](https://www.uber.com/au/en/blog/triple-batching-for-restaurants)).
- **El desvío se mide en línea recta**, no por calle. El proveedor de rutas ya calcula
  recorridos; usarlo en cada oferta sumaría una llamada externa por candidato.
- **El segundo pedido no paga un plus.** Quien reparte cobra el envío de cada pedido, como
  hoy. No se encontró fuente oficial de cómo pagan Uber Eats y DoorDash un lote en Argentina.
- **Sin entrega en otro orden.** El primero se entrega primero siempre; DoorDash deja que
  quien reparte elija.

## Validación

`npm run test:order-batching` (en `ci-critical-flows`) arma con un repartidor y pedidos
sintéticos, sobre dos sucursales de ejemplo:

- un pedido del mismo local y en el camino, que se le ofrece como lote al repartidor que va a
  ese local;
- uno con un desvío de más y uno de otro local, que no se le ofrecen ni como lote ni sueltos;
- una aceptación de un pedido de otro local con uno en curso, que se rechaza;
- la aceptación del lote, que lo une al primero y suma el desvío al horario;
- las vistas, que dicen qué entrega es cada uno;
- la liberación del segundo, que lo devuelve a la cola sin vínculo ni desvío, y su vuelta a
  agruparse con el desvío sumado una sola vez;
- la cancelación del primero, que deja al segundo solo y sin el desvío;
- un control: ya sin pedidos, el mismo repartidor sí recibe un pedido suelto. El repartidor
  sintético tiene un vehículo aprobado, así que es un candidato de verdad y el «no recibe uno
  suelto» de antes prueba el filtro, no el corte.

Borra todo lo que crea, incluidos los avisos de oferta que reciben los repartidores de ejemplo.
No se pudo correr en local, porque no hay credenciales de la base local; corre en el CI.

`npm run test:order-batching-contract` (en `ci-fast`) vigila lo que esa prueba no ve: que el lote
sólo junte pedidos de la misma sucursal y sin retirar, que no pase de dos ni se sume a otro
servicio, que el tope salga de la configuración, que la aceptación vuelva a controlar con el
repartidor y el primer pedido bloqueados y antes de asignar, que un lote en efectivo respete
la deuda, que a quien ya lleva un pedido no le llegue uno suelto, y que la oferta, el
recorrido, la navegación y el seguimiento lo muestren en web y en la app. Si falla, alguno de
esos controles se perdió y un repartidor podría juntar pedidos de locales distintos, o un
cliente esperar un desvío que nadie le avisó.
