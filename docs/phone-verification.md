# Verificación de teléfono

Flash asocia un teléfono E.164 con una cuenta autenticada mediante un OTP de seis
dígitos. El desafío dura diez minutos, admite cinco intentos y no puede reenviarse
durante los primeros 30 segundos. Cambiar el teléfono invalida automáticamente
`phone_verified_at`; un número verificado sólo puede pertenecer a una cuenta.

## Arquitectura y lanzamiento

- Producción exige Twilio Verify por configuración y falla al arrancar sin sus
  tres credenciales. Twilio conserva y valida el OTP; Flash persiste referencia,
  expiración, intentos y auditoría, nunca el código.
- Desarrollo usa un proveedor `sandbox` explícito: el OTP sólo se devuelve fuera
  de producción y PostgreSQL guarda bcrypt. `disabled` degrada con `503`.
- La llamada al proveedor usa timeout de cinco segundos, credenciales Basic sobre
  TLS y media type estándar. Errores de cuota se traducen a `429`; fallas externas
  a `502` sin filtrar payloads del proveedor.
- La activación comercial requiere credenciales, permisos geográficos, presupuesto
  y una prueba física de entrega SMS; hasta entonces el roadmap permanece parcial.
- Mobile muestra el teléfono completo durante enrolamiento para detectar errores,
  usa autofill OTP nativo, contador de reenvío, estado verificado y explica que un
  cambio de número invalida la prueba. El código sandbox sólo se autocompleta en
  builds no productivas.

## Referencias competitivas y técnicas

- Uber solicita códigos por SMS o llamada y puede volver a exigir verificación de
  teléfono por seguridad: https://help.uber.com/en/riders/article/troubleshooting-tips-for-2-step-verification?nodeId=bda9eae2-b394-4224-8090-06802a45bef2
- Twilio recomienda verificar cada contacto nuevo, OTP con vencimiento de diez
  minutos, retry buffer inicial de 30 segundos y límites por destino:
  https://www.twilio.com/docs/verify/developer-best-practices

Validación automatizada PostgreSQL: `npm run test:phone-verification`.
