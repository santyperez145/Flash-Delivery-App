# Pedidos grupales

La vía natural al ticket promedio alto y al pedido de oficina, donde un pedido
reemplaza a diez. Uber Eats, DoorDash y Rappi los tienen; Flash los anunciaba en
la portada del cliente —«Grupal · Pedido compartido»— sin que existiera nada
detrás. La migración 128 los hace ciertos.

## Un grupo confirmado se convierte en un pedido normal

**No hay una segunda tubería de pedidos.** Se juntan los ítems de todos, se
cotiza y se crea por `/api/orders` con el camino de siempre. De ahí en adelante
la propina, la suscripción, el horario reservado, el despacho y la liquidación no
necesitan saber que esto empezó como grupo — que es exactamente lo que evita que
cada una crezca un caso especial dentro de seis meses.

## Cada participante tiene su canasta

Reusar `carts` habría sido menos código, pero admite un único carrito activo por
`(cliente, comercio)`: sumarse a un grupo del mismo restaurante donde ya tenías
algo guardado te lo habría pisado sin avisar. `group_order_items` cuelga del
participante y no toca el carrito personal de nadie.

## El tope de gasto se verifica contra la base

`spend_limit_cents` es por persona y se comprueba **contra los precios de
`catalog_items`**, no contra los que manda el cliente. Un tope que se pueda
esquivar mandando precios inventados no es un tope, y es la diferencia entre un
pedido entre amigos y uno de oficina con presupuesto. El rechazo revierte la
canasta entera: la transacción vuelve atrás o el tope habría sido un cartel.

## El código da entrada, no lectura

Seis caracteres de un alfabeto sin `0/O` ni `1/I/L`, que son los pares que se
copian mal al dictarlo. **La política RLS dice lo mismo del otro lado**: ver un
grupo es ser parte de él. Al revés, cualquiera con un código filtrado leería
quién pidió qué en una oficina.

Las políticas de la migración 128 eran mutuamente recursivas y toda lectura
fallaba; la 129 lo resuelve con una función `SECURITY DEFINER` que responde la
pertenencia sin volver a pasar por RLS. Una política no puede necesitar su propio
resultado.

## Líneas sumadas, no un acta

Dos personas que piden la misma hamburguesa son **una línea de cantidad dos**, y
las notas de las dos sobreviven concatenadas. La cocina lee un pedido, no un
registro de quién pidió qué; perder «sin cebolla» porque otro pidió lo mismo
sería el error caro de esa función.

## Estados

`open` admite gente e ítems · `locked` corta el agregado para que el anfitrión
revise sin que el total cambie bajo sus pies · `placed` queda atado al pedido
creado · `cancelled` lo cierra.

Sólo el anfitrión cierra, reabre, cancela y confirma. `group_order_participants`
tiene un índice único parcial sobre `is_host`: dos filas de anfitrión dejarían
dos personas habilitadas a cobrar el mismo pedido.
