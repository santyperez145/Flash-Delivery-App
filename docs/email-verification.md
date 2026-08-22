# Verificación de email

Las cuentas nuevas no reciben access token ni refresh token hasta confirmar el email. Las cuentas existentes se marcaron verificadas durante la migración 52 para conservar la operación.

- OTP numérico de seis dígitos, diez minutos de vigencia y máximo cinco intentos.
- PostgreSQL conserva bcrypt; el rol auditor no puede leer el hash.
- El código viaja por el outbox SMTP en un envelope AES-256-GCM inaccesible al inbox.
- Reenviar invalida el desafío anterior y responde de forma genérica si la cuenta no existe o ya fue verificada.
- Confirmar consume el OTP, fija `email_verified_at` y habilita login; un replay se rechaza.
- Mobile incluye estado dedicado, autocompletado sandbox, reenvío y retorno a otra cuenta.

Validación: `npm run test:email-verification`.
