# Dónde se despliega Flash

Decidido el **28 de agosto de 2026**. Sustituye la ausencia de decisión que mantenía en cero
las columnas `PROV`, `STG` y `PROD` de [`docs/matriz-madurez.md`](matriz-madurez.md).

> **Nada de esto está ejecutado todavía.** No hay cuenta de nube ni proyecto creado. Este
> documento es la decisión y su plan; cada comando de acá abajo está sin correr, y se marca
> como tal hasta que alguien lo ejecute y anote el resultado. Un runbook que aparenta haber
> funcionado es peor que no tenerlo.

> **Versión para compartir:** [`docs/despliegue.html`](despliegue.html) es el mismo contenido
> como página autónoma, servible desde GitHub Pages en la cuenta del proyecto. Se actualiza a
> mano junto con este documento; si alguna vez divergen, **manda este archivo**, que es el que
> pasa por revisión.

## La decisión

**Google Cloud, región `southamerica-east1` (São Paulo).**

La región se decide antes que el proveedor. Buenos Aires ↔ São Paulo son ~30 ms; Buenos
Aires ↔ Virginia son ~120 ms. En un producto donde la asignación de conductor es el
producto, esos 90 ms se pagan en cada cotización, cada oferta y cada punto de tracking. Es
la única variable de infraestructura que no se corrige después con más plata: cambiar de
región es migrar la base.

Sobre esa restricción, el proveedor se elige por lo que el proyecto ya exige.

## Lo que el código exige, verificado

No son preferencias. Cada punto sale de leer el repositorio, y cada uno descarta opciones.

| Exigencia | Dónde está en el código | Qué descarta |
| --- | --- | --- |
| **PostGIS**, no PostgreSQL a secas | `docker-compose.yml` usa `postgis/postgis:17-3.5` | Todo Postgres gestionado sin la extensión |
| **`LISTEN/NOTIFY`** en conexión dedicada | `server/realtime-repository.js` hace `LISTEN flash_realtime` | Cualquier pooler en **modo transacción**: el endpoint *pooled* de Neon, Supavisor por omisión |
| **SSE de larga duración** | `server/http/realtime.js` responde `text/event-stream` con heartbeat | Funciones serverless con duración máxima corta: Vercel, Netlify |
| **Redis** con readiness bloqueante | `REDIS_REQUIRED` en `server/config.js` | Nada, pero hay que proveerlo |
| **~20 secretos de producción** | `server/config.js` los exige uno por uno al arrancar | Pegarlos a mano en un panel |
| **Contenedor endurecido** | El job `container-image` lo construye y verifica en cada PR | Plataformas que sólo aceptan buildpacks |
| **Planificador externo** | `worker:dispatch` y `job:payment-reconciliation` no traen el suyo | Plataformas sin cron de verdad |
| **Tres roles de base separados** | `flash_app`, `flash_runtime`, `flash_rls_audit` | Bases gestionadas que no dejan crear roles |

## El mapeo

| Necesidad | Servicio | Nota |
| --- | --- | --- |
| API | **Cloud Run** | Corre la imagen que CI ya valida. Sin Kubernetes, que [la auditoría descartó](auditoria-2026-08-25.md) para esta etapa |
| Base | **Cloud SQL para PostgreSQL 17** + extensión PostGIS | Con PITR, que es lo que cubre el RPO ≤ 15 min del [checklist](deployment-checklist.md) |
| Redis | **Memorystore** | |
| Trabajos programados | **Cloud Run Jobs + Cloud Scheduler** | Calza exacto con la política de «el planificador es del entorno» |
| Secretos | **Secret Manager** | Montados en Cloud Run, nunca en variables del panel |
| PWA web | **Cloud Storage + Cloud CDN** | Es un build estático de Vite |
| Imágenes | **Artifact Registry** | La imagen sale de CI, no de una build local |
| Observabilidad | **Cloud Trace / Monitoring** | El exportador OTLP ya existe; no hay que tocar código |

## Las tres trampas

