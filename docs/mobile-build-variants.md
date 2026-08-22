# Variantes mobile

`apps/mobile/app.config.js` genera tres aplicaciones con identidad independiente:

- Flash Customer: `app.flash.customer`, scheme `flash`.
- Flash Driver: `app.flash.driver`, scheme `flash-driver`.
- Flash Negocios: `app.flash.merchant`, scheme `flash-merchant`.

`eas.json` define development, preview y production por variante. El valor `EXPO_PUBLIC_APP_VARIANT` queda fijado en cada perfil y la sesión se valida contra ese rol tanto al iniciar sesión como al restaurarla.

Sólo Flash Driver declara `ACCESS_BACKGROUND_LOCATION`, foreground service y background mode iOS. Customer conserva ubicación foreground para origen/destino; Merchant no obtiene privilegios de conductor. El superadmin permanece exclusivamente web.

Los perfiles están listos para configuración, pero no se presentan como builds publicables hasta asociar proyecto EAS, credenciales Apple/Google, API productiva y ejecutar pruebas físicas.
