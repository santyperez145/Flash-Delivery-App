# Operación local verificable

## Métricas

`GET /api/internal/metrics` expone formato Prometheus y exige un bearer token
independiente configurado en `METRICS_TOKEN`. Un JWT de usuario o administrador
no sirve como token de scraping. Producción rechaza el arranque con el valor por
defecto.

Se publican contadores y duración HTTP con rutas normalizadas, estado del pool
PostgreSQL, jobs activos por vertical, tickets abiertos, payment intents y notificaciones por
estado. No se incluyen emails, direcciones, IDs de clientes ni cuerpos privados.

## Renovación OAuth de comercios

```bash
npm run worker:payment-oauth
```

El proceso renueva conexiones Mercado Pago que vencen dentro de treinta días y
rota access y refresh token cifrados. Usa locks por lote para permitir varias
réplicas, recupera trabajos abandonados a los diez minutos y deja de reintentar
automáticamente después de cinco fallos. Debe ejecutarse como worker continuo o
job programado, con alerta sobre `refresh_failures`; el portal indica al comercio
que debe reconectar cuando se agota el presupuesto. Ni tokens ni respuestas del
proveedor se escriben en logs.

También se exponen `flash_realtime_connections` por instancia y
`flash_realtime_events_retained`. La limpieza del event log se programa con
`npm run realtime:prune`; sus límites están en `REALTIME_RETENTION_DAYS` y
`REALTIME_MAX_ROWS`.

La duración HTTP se publica como histograma acumulativo en
`flash_http_request_duration_seconds_bucket`, con método, ruta normalizada y
status; nunca usa IDs o datos personales como labels. `npm run test:performance`
ejecuta una carga concurrente acotada sobre readiness, catálogo, estado
autenticado y cotizaciones PostGIS, con p95 local máximo de 500 ms. La metodología
y los límites de esta evidencia están en `docs/performance.md`.

## Worker de notificaciones

```bash
npm run worker:notifications
```

Pedidos, viajes, envíos y cancelaciones insertan el evento de salida dentro de
la misma transacción PostgreSQL que modifica el servicio. El worker reclama lotes
con `FOR UPDATE SKIP LOCKED`, lease de cinco minutos, deduplicación y hasta tres
intentos. En desarrollo `NOTIFICATION_PROVIDER=sandbox` registra entregas reales
en `notification_deliveries` sin contactar FCM/APNs; producción rechaza este
adaptador y requiere configurar un proveedor externo antes de arrancar.

Los dispositivos se registran por `/api/devices`; la respuesta nunca devuelve el
push token. PostgreSQL conserva sólo un sobre AES-256-GCM y un HMAC para
deduplicación; la clave `PUSH_TOKEN_ENCRYPTION_KEY` es obligatoria y debe vivir en
el secret manager productivo. Revocar un dispositivo invalida futuras entregas y
RLS impide que un cliente consulte dispositivos de otra cuenta. Registros legacy
se convierten transaccionalmente con `npm run devices:encrypt`.

Un rechazo permanente del proveedor (por ejemplo `unregistered`) revoca el
dispositivo, conserva el motivo no sensible y evita nuevos intentos sobre ese
token. Si no queda ningún destino válido, o un correo supera tres intentos, la
notificación pasa a `dead_lettered`. Operaciones puede consultar la cola en
`GET /api/admin/notifications/dead-letters` y solicitar replay por
`POST /api/admin/notifications/dead-letters/:notificationId/replay`. El replay
push se rechaza hasta que exista un dispositivo activo nuevo, es idempotente y
queda atribuido en auditoría. La consola Infra expone estas acciones sin mostrar
payloads, tokens, sobres cifrados ni fingerprints.

`npm run test:notification-dead-letters` verifica revocación por token inválido,
dead-letter, autorización administrativa, replay seguro e idempotente y entrega
posterior con un dispositivo válido. En sandbox, sólo los tokens con prefijo
`sandbox-invalid:` simulan el rechazo permanente; no se afirma conectividad real
con FCM/APNs.

