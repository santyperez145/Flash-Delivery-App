# Infraestructura de Flash en GCP

El mapeo de [`docs/despliegue.md`](../../docs/despliegue.md) escrito en Terraform. CI lo
valida en cada PR (job «Infraestructura (Terraform)» de `ci-fast`), así que el día que exista
la cuenta, desplegar es seguir estos pasos, no escribir la infraestructura.

**Ninguno de estos pasos se ejecutó todavía:** no hay cuenta de GCP. Cuando se corra cada
uno, se marca en `docs/despliegue.md` con la fecha.

## Qué crea

| Recurso | Por qué así |
| --- | --- |
| Cloud Run `flash-api` con `min_instance_count = 1`, `cpu_idle = false`, `timeout = 3600s` | Las tres trampas del documento de despliegue: el `LISTEN` del realtime muere si la instancia duerme, y el SSE no tolera cortes cada 5 minutos |
| Siete workers como servicios Cloud Run, una instancia cada uno, sin ingreso externo | Corren en bucle; el despacho y las colas no se reparten entre réplicas |
| Cloud Run Job de conciliación + Cloud Scheduler a las 4 h | El planificador es del entorno, no un `setInterval` dentro del proceso |
| Cloud SQL PostgreSQL 17, HA regional, PITR 7 días, protección contra borrado | RPO de 15 minutos; conexión directa por el conector, nunca un pooler en modo transacción |
| Memorystore Redis 7.2 HA en red privada | `REDIS_REQUIRED` bloquea el arranque sin él |
| 25 secretos en Secret Manager, **vacíos** | El valor se carga aparte: nunca queda en el estado de Terraform ni en el panel |
| Cuenta de servicio `flash-runtime` con lo mínimo | Cliente de Cloud SQL, lectura de cada secreto, trazas, métricas y logs |

## Pasos, en orden

1. **Proyecto y facturación** (dueño). Anotar el `project_id`.
2. **Bucket del estado**, una sola vez:

       gcloud storage buckets create gs://<project_id>-tfstate --location=southamerica-east1 \
         --uniform-bucket-level-access --public-access-prevention
       gcloud storage buckets update gs://<project_id>-tfstate --versioning

3. **Inicializar:**

       terraform init -backend-config="bucket=<project_id>-tfstate" -backend-config="prefix=flash"

4. **Primera aplicación**, con un archivo `produccion.tfvars` que **no** se versiona:

       project_id      = "<project_id>"
       image           = "southamerica-east1-docker.pkg.dev/<project_id>/flash/api@sha256:<digest>"
       app_public_url  = "https://<dominio de la web>"
       api_public_url  = "https://api.<dominio>"
       cors_origins    = "https://<dominio de la web>,https://negocios.<dominio>"
       web_map_origins = "https://maps.googleapis.com"
       smtp_from       = "Flash <no-responder@<dominio>>"

       terraform apply -var-file=produccion.tfvars

   La primera vez la imagen todavía no existe: se aplica primero con
   `-target=google_artifact_registry_repository.flash`, CI publica la imagen y después se
   aplica todo.

5. **Cargar los secretos.** `terraform output secretos_a_cargar` los lista. Cada uno:

       printf '%s' "<valor>" | gcloud secrets versions add <NOMBRE> --data-file=-

   `DATABASE_URL` usa el socket del conector:
   `postgresql://flash_runtime:<clave>@/flash?host=/cloudsql/<cloudsql_connection_name>`.
   Las claves de cifrado son 32 bytes aleatorios en base64 (`openssl rand -base64 32`).

6. **Base:** crear los tres roles (`flash_app`, `flash_runtime`, `flash_rls_audit`) con
   `database/docker-init/`, habilitar PostGIS y correr las migraciones con `flash_app`.
   Nunca correr los seeds de desarrollo en producción.
7. **Verificar** lo que el documento de despliegue exige: `/api/ready` en verde con
   `realtime.listening` en `true`, y que **un pedido pagado reciba una oferta de despacho
   sin que nadie toque nada**: es la prueba de que los workers corren, no de que existen.
8. **Restore drill** cronometrado contra el RTO de 60 minutos.

## Lo que falta y es del dueño

Dominio y su mapeo a Cloud Run, colector de trazas (`OTEL_ENABLED` arranca en `false`
hasta que exista), y todas las credenciales de terceros de
[`docs/lanzamiento.md`](../../docs/lanzamiento.md).
