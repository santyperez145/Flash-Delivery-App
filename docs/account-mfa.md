# Verificación en dos pasos para toda cuenta (SEG-08)

Uber deja proteger cualquier cuenta con un segundo factor: un código por SMS o de una app
autenticadora, y códigos de respaldo de un solo uso para cuando se pierde el teléfono
([Uber, ayuda](https://help.uber.com/h/b8bb9152-8c91-4f49-83c4-35cf2e1dcf72)). En Flash el
segundo factor existía sólo para administradores ([`admin-mfa.md`](admin-mfa.md)). Desde
SEG-08 lo puede activar cualquier cliente, conductor o comercio, en la web y en la app.

## Qué ve la persona

- **Activar.** En la cuenta, «Verificación en dos pasos» → «Activar».
  - En la web se escanea un QR.
  - En el teléfono no se puede escanear la propia pantalla: un botón abre la app
    autenticadora con el enlace `otpauth`, o se copia la clave a mano.
  - Se muestran una sola vez ocho códigos de recuperación, que se pueden copiar,
    descargar o compartir a un gestor de contraseñas.
  - La activación termina con un código de la app.
- **Al activarla se cierran todas las demás sesiones**: si alguien tenía la cuenta abierta en
  otro lado, queda afuera. El aviso dice cuántas se cerraron.
- **Ingresar.** En un dispositivo nuevo, después de la contraseña se pide el código (o uno de
  recuperación). La sesión que pasó el código **se renueva sola**: el teléfono propio no lo
  vuelve a pedir cada vez, como el dispositivo de confianza de Uber o Google.
- **Acciones sensibles** piden el código además de la contraseña:
  - eliminar la cuenta;
  - autorizar un retiro de un comercio;
  - desvincular el cobro de Mercado Pago.
- **Desactivar o generar códigos nuevos** pide un código vigente. Con un teléfono
  desbloqueado o un token robado no se apaga la protección.
- **Cada cambio se avisa por push y por email**: activar, desactivar, generar códigos nuevos o
  usar un código de recuperación. Si no fue la persona, se entera.

## Cómo funciona

- **TOTP estándar (RFC 6238)**, compatible con Google Authenticator, Microsoft Authenticator,
  1Password o Authy. Se tolera un paso de 30 segundos de desfase de reloj hacia cada lado.
- **Un código sirve una sola vez.** Se guarda el último paso usado (`user_mfa.last_totp_step`,
  migración 145) y no se acepta ese ni uno anterior. Quien vea el código por encima del
  hombro no puede reusarlo dentro de su ventana.
- **Guardado:** el secreto va cifrado con AES-256-GCM (`MFA_ENCRYPTION_KEY`) y los códigos de
  recuperación sólo como hashes bcrypt. Desactivar no borra la fila: deja `disabled_at`.
- **Bloqueo:** cinco códigos inválidos seguidos bloquean la verificación quince minutos. El
  bloqueo cuenta también los intentos de las acciones sensibles, que si no servirían para
  probar códigos sin límite.
- **La sesión recuerda el segundo factor** (`refresh_sessions.mfa_verified_at`). La rotación
  copia la marca. Con la verificación activa, una sesión sin marca o con una marca anterior a
  la activación no se renueva: el servidor la cierra y devuelve un desafío. Cubre la carrera
  de un ingreso que empezó justo antes de activarla.
- **Sólo un token de acceso autentica.** El token de acceso lleva `typ: "access"` y
  `requireAuth` rechaza cualquier otro. El desafío de cinco minutos, la autorización de un
  retiro y la validación de una dirección se firman con la misma clave, y algunos llevan
  `sub`. Antes de este control, el desafío que devuelve la contraseña sola servía como token
  de acceso de la cuenta entera, lo que anulaba el segundo factor.
- **Los administradores** siguen como en [`admin-mfa.md`](admin-mfa.md): vuelven a pasar el
  segundo factor en cada renovación, y con `REQUIRE_ADMIN_MFA` no pueden desactivarlo.
- **Un código mal escrito dentro de una sesión responde 403, no 401.** Los clientes web y
  móvil renuevan la sesión ante cualquier 401. Un administrador que renueva vuelve a pasar el
  segundo factor, así que un 401 por un dígito equivocado lo dejaba afuera. Un código que
  falta en una acción sensible responde 403 con `mfaRequired: true`. El segundo paso del
  ingreso, donde todavía no hay sesión, sigue respondiendo 401.

Rutas (documentadas en OpenAPI, `server/openapi-account-mfa.js`):

| Ruta | Qué hace |
| --- | --- |
| `GET /api/auth/mfa/status` | Estado, fecha de activación, códigos que quedan, bloqueo |
| `POST /api/auth/mfa/enroll` | Secreto, URI `otpauth` y ocho códigos, una sola vez |
| `POST /api/auth/mfa/confirm` | Activa con un código, emite sesión nueva y cierra las demás |
| `POST /api/auth/mfa/complete` | Segundo paso del ingreso |
| `POST /api/auth/mfa/disable` | Desactiva con un código vigente |
| `POST /api/auth/mfa/recovery-codes` | Ocho códigos nuevos; los anteriores dejan de servir |

## Verificación

- `npm run test:account-mfa` (en `ci-critical-flows`), con un cliente y un conductor
  sintéticos que borra al terminar. Recorre:
  - activar, con el secreto cifrado;
  - el cierre de las demás sesiones y los avisos por push y email;
  - el ingreso con desafío, que el desafío no sirva como token de acceso, y la renovación
    sin volver a pedir el código;
  - la sesión sin marca que no se renueva;
  - la reutilización de un código TOTP;
  - eliminar la cuenta sin código (403 `mfaRequired`), y que con la contraseña equivocada el
    código no se gaste;
  - regenerar códigos, que los anteriores dejen de servir, y desactivar;
  - el bloqueo tras cinco códigos inválidos.

  No se pudo correr en local, porque no hay credenciales de la base local; corre en el CI.
- `npm run test:account-mfa-contract` (en `ci-fast`) vigila el cableado que esa prueba no ve:
  - el panel en las cuentas de cliente, conductor y comercio, en la web y en el teléfono;
  - el paso del código en el ingreso móvil;
  - el código en eliminar la cuenta, retirar y desvincular;
  - el 403 dentro de una sesión.

  Si falla, alguna de esas piezas se desconectó. Cada aserción se falsificó: falla cuando se
  rompe lo que vigila.
- `npm run test:mfa` sigue cubriendo el caso administrativo.

## Brechas

- **No hay código por SMS ni llaves de acceso (passkeys).** El SMS necesita un proveedor
  (dueño). Las passkeys (WebAuthn) son el siguiente paso de SEG-08.
- **No hay aviso de ingreso desde un dispositivo nuevo** aparte del pedido del código.
- **Si se pierden el teléfono y los códigos**, la recuperación es por soporte, como en Uber.
