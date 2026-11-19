# Nada inventado (FE-04)

Segunda ola del [plan de los frontends](plan-frontends.md). La regla del proyecto es «todo
real, nada falso»: una pantalla no muestra un dato que nadie dio. La auditoría de las cinco
superficies encontró valores fijos que se leían como datos reales; esta ola los saca.

## Lo que se encontró y cómo quedó

- **Productos con calificación y calorías de fábrica.** Todo producto nuevo nacía con 4,5
  estrellas, 500 kcal, la etiqueta «Nuevo» y la foto del local como foto del plato. Ahora
  sólo se guarda lo que el comercio declara (kcal, minutos y una foto https, opcionales), y
  ningún plato tiene estrellas: Uber Eats y PedidosYa califican al comercio, no al plato.
  La **migración 151** limpia lo ya guardado: la clave `rating` de los productos, las
  `kcal` en 500, la etiqueta `["Nuevo"]` y la foto igual a la del local.
- **Calificación del comercio.** Caía a un número guardado en la metadata cuando no había
  calificaciones. Ahora sale sólo de la tabla de calificaciones, con su cantidad, y se
  muestra «★ 4,6 (120)» desde 10 opiniones; por debajo, «Nuevo». En la app, «Abierto ahora»
  sale del estado real del local, y «Elegidos para vos» pasó a «Abiertos ahora», que es lo
  que la lista muestra.
- **Calificación de quien maneja.** El seguimiento del cliente, la consola y la app del
  repartidor mostraban el 5 inicial de la tabla como si fuera una nota. Ahora llega la
  cantidad de calificaciones y, sin ninguna, se dice «Nuevo» o «Todavía no te calificaron».
- **La app del cliente** mostraba cuántos conductores había en línea (un dato interno), y
  un formulario «Agregar tarjeta sandbox». Ninguno de los dos queda.
- **La app del repartidor** precargaba el vencimiento de un documento en 2099 y mostraba
  ceros mientras cargaba. Ahora el vencimiento se pide, y lo que no llegó se muestra «—».
- **Las consolas** tenían pines decorativos en el mapa y la cuadrícula, un «puntaje de
  madurez» calculado sobre una base fija de 42, hitos escritos a mano presentados como
  estado, un volumen que sumaba lo cancelado y lo no cobrado, promedios de $0 sin datos,
  tasas de asignación de 0% sin pedidos y «Zonas calientes · Live» con una demanda que es
  configuración de precios. Ahora el volumen cuenta sólo lo cobrado y no lo cancelado, un
  promedio sin datos es «—», la tasa sin pedidos es «—», las zonas se llaman «Zonas de
  servicio» con su «demanda configurada», y el puntaje y los hitos no existen más.
- **La consola del comercio** usaba la foto del local para un producto sin foto, y
  precargaba un horario de 9 a 23 en una sucursal sin horario. Ahora dice «Sin foto
  todavía» y «Esta sucursal todavía no tiene horario».

## Validación

Probado en el navegador contra PostgreSQL con la cuenta de operaciones: el resumen, las
finanzas y la infraestructura sin cifras de relleno. Los 40 flujos críticos pasan contra una
base sembrada como la del CI, con la migración 151 y las semillas.

`npm run test:no-invented-data` (en `ci-fast`) vigila que no vuelva nada de lo anterior:
el alta de producto, la migración, la calificación real del comercio y de quien maneja en
web y app, la app sin relleno, el tablero sin puntaje ni hitos y con el volumen bien
contado, y la consola del comercio. Falsificado con 20 mutaciones. Si falla, una pantalla
volvió a mostrar un dato que nadie dio.

## Lo que sigue

La foto de un producto todavía no se puede subir desde la consola: el alta acepta una URL
https, y la carga del archivo va con la edición del catálogo (FE-21). El alta real de
comercios (FE-05) y de repartidores (FE-06) son las próximas olas: sin ellas no hay datos
reales que mostrar.
