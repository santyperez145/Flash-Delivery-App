# Flash Mobile Apps

Las variantes Customer, Driver y Merchant se generan con identidades, schemes, perfiles EAS y permisos diferentes. Ver `../../docs/mobile-build-variants.md`.

Base Expo/React Native para las apps reales de cliente, comercio y driver.

## Objetivo

Esta carpeta inicia la migracion desde PWA mobile hacia apps nativas publicables. La primera version consume el mismo backend Express:

- Cliente: restaurantes, carrito, pedidos, cancelaciones, cotizacion de taxi, solicitud de viaje y seguimiento.
- Comercio: estado del local, ETA, pedidos activos, avance de cocina, stock y alta de productos.
- Driver: disponibilidad, modo delivery/taxi, ofertas, trabajos activos y tracking foreground con `expo-location`.

## Ejecutar

Desde `apps/mobile`:

```bash
npm install
EXPO_PUBLIC_API_URL=http://TU_IP_LAN:4000/api npm run start
```

En simulador local puede funcionar `http://127.0.0.1:4000/api`. En telefono fisico usa la IP LAN de la PC.

## Versiones base

- Expo SDK 57.
- `expo-location` 19.0.8 para permisos foreground y actualizacion de posicion del driver.
- `react-native-web` 0.21.2 y `react-dom` 19.2.3 para el preview web.
- React 19.2.
- React Native 0.86.

## Siguientes pasos mobile

- Separar builds por app: cliente, comercio y driver.
- Agregar navegacion nativa.
- [x] Geolocalización background controlada para driver, con permisos nativos, foreground service y detención al quedar offline/logout.
- Agregar push notifications para ofertas, cambios de estado y soporte.
- [x] SecureStore nativo para access/refresh tokens; fallback web explícito y migración automática de la sesión legacy.
- Agregar EAS Build, EAS Update y crash reporting.

## Flujos persistentes disponibles

La app Expo consume endpoints autenticados del mismo backend Express, no fixtures locales:

- `POST /orders` para confirmar comida con validacion de stock y totales en servidor.
- `POST /rides/options` y `POST /rides` para cotizar categorías con token firmado y solicitar taxi de forma idempotente.
- `PATCH /orders/:id/status` y `PATCH /rides/:id/status` para cancelaciones del cliente.
- `PATCH /restaurants/:id`, `PATCH /restaurants/:id/menu/:itemId` y `POST /restaurants/:id/menu` para comercio.
- `PATCH /drivers/:id/availability`, `PATCH /drivers/:id/location` y endpoints de aceptacion/avance para driver.

## Nota de seguridad

`npm audit` puede reportar vulnerabilidades transitivas de Metro/Expo en SDK 57. Al 14 de agosto de 2026, `npm audit fix --force` propone bajar a Expo SDK 53, lo cual es un cambio mayor no aceptable para esta base. Mantener SDK 57, seguir releases de Expo y actualizar cuando el fix upstream este disponible.