Salen del código de este proyecto, no de un manual. Las tres tienen la misma forma: **algo
que sigue respondiendo y ya no funciona**, que es el modo de falla que más caro salió en
este repositorio.

### 1. Cloud Run tiene que tener instancia mínima y CPU siempre asignada

`server/realtime-repository.js` mantiene un `LISTEN flash_realtime` sobre una conexión
dedicada. Si la instancia se duerme o le estrangulan la CPU entre peticiones, ese socket
muere: la instancia sigue viva, sigue aceptando clientes SSE, y **no entrega ni un evento**.

    --min-instances=1 --cpu-throttling=false

Desde el 28 de agosto `/api/ready` observa el escucha y saca la instancia del balanceador si
no logra suscribirse durante medio minuto. Eso convierte la trampa en una falla ruidosa,
pero **no la evita**: sin instancia mínima, la configuración correcta sigue siendo esta.

### 2. Conexión directa a la base, nunca un pooler en modo transacción

`LISTEN/NOTIFY` no sobrevive a PgBouncer ni a Supavisor en *transaction mode*: la suscripción
se pierde en cuanto la transacción termina. Es el error más caro de esta lista porque
**parece funcionar** — las consultas normales andan perfecto, y lo único que falla es el
realtime, en silencio.

El corte de readiness lo detecta: si la conexión no puede suscribirse nunca,
`failedAttempts` crece sin techo y la instancia se declara no lista.

### 3. El timeout de petición tiene que subir por el SSE

Cloud Run corta a los 5 minutos por omisión y admite hasta 60. El heartbeat y el replay de
SSE hacen que la reconexión sea limpia, pero cortarles la conexión a todos los clientes cada
cinco minutos es ruido evitable.

    --timeout=3600

## Lo que se descartó, y por qué

- **Vercel / Netlify.** Las funciones serverless no sostienen ni la conexión SSE ni el socket
  de `LISTEN`. Habría que reescribir la capa de realtime entera para adoptarlas.
- **Render / Railway.** No tienen región en Sudamérica. Son los 120 ms, permanentes.
- **Fly.io `gru`.** La mejor latencia y nativo en contenedores. Su Postgres fue históricamente
  no gestionado, y para una empresa cuyo propio checklist exige RTO ≤ 60 min con restore
  drill cronometrado, operar el HA propio hoy es un pasivo. Vale revisarlo si la latencia se
  vuelve la restricción que manda.
- **AWS `sa-east-1`.** No es un error: App Runner o Fargate, RDS con PostGIS, ElastiCache y
  EventBridge Scheduler cubren lo mismo. Elegirlo tiene sentido con créditos de AWS o con
  gente que ya tenga ese oficio. Técnicamente equivalente, más trabajo de operación y más
  caro en esta etapa.

## El costo, sin maquillar

Lo que empuja la factura no es el tráfico: es el estándar que el propio proyecto se puso. La
instancia mínima siempre encendida, la alta disponibilidad de Cloud SQL y el PITR son el
grueso. Presupuestar el orden de unos pocos cientos de dólares al mes para una beta cerrada.

Bajarlo significa renunciar al RTO/RPO que [`docs/deployment-checklist.md`](deployment-checklist.md)
ya declaró bloqueante. Es una decisión de negocio, no técnica, y conviene tomarla explícita
en vez de descubrirla el día del primer incidente.

## Staging: el primer despliegue real, antes de tener las cuentas de terceros

Decisión del dueño del 19 de noviembre de 2026: **primero un staging en Google Cloud, sin
dominio**, con la URL que da Cloud Run. Sirve para probar todo con una base real en la nube
mientras se consiguen Mercado Pago, Google Maps, email, SMS, push, el dominio y los textos
legales.

**Qué es igual que producción.** `NODE_ENV=production`: secretos propios (el servidor no
arranca con un valor local), cookies seguras, HTTPS, RLS sin bypass, rol de runtime sin
privilegios, segundo factor obligatorio para operaciones, la misma imagen y las mismas
migraciones. **Qué cambia** (`DEPLOY_STAGE=staging`, en `server/config.js`):