La puerta `npm run test:sensitive-data` inspecciona el esquema y los datos
persistidos: prohíbe columnas PAN/CVV/OTP/refresh token, exige hashes para claves,
sesiones y PIN de entrega, exige cero push tokens en texto plano y revisa payloads
de auditoría, notificaciones, pagos e idempotencia buscando claves sensibles.

## Auditoría append-only

`audit_events` es inmutable a nivel PostgreSQL, no sólo por convención de API. El
rol `flash_runtime` conserva `INSERT` y `SELECT`, pero tiene revocados `UPDATE`,
`DELETE` y `TRUNCATE`. Un trigger rechaza además cambios directos del propietario
del esquema salvo cuando la conexión propietaria arranca con
`app.audit_maintenance=on`.

Ese contexto se agrega únicamente a `createPool()` cuando existe
`MIGRATION_DATABASE_URL`; se usa para migraciones y para eliminar fixtures exactos
de las suites locales. La API nunca usa esa URL ni recibe la marca de
mantenimiento. `flash_rls_audit` queda estrictamente read-only.

La puerta dedicada se ejecuta con:

```bash
npm run test:audit-immutability
```

La prueba demuestra inserción desde runtime y rechazo físico de update, delete y
truncate; también prueba que el propietario sin contexto sigue bloqueado y que
la limpieza seleccionada funciona sólo mediante la conexión de mantenimiento.

Cada evento lleva además `previous_hash` y `event_hash`. Un trigger de inserción
adquiere un advisory lock global, toma el hash anterior y calcula SHA-256 sobre
una representación canónica de actor, roles, acción, entidad, request, metadatos,
payloads y fecha. Así, cambiar cualquier evento o alterar el orden invalida ese
evento y el resto de la cadena.

`app.audit_chain_invalid_count()` permite al rol auditor verificar integridad sin
obtener permisos de escritura. La función y el trigger son `SECURITY DEFINER`
con `search_path` fijo; la función hash interna no es ejecutable por runtime ni
por `PUBLIC`. Las eliminaciones de fixtures bajo mantenimiento toman el mismo
lock y reconstruyen la cadena antes de confirmar la transacción.

El restore drill exige simultáneamente `AuditAppendOnly: true` y
`AuditChainInvalid: 0`; un dump legible pero con auditoría alterada no se acepta
como recuperación válida.

`DELIVERY_PIN_SECRET` debe ser independiente del JWT y de la clave de push. Los
PIN de envíos no se almacenan en claro, ni siquiera en respuestas idempotentes.
Cinco intentos fallidos bloquean la prueba de entrega durante 15 minutos y la
API agrega un rate limit específico. La rotación de esta clave requiere una
ventana operacional porque cambia el código derivado de envíos todavía activos.

## Dispatch

El alta de un servicio crea ofertas privadas para hasta tres conductores mediante
distancia PostGIS, rating, antigüedad de ubicación y carga activa. El conductor
consulta únicamente sus ofertas vigentes en `GET /api/driver/offers`. La
aceptación bloquea la oferta y el job en una transacción: sólo una solicitud
concurrente puede ganar, las demás reciben conflicto y el resto de ofertas se
retira. Las cancelaciones retiran ofertas pendientes y una lectura convierte las
vencidas en `expired`.

Un driver online sólo es candidato si tiene vehículo activo/aprobado compatible,
su último GPS tiene menos de diez minutos y la precisión declarada no supera 200
metros. La fuente (`foreground`, `background` o legacy), precisión y fecha quedan
en la fila operativa del conductor; las coordenadas precisas no se duplican en
auditoría append-only.

Prometheus publica `flash_dispatch_offers{status=...}`. El scheduler se ejecuta con:

```bash
npm run worker:dispatch
```

El worker de soporte distribuye tickets sin asignar según skill/capacidad y
registra escalaciones de SLA de forma idempotente:

```bash
npm run worker:support
```

