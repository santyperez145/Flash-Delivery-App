# Infraestructura de Flash en GCP

El mapeo de [`docs/despliegue.md`](../../docs/despliegue.md) escrito en Terraform. CI lo
valida en cada PR (job «Infraestructura (Terraform)» de `ci-fast`). El día que exista la
cuenta, desplegar es seguir estos pasos, no escribir la infraestructura.

**Ninguno de estos pasos se ejecutó todavía:** no hay cuenta de GCP. Cuando se corra cada
uno, se marca en `docs/despliegue.md` con la fecha.

## Qué crea

| Recurso | Por qué así |
| --- | --- |
| Cloud Run `flash-api`: 1 instancia mínima, CPU siempre, 3600 s de timeout | El `LISTEN` del realtime muere si la instancia duerme; el SSE no tolera cortes cada 5 min |
| Liveness de la API sobre `/api/ready` | Cloud Run no saca instancias del tráfico: con el realtime caído, reiniciar es lo único |
| Cinco workers en bucle como servicios, una instancia cada uno, sin ingreso externo | El despacho y las colas no se reparten entre réplicas |
| Endpoint de salud de cada worker según el latido de su bucle | Cloud Run exige un puerto; un worker trabado contesta 503 y se reinicia |
| Tres Cloud Run Jobs con Cloud Scheduler | Conciliación a las 4 h, webhooks de Mercado Pago cada minuto, OAuth cada 15 min |
| Cloud SQL PostgreSQL 17 Enterprise, HA regional, PITR 7 días, protección contra borrado | RPO de 15 minutos; conexión directa por el conector, nunca un pooler |
| Memorystore Redis 7.2 HA en red privada | `REDIS_REQUIRED` bloquea el arranque sin él |
| 25 secretos en Secret Manager, creados **vacíos** | El valor nunca queda en el estado de Terraform ni en el panel |
| Cuenta de servicio `flash-runtime` con lo mínimo | Cliente de Cloud SQL, lectura de cada secreto, trazas, métricas y logs |

## Staging

Con `deploy_stage = "staging"` la misma infraestructura queda más chica (Cloud SQL zonal,
Redis básico) y el servidor arranca con proveedores de prueba donde todavía no hay cuenta
de tercero. Los secretos de terceros (Mercado Pago, Maps, SMTP, Twilio, Expo) **no se
montan**: no hace falta cargarlos. Qué cambia y qué no, en
[`docs/despliegue.md`](../../docs/despliegue.md#staging-el-primer-despliegue-real-antes-de-tener-las-cuentas-de-terceros).

    project_id     = "<project_id>"
    deploy_stage   = "staging"
    app_public_url = "https://flash-api-<número del proyecto>.southamerica-east1.run.app"
    api_public_url = "https://flash-api-<número del proyecto>.southamerica-east1.run.app"
    cors_origins   = "https://flash-api-<número del proyecto>.southamerica-east1.run.app"
    web_map_origins = "https://tile.openstreetmap.org"
    smtp_from      = "Flash <no-responder@example.invalid>"

Los pasos son los mismos de abajo. En el paso 5, `terraform output secretos_a_cargar` lista
sólo los que hay que cargar: en staging, los propios.

## Pasos, en orden

El despliegue va en **dos aplicaciones**. Cloud Run lee los secretos al crear cada
revisión, y `/api/ready` exige la base migrada. Si los servicios se crearan junto con los
secretos vacíos, la primera aplicación fallaría.

1. **Proyecto y facturación** (dueño). Anotar el `project_id`.
2. **Bucket del estado**, una sola vez:

       gcloud storage buckets create gs://<project_id>-tfstate --location=southamerica-east1 \
         --uniform-bucket-level-access --public-access-prevention
       gcloud storage buckets update gs://<project_id>-tfstate --versioning

3. **Inicializar:**

       terraform init -backend-config="bucket=<project_id>-tfstate" -backend-config="prefix=flash"

4. **Primera aplicación: la base, la red, Redis, el registro de imágenes y los secretos
   vacíos.** Se usa un archivo `produccion.tfvars`, que **no** se versiona:

       project_id        = "<project_id>"
       app_public_url    = "https://<dominio de la web>"
       api_public_url    = "https://api.<dominio>"
       cors_origins      = "https://<dominio de la web>,https://negocios.<dominio>"
       web_map_origins   = "https://maps.googleapis.com"
       smtp_from         = "Flash <no-responder@<dominio>>"
       legal_terms_url   = "https://<dominio>/terminos"
       legal_privacy_url = "https://<dominio>/privacidad"

       terraform apply -var-file=produccion.tfvars

   Con `deploy_services` en `false` (el valor por defecto) no se crea ningún servicio.

5. **Cargar los secretos.** `terraform output secretos_a_cargar` los lista. Cada uno se
   carga así:

       printf '%s' "<valor>" | gcloud secrets versions add <NOMBRE> --data-file=-

   - `DATABASE_URL` usa el socket del conector, con `localhost` como host: sin un host, la
     URL es inválida y `server/config.js` la rechaza:
     `postgresql://flash_runtime:<clave>@localhost/flash?host=/cloudsql/<cloudsql_connection_name>`.
   - Las claves de cifrado son 32 bytes aleatorios en base64 (`openssl rand -base64 32`).
6. **Base:**
   - crear los tres roles (`flash_app`, `flash_runtime`, `flash_rls_audit`) con
     `database/docker-init/`;
   - habilitar PostGIS;
   - correr las migraciones con `flash_app`.

   Nunca correr los seeds de desarrollo en producción.
7. **Imagen.** CI construye y prueba la imagen (`container-image` en `ci-fast`), pero
   **todavía no la publica**. El workflow que la sube necesita la identidad federada de
   GitHub en el proyecto, y se escribe cuando exista la cuenta (`docs/lanzamiento.md`).
   Mientras tanto se publica a mano, desde un checkout limpio del commit de `main` que pasó
   CI:

       REGISTRO=$(terraform output -raw artifact_registry)
       gcloud auth configure-docker southamerica-east1-docker.pkg.dev
       docker build -t "$REGISTRO/api:$(git rev-parse HEAD)" .
       docker push "$REGISTRO/api:$(git rev-parse HEAD)"
       gcloud artifacts docker images describe "$REGISTRO/api:$(git rev-parse HEAD)" \
         --format='value(image_summary.digest)'

   El último comando da el digest que va en el paso siguiente.
8. **Segunda aplicación: los servicios.** Se agregan al archivo:

       image           = "southamerica-east1-docker.pkg.dev/<project_id>/flash/api@sha256:<digest>"
       deploy_services = true

   y se aplica de nuevo. La API rechaza una imagen sin digest.
9. **Verificar** lo que exige el documento de despliegue:
   - `/api/ready` en verde, con `realtime.listening` en `true`;
   - que **un pedido pagado reciba una oferta de despacho sin que nadie toque nada**: es la
     prueba de que los workers corren, no solo de que existen;
   - que cada job haya corrido una vez sin fallar (`gcloud run jobs executions list`).
10. **Restore drill** cronometrado contra el RTO de 60 minutos.

## Lo que falta y es del dueño

- El dominio y su mapeo a Cloud Run.
- Los documentos legales: las URLs son obligatorias, porque producción no arranca sin
  ellas.
- El colector de trazas: `OTEL_ENABLED` arranca en `false` hasta que exista.
- Todas las credenciales de terceros de [`docs/lanzamiento.md`](../../docs/lanzamiento.md).
