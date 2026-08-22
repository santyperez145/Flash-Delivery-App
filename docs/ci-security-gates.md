# Puertas CI de seguridad

CI ejecuta build/smoke, typecheck mobile, `test:secrets` y `test:dependency-gate`.

El escáner revisa archivos tracked y nuevos no ignorados buscando claves privadas y formatos de credenciales AWS, GitHub, Slack, Stripe live y Google. No imprime secretos, sólo ruta, línea y tipo.

El audit de dependencias bloquea vulnerabilidades **altas o críticas** en runtime web/API y mobile. Al 22-08-2026 ambos árboles reportan cero vulnerabilidades conocidas. Mobile fija parches compatibles de Metro y reemplaza las versiones transitivas vulnerables de `image-size` y `uuid` mediante `overrides`; TypeScript, configuración Expo y bundles web/iOS/Android forman parte de la verificación antes de conservar esos overrides.
