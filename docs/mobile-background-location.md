# Ubicación background del conductor

La app nativa registra `flash-driver-background-location-v1` en scope global con
Expo TaskManager. Al ponerse online solicita primero permiso foreground y luego
background; al ponerse offline o cerrar sesión detiene explícitamente la tarea.
Web conserva seguimiento foreground y lo comunica como capacidad limitada.

Android utiliza un foreground service con notificación persistente. iOS habilita
`UIBackgroundModes/location` mediante el plugin de `expo-location`. Estas
capacidades requieren un development build o binario EAS; Expo Go no ejecuta
ubicación background de forma completa. Referencias oficiales:
[Expo Location](https://docs.expo.dev/versions/latest/sdk/location/) y
[Expo TaskManager](https://docs.expo.dev/versions/latest/sdk/task-manager/).

Cada fix atribuye `source=background`, precisión y fecha. PostgreSQL conserva el
último punto, no una animación inventada. Dispatch descarta posiciones mayores a
diez minutos y fixes con precisión declarada peor a 200 metros. La misma regla se
evalúa aunque el flag `online` haya quedado activo.

La tarea puede renovar una sesión vencida. Access y refresh token viven en
SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) sobre Keychain/Keystore; el fallback
AsyncStorage está aislado a web. Logout elimina la sesión y detiene tracking.
Coordenadas precisas no se copian al audit log append-only; la migración 090
redactó eventos históricos y reconstruyó/verificó la cadena hash.

Verificación disponible:

- `npm run test:mobile-native-runtime`
- `npm run test:driver-vehicles`
- `npm run test:sensitive-data`
- `npm --prefix apps/mobile run typecheck`
- `npx expo-doctor` dentro de `apps/mobile` (21/21 controles)
- `npx expo export --platform all` para bundles web, iOS y Android

## Deuda antes de distribución pública

El audit de dependencias del 15 de agosto de 2026 informa 20 advisories
transitivos (0 críticos, 12 altos, 8 moderados) en Expo CLI/Metro/React Native.
La corrección automática propuesta baja a Expo 53/React Native 0.72 y rompe la
matriz SDK 57, por lo que no se aplicó `npm audit fix --force`. Debe repetirse el
audit al publicar el próximo parche compatible del SDK y bloquear el release si
queda un advisory explotable dentro del binario, no sólo del toolchain de build.
