# Acceso y confianza (FE-03)

Primera ola de la puesta a la par de los frontends, salida de probar el sistema en el
navegador contra PostgreSQL con cuentas de prueba creadas por la API real, sin datos
sembrados.

## Lo que se encontró

- **La web no dejaba crear una cuenta.** Sólo ingresar, con el texto «Accedé con la cuenta
  asignada a tu operación Flash»: una persona que llegaba por el navegador no tenía cómo
  registrarse ni recuperar su contraseña. La app sí tenía los dos flujos, y el servidor los
  endpoints. Uber, Uber Eats, PedidosYa y Rappi dejan registrarse desde la web.
- **La cuenta de cliente en la web no tenía «Cerrar sesión».**
- **Una base recién creada mostraba «40% off en seleccionados».** La migración 015 sembraba
  dos promociones de demostración en toda base; la portada la ofrecía sin un solo comercio
  donde usarla.
- **Sin comercios, la portada y Explorar quedaban en blanco**, en la web y en la app, sin
  decir qué pasaba ni qué hacer.
- **Textos de Cuenta sin tildes y en tuteo** («Telefono», «Aun no tienes»).

## Lo que cambió

- **Alta en la web**, con nombre, email, teléfono opcional y contraseña; la verificación
  del email con el código de seis números, reenvío incluido, y el ingreso directo al
  verificar. Un ingreso con el email todavía sin verificar pasa a la verificación en lugar
  de mostrar un error. **Recuperación de la contraseña**: se pide el código por email, se
  pega y se elige la nueva; el servidor cierra las sesiones anteriores y el ingreso queda
  con el email cargado. Los endpoints son los mismos que usa la app.
- **Fuera de producción**, sin proveedor de email, el servidor devuelve el código de
  desarrollo y la web lo muestra rotulado como tal. En producción el servidor no lo manda.
- **«Cerrar sesión»** en Cuenta, en la web.
- **Sin comercios en la zona**, la portada y Explorar dicen «Todavía no hay comercios en tu
  zona» y que mientras tanto se puede pedir un viaje o mandar un envío; la app ofrece ir a
  Viajes. Una promoción de comida no se muestra sin un comercio abierto donde usarla.
- **Migración 150**: apaga las dos promociones de demostración en toda base donde nadie las
  usó. Una que ya tiene canjes es una campaña real y se respeta. Las semillas de desarrollo
  (`db:seed:commerce`) las vuelven a crear para las pruebas.
- Textos de Cuenta con tildes y voseo.

## Validación

Probado en el navegador contra PostgreSQL: alta, verificación e ingreso; cierre de sesión;
recuperación de la contraseña e ingreso con la nueva; la portada y Explorar sin comercios en
la web y la portada en la app. Los 40 flujos críticos pasan contra una base sembrada como la
del CI, con la migración 150 y las semillas nuevas.

`npm run test:web-access-trust` (en `ci-fast`) vigila el cableado: los endpoints del alta,
la verificación y la recuperación; que el error del cliente conserve el cuerpo de la
respuesta, de donde sale `verificationRequired`; que el alta y la recuperación validen lo
mismo que el servidor; el «Cerrar sesión»; los textos de Cuenta; los estados sin comercios
y la promoción condicionada en web y app; y que la migración 150 respete las promociones
usadas. Falsificado con 38 mutaciones. Si falla, la web vuelve a dejar a alguien sin forma
de crear su cuenta o de salir, o una pantalla vuelve a prometer lo que no hay.

## Lo que sigue

El resto de las olas de [`plan-frontends.md`](plan-frontends.md), salidas de la auditoría de
los frontends contra la competencia: Cuenta como menú con
subpantallas, el alta de comercios y repartidores (hoy sólo existen por semillas), y las
olas de descubrimiento, checkout y seguimiento.