- **Proveedores de prueba** donde todavía no hay cuenta: mapas de OpenStreetMap, email, SMS
  y push en modo sandbox, Mercado Pago apagado. Producción los sigue rechazando.
- **Direcciones** sin el proveedor comercial de mapas, y **pagos de prueba** (Wallet y
  medios de pago sandbox). En producción, nunca.
- **Documentos legales:** pueden faltar; si están, tienen que ser HTTPS.
- **Códigos de verificación:** sin SMTP ni SMS no llegan por ningún lado. Se pueden mostrar
  en pantalla con `staging_expose_dev_codes = true`, **a propósito y por poco tiempo**:
  mientras esté prendido, quien tenga la URL puede crear cuentas con emails ajenos. Lo
  correcto es cargar un SMTP (aunque sea uno gratuito) y dejarlo apagado.
- **Infraestructura más chica:** Cloud SQL zonal (sin conmutación por falla de zona) y Redis
  básico. Los backups y el PITR quedan. Los cinco workers y la API siguen con una instancia
  siempre viva, porque el despacho y el realtime lo necesitan.

`npm run test:staging-config` (en `ci-fast`) prueba la configuración en procesos aparte:
producción con proveedores de prueba no arranca, staging sí, staging sin un secreto propio
o sin el segundo factor de operaciones no arranca, y los códigos sólo se muestran si se
pide. Si falla, staging dejó de parecerse a producción o producción aflojó un control.

### Lo que hace el dueño

1. Crear el proyecto de Google Cloud **con la facturación activada**.
2. Instalar la herramienta: `winget install Google.CloudSDK`.
3. Iniciar sesión (la contraseña la escribe el dueño):
   `gcloud auth login` y `gcloud auth application-default login`.
4. Pasar el *project ID*.

### Lo que hace el equipo, con el OK del dueño antes de crear recursos pagos

1. La URL de staging se conoce antes de desplegar: `https://flash-api-<número del
   proyecto>.southamerica-east1.run.app` (el número sale de `gcloud projects describe`). La
   misma API sirve la web, así que es una sola URL para todo.
2. `staging.tfvars` (no se versiona), con `deploy_stage = "staging"` y esa URL en
   `app_public_url`, `api_public_url` y `cors_origins`.
3. Seguir los pasos de [`infra/gcp/README.md`](../infra/gcp/README.md): bucket del estado,
   primera aplicación, secretos propios (en staging no hace falta cargar los de terceros),
   roles, PostGIS y migraciones **sin semillas**, imagen, segunda aplicación.
4. Verificar `/api/ready`, crear una cuenta real, y que un pedido reciba oferta sin que nadie
   toque nada.

## Pasos, en orden

Ninguno ejecutado. Cada uno se marca al correrlo, con la fecha. **Desde el 18 de noviembre
de 2026 están escritos en Terraform** ([`infra/gcp`](../infra/gcp/README.md)) y CI los valida en
cada PR: lo que falta es la cuenta, no la infraestructura.

- [ ] Proyecto de GCP y facturación, región por omisión `southamerica-east1`.
- [ ] Artifact Registry, y que CI publique ahí la imagen que ya construye.
- [ ] Cloud SQL PostgreSQL 17 con PostGIS, HA y PITR. Crear los tres roles.
- [ ] Memorystore para Redis.
- [ ] Los ~20 secretos en Secret Manager. Ninguno en el panel de Cloud Run.
- [ ] Cloud Run con `--min-instances=1 --cpu-throttling=false --timeout=3600`.
- [ ] Los workers como servicios de Cloud Run con instancia mínima, y `job:payment-reconciliation` como Cloud Run Job con Cloud
      Scheduler disparándolos. **Verificar que un pedido pagado reciba oferta sin que nadie
      toque nada** — es la prueba de que el cron sirve, no de que existe.
- [ ] Restore drill cronometrado contra el RTO de 60 minutos.
- [ ] Dominio, TLS y CDN para la PWA.
- [ ] `/api/ready` verde con `realtime.listening` en `true`.