Cada lote usa `FOR UPDATE SKIP LOCKED`, expira ofertas vencidas y abre una nueva
oleada únicamente para conductores que todavía no recibieron ese servicio. Si no
hay candidatos nuevos, guarda el próximo intento con backoff de cinco minutos.
Cada oferta genera además una notificación transaccional para el conductor sin
incluir identidad, teléfono ni dirección del cliente en el payload push.

Las apps consultan exclusivamente `GET /api/driver/offers` cada cinco segundos;
ya no construyen ofertas a partir del estado global. La tarjeta muestra vencimiento
en tiempo real, tarifa, trayecto y distancia. Aceptar o rechazar vuelve a cargar
la bandeja y el backend resuelve carreras concurrentes con respuesta `409`.

## Finanzas de comercios

Al completar una orden de comida cobrada, el backend liquida en una única
transacción PostgreSQL el neto del comercio, la tarifa del conductor y el ingreso
de plataforma. Cada asiento usa centavos enteros, debe balancear débitos y
créditos y es idempotente por orden. El comercio sólo puede consultar sus propias
cuentas y reservar un retiro con `Idempotency-Key`; esa reserva mueve el saldo
desde `payable` a `payout_pending` sin afirmar que ya hubo transferencia bancaria.

Prometheus expone exclusivamente agregados sin PII mediante
`flash_payouts{status=...}` y `flash_merchant_payable_cents`. La conciliación con
un PSP/adquirente y el adaptador bancario de payouts siguen siendo requisitos de
producción pendientes.

Las propinas se observan mediante `flash_service_tips_total` y
`flash_service_tips_cents`. Son transferencias directas entre Wallets y no forman
parte del ingreso de plataforma; la tabla y ambos asientos permanecen vinculados
al job y a una clave idempotente.

## Backup local

```bash
npm run db:backup
npm run db:backup:verify
```

El backup usa formato custom de PostgreSQL, `--no-owner`, compresión
y archivo temporal antes del movimiento final. Junto al `.dump` se guarda un
manifiesto con SHA-256, tamaño, base y fecha UTC. Los archivos viven fuera de Git
en `%LOCALAPPDATA%\FlashDelivery\backups`.

El dump conserva las ACL de tablas/columnas y las default privileges, pero no
incluye definiciones de roles, contraseñas ni ownership. Esto permite recuperar
los permisos de `flash_runtime` y `flash_rls_audit` después de precrear roles
vacíos en el ambiente destino.

La verificación recalcula el checksum, exige un manifiesto que confirme ACL,
lee el catálogo con `pg_restore`, exige tablas críticas y extrae por completo
el esquema a un archivo temporal. No toca la base activa.

El simulacro completo se ejecuta con:

```bash
npm run db:restore:drill
```

Levanta un cluster PostgreSQL efímero enlazado únicamente a `127.0.0.1` en un
puerto aleatorio, precrea roles sin privilegios, restaura el dump y valida:
checksum, 41 migraciones, PostGIS, tablas/datos críticos, constraints, RLS,
aislamiento del auditor, protección de secretos MFA y balance de cada transacción
del ledger. Finalmente detiene y elimina sólo el cluster temporal verificado;
la base activa nunca recibe conexiones ni escrituras del drill. `-KeepFailed`
permite preservar un ensayo fallido para diagnóstico.

En infraestructura administrada debe reproducirse el mismo procedimiento en una
cuenta/proyecto aislado usando un rol operacional temporal con `CREATEDB`, nunca
otorgando ese privilegio a `flash_app` ni `flash_runtime`.

## Requisitos productivos pendientes

- PostgreSQL administrado con PITR, retención y réplica/HA.
- Restore periódico automatizado en una cuenta/proyecto administrado aislado.
- Secret manager y rotación de `METRICS_TOKEN`, JWT y webhooks.
- Recolección Prometheus/OpenTelemetry y alertas con SLO definidos.
- Adaptadores FCM/APNs y credenciales en secret manager.
- Las trazas OTLP y los SLO operativos se documentan en `docs/observability.md`; `test:telemetry` verifica una exportación protobuf real.
