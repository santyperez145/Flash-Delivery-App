# Acceso mobile: referencia competitiva y decisión Flash

Fecha: 22 de agosto de 2026.

## Evidencia verificada

- [Uber — verificación en dos pasos](https://help.uber.com/en/riders/article/troubleshooting-2-step-verification?nodeId=bda9eae2-b394-4224-8090-06802a45bef2)
  documenta un acceso secuencial con código, reenvío y métodos alternativos de
  entrega. La persona resuelve una decisión por pantalla y la recuperación queda
  junto al desafío que puede fallar.
- [Lyft — no puedo iniciar sesión](https://help.lyft.com/hc/en-us/all/articles/115012926107-I-can-t-log-in)
  confirma la identidad por teléfono/código y mantiene una salida explícita para
  encontrar o recuperar la cuenta.
- [Apple HIG — Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts)
  recomienda explicar el beneficio de la cuenta, minimizar ingreso manual,
  identificar con precisión cada método y preferir passkeys o autenticación del
  sistema cuando estén realmente disponibles.
- [Apple HIG — Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
  desaconseja esquemas propios innecesarios, exige almacenamiento seguro y
  prioriza Password AutoFill, passkeys y autenticación nativa.

## Decisión de producto

Flash adopta un acceso progresivo propio y no copia identidad, textos ni activos:

1. El primer paso solicita sólo el email y explica que una cuenta cubre Comidas,
   Viajes y Envíos.
2. El segundo paso confirma la identidad elegida y solicita la contraseña, con
   acción visible para cambiar email, mostrar/ocultar y recuperar acceso.
3. Registro, OTP de verificación y recuperación son estados separados. Cada uno
   tiene título, explicación, acción primaria y salida clara.
4. Errores, carga y botones deshabilitados son honestos; no se muestran botones
   Apple, Google, biometría, teléfono u OTP si el backend y el proveedor no están
   configurados.
5. La UI no autocompleta `developmentCode` ni `developmentToken`. Los valores de
   desarrollo pueden seguir existiendo en contratos de pruebas, pero nunca se
   inyectan en una pantalla que pretenda representar el flujo del usuario.
6. Tokens de sesión continúan en SecureStore/Keychain/Keystore y la recuperación
   revoca sesiones anteriores mediante el contrato backend existente.
7. Customer, Driver y Merchant reciben hero y contexto propios. Sólo Customer
   ofrece registro público; Driver y Merchant explican su onboarding verificado
   sin crear cuentas de rol incorrecto. Si una credencial válida intenta entrar
   en otra variante, el refresh token recién emitido se revoca antes del error.

## Próximas capacidades, bloqueadas hasta integración real

- Passkeys con asociación de dominio y credenciales server-side.
- Sign in with Apple y Google mediante credenciales, redirect URIs, revisión de
  privacidad y builds físicos.
- Acceso por teléfono con proveedor SMS, protección antiabuso, presupuesto,
  observabilidad y recuperación ante cambio o pérdida de número.
- Biometría sólo para desbloquear una sesión local ya autenticada; nunca como
  sustituto visual de un contrato inexistente.

## Gate de terminado

El acceso debe pasar typecheck, build web, 320×568, 390×844 y 768×1024 sin
overflow; además debe verificar email → contraseña → sesión real para Customer,
Driver y Merchant. Registro, OTP y recuperación deben conservar rate limits,
mensajes no enumerables y revocación de sesiones.
