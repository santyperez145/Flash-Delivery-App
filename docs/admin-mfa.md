# MFA administrativo

Flash protege las cuentas `admin` con TOTP compatible con aplicaciones autenticadoras. La contraseña no alcanza para emitir una sesión privilegiada cuando MFA está activo: `/api/auth/login` devuelve un desafío JWT de cinco minutos y `/api/auth/mfa/complete` emite el access token y refresh token sólo después de verificar el segundo factor.

## Flujo

1. Un administrador autenticado inicia `/api/auth/mfa/enroll`.
2. La API devuelve una vez el secreto/URI `otpauth` y ocho códigos de recuperación.
3. `/api/auth/mfa/confirm` exige un TOTP válido antes de activar MFA y emite una sesión elevada.
4. Los login posteriores requieren TOTP o un código de recuperación mediante `/api/auth/mfa/complete`.
5. Cada código de recuperación se elimina al usarlo. Cinco fallos bloquean la verificación durante quince minutos.

El secreto TOTP se cifra con AES-256-GCM y AAD usando `MFA_ENCRYPTION_KEY`; los códigos de recuperación se guardan únicamente como hashes bcrypt. El rol auditor puede leer estado, fecha de confirmación y bloqueo, pero PostgreSQL le niega las columnas secretas. En producción la API no inicia con la clave local por defecto.

Producción exige además `REQUIRE_ADMIN_MFA=true`. Una cuenta todavía no enrolada puede iniciar sesión únicamente para llamar a los endpoints de enrolamiento/confirmación; el middleware niega el resto de las rutas administrativas hasta recibir un access token elevado. En desarrollo queda en `false` para facilitar fixtures y debe activarse al ensayar la política productiva.

El portal web incluye una sección **Seguridad** que consulta el estado real, genera el QR `otpauth`, muestra ocho códigos sólo en memoria y permite copiarlos o descargarlos antes de confirmar el TOTP. La pantalla de login detecta `mfaRequired` y presenta el paso de código. El smoke reproducible `npm run test:mfa` prueba cifrado en reposo, activación, pérdida de privilegios del token anterior, desafío de login, consumo único del código de recuperación y acceso final al dashboard; restaura el fixture al terminar.
