# Referidos

El programa de referidos opera en PostgreSQL y no acredita saldo por instalar o registrar una cuenta. Cada usuario autenticado obtiene un código estable `FLASH…`; una cuenta nueva puede atribuirse una sola vez, nunca a sí misma y sólo antes de completar su primer servicio.

La recompensa se liquida al detectar el primer job `completed` con un `payment_intent` todavía `captured`. La transacción bloquea la atribución, crea dos movimientos `referral_reward` idempotentes y balanceados contra `cash_clearing`, acredita $2.500 al promotor y $1.500 a la amistad según la campaña beta, y enlaza el job que calificó. Releer el resumen no duplica créditos.

`GET /api/referrals/me` devuelve código, términos vigentes, métricas y atribución propia. `POST /api/referrals/claim` valida el código en servidor. RLS limita códigos y atribuciones a sus participantes o administración; la interfaz móvil sólo presenta las decisiones del backend.

La campaña y sus importes son datos versionables en `referral_campaigns`. Antes de producción deben incorporarse gestión administrativa con cuatro ojos, señales de dispositivo/medio de pago y límites por hogar para complementar los controles actuales de identidad, auto-referido, unicidad y primer servicio.
