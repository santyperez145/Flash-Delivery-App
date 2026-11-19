# Tarjetas de regalo (PAG-04)

Como en Uber: se regala saldo de Flash para pedidos, viajes y envíos.

## Cómo funciona

- **Comprar.** Un cliente compra la tarjeta con el saldo de su Flash Wallet, desde $ 1.000. No
  hay otro tope que el saldo. Elige el importe, y si quiere, el email de quien la recibe y un
  mensaje de hasta 140 caracteres. Recibe el código en el momento, para compartirlo por donde
  quiera: WhatsApp, mensajes o mail, con la hoja del sistema en el teléfono.
- **Dirigida a una cuenta.** Si el email es de un cliente Flash activo, la tarjeta le aparece
  en su Wallet con el nombre de quien la regaló y el mensaje, y la canjea con un toque, sin
  escribir el código. Además recibe una push.
- **Dirigirla no dice quién tiene cuenta.** Un email que no es de un cliente activo se guarda
  igual, sin destinatario, y la respuesta es la misma. El código sirve igual.
- **Canjear con el código.** En la Wallet, «¿Te regalaron un código?». Se escribe con o sin
  guiones, en mayúsculas o minúsculas. El importe entra a la Wallet al instante. Quien compró
  recibe una push cuando la canjean.
- **Anular.** Quien la compró la anula mientras nadie la canjeó. El código deja de servir y el
  importe vuelve a su Wallet. Quien compró no puede canjearla él mismo: para recuperar el saldo,
  la anula.
- **No vence** y no se cambia por dinero.
- **El saldo se actualiza.** Después de comprar, canjear o anular, web y móvil vuelven a leer la
  cuenta, y las otras sesiones de la persona reciben el aviso en tiempo real.

## Seguridad

Comprar tarjetas de regalo es la forma clásica de sacar saldo de una cuenta robada: el ladrón
convierte el saldo en un código y lo canjea en otra cuenta.

- **Segundo factor.** Con la verificación en dos pasos activa ([`account-mfa.md`](account-mfa.md)),
  comprar pide el código de la app autenticadora. Con la contraseña sola no alcanza.
- **Aviso en el momento.** Cada compra se avisa a quien compró por push y por email. Si no fue
  la persona, se entera antes de que alguien la canjee y la puede anular.
- **El código no se guarda en claro.** Son 16 caracteres de un alfabeto de 32 (80 bits), sin
  0, 1, O ni I, que se confunden al copiarlos. Se busca por HMAC (`code_hash`). Se guarda
  cifrado con AES-256-GCM (`code_ciphertext`) para que quien compró lo vuelva a ver mientras
  está vigente. Al canjearse o anularse, el cifrado se borra. La auditoría no puede leer el
  código, su HMAC, el email escrito ni el mensaje.
- **Canjear tiene límite.** Con 80 bits por código no hay adivinanza posible, pero el límite de
  pedidos por minuto corta igual un barrido. Un código mal escrito responde igual que uno que no
  existe, y una tarjeta dirigida a otra cuenta, igual que una que no existe.
- **Una compra, un cobro.** Comprar exige `Idempotency-Key`. Las apps arman una clave por compra
  y la reusan si la red se corta: el reintento devuelve la misma tarjeta, sin cobrar otra. La
  Wallet se bloquea antes de controlar el saldo, así dos compras simultáneas no gastan la misma
  plata.
- **Borrar la cuenta borra los datos personales.** El email escrito y el mensaje se borran con
  la cuenta de quien compró, de quien la recibió o de quien tiene ese email. La tarjeta sigue
  valiendo: es plata que alguien pagó, y el código sigue en manos de quien lo tenga.

## El dinero

Al comprar, el importe sale de la Wallet de quien compra y entra a una cuenta de la plataforma,
`gift_card_liability`: es plata que Flash debe hasta que alguien la canjee. Al canjear, sale de
esa cuenta hacia la Wallet de quien canjea; al anular, vuelve a quien compró. Todo con el asiento
`gift_card` (migración 146), cuadrado en una sola transacción. El saldo de esa cuenta es siempre
la suma de las tarjetas vigentes: el libro contable dice cuánto debe Flash en tarjetas sin
cruzar otra tabla.

## Por encima de Uber

- Uber no devuelve una tarjeta comprada; en Flash, quien compró la anula mientras nadie la
  canjeó.
- Uber manda la tarjeta digital por email. Flash la deja además en la Wallet de la cuenta Flash
  de ese email, para canjearla con un toque.
- Cada compra se avisa por push y email, y con la verificación en dos pasos activa pide el
  código.

## Brechas

- Se compra sólo con saldo de Wallet, no con tarjeta en el momento. Cargar la Wallet con
  Mercado Pago depende de las credenciales de producción (PAG-07, dueño).
- No se venden en comercios físicos ni a empresas.
- No hay diseños de tarjeta para elegir.

## Validación

`npm run test:gift-cards` (en `ci-critical-flows`) usa cuatro cuentas sintéticas con saldo
cargado en el libro contable. Recorre:

- la compra, y que repetir la clave no cobre otra;
- que el código no quede en claro;
- la tarjeta dirigida a una cuenta y la dirigida a un email sin cuenta;
- la compra sin saldo (402, sin movimientos);
- el canje por cuenta y el canje por código;
- el rechazo de un código usado, de uno mal escrito y del propio;
- la anulación.

Al final comprueba que la cuenta de la plataforma vuelva a cero y que la plata sólo haya
cambiado de Wallet. Si falla, alguien puede cobrar dos veces, canjear dos veces o perder su
saldo. Borra todo lo que crea.

`npm run test:gift-cards-contract` (en `ci-fast`) vigila lo que esa prueba no ve:

- el código cifrado y buscado por HMAC;
- la auditoría sin secretos;
- el segundo factor antes de cobrar;
- la Wallet bloqueada antes del saldo;
- el límite en cada ruta;
- el borrado con la cuenta;
- el panel en web y teléfono.

`test:rls` prueba que una tarjeta la ve quien la compró y no la ve un conductor ni otro cliente.
