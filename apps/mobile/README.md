# Flash Mobile Apps

Base Expo/React Native para las apps reales de cliente, comercio y driver.

## Objetivo

Esta carpeta inicia la migracion desde PWA mobile hacia apps nativas publicables. La primera version consume el mismo backend Express:

- Cliente: restaurantes, metricas, Flash Pass y actividad viva.
- Comercio: estado del local, ETA y pedidos activos.
- Driver: disponibilidad, modo delivery/taxi, ofertas y trabajos activos.

## Ejecutar

Desde `apps/mobile`:

```bash
npm install
EXPO_PUBLIC_API_URL=http://TU_IP_LAN:4000/api npm run start
```

En simulador local puede funcionar `http://127.0.0.1:4000/api`. En telefono fisico usa la IP LAN de la PC.

## Versiones base

- Expo SDK 57.
- React 19.2.
- React Native 0.86.

## Siguientes pasos mobile

- Separar builds por app: cliente, comercio y driver.
- Agregar navegacion nativa.
- Agregar mapas, geolocalizacion foreground/background y permisos por rol.
- Agregar push notifications para ofertas, cambios de estado y soporte.
- Agregar secure storage para tokens y refresh tokens.
- Agregar EAS Build, EAS Update y crash reporting.

## Nota de seguridad

`npm audit` puede reportar vulnerabilidades transitivas de Metro/Expo en SDK 57. Al 14 de agosto de 2026, `npm audit fix --force` propone bajar a Expo SDK 53, lo cual es un cambio mayor no aceptable para esta base. Mantener SDK 57, seguir releases de Expo y actualizar cuando el fix upstream este disponible.
