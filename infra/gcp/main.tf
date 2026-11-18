# Flash en GCP: el mapeo de docs/despliegue.md, con sus tres trampas resueltas
# en código y no en la memoria de quien despliega.

locals {
  # Los secretos que `server/config.js` lee en producción. Terraform crea sólo
  # el contenedor: el valor se carga aparte (README.md), así nunca queda en el
  # estado de Terraform ni en el panel de Cloud Run.
  secretos = toset([
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_SECRET",
    "DELIVERY_PIN_SECRET",
    "DELIVERY_PROOF_ENCRYPTION_KEY",
    "KYC_DOCUMENT_ENCRYPTION_KEY",
    "MFA_ENCRYPTION_KEY",
    "PAYMENT_OAUTH_ENCRYPTION_KEY",
    "PUSH_TOKEN_ENCRYPTION_KEY",
    "RECOVERY_TOKEN_ENCRYPTION_KEY",
    "FEATURE_FLAG_SALT",
    "METRICS_TOKEN",
    "MERCADOPAGO_CLIENT_ID",
    "MERCADOPAGO_CLIENT_SECRET",
    "MERCADOPAGO_PUBLIC_KEY",
    "MERCADOPAGO_WEBHOOK_SECRET",
    "PAYMENT_WEBHOOK_SECRET",
    "EXPO_ACCESS_TOKEN",
    "GOOGLE_MAPS_SERVER_API_KEY",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_VERIFY_SERVICE_SID",
  ])

  # Los workers que corren en bucle: servicios con una instancia siempre viva,
  # que escuchan sólo para informar su latido (scripts/worker-health.mjs).
  workers = {
    dispatch      = "scripts/dispatch-worker.mjs"
    notifications = "scripts/notification-worker.mjs"
    push-receipts = "scripts/push-receipt-worker.mjs"
    pricing       = "scripts/pricing-worker.mjs"
    support       = "scripts/support-worker.mjs"
  }

  # Los que procesan una tanda y terminan no son servicios: como servicio, Cloud
  # Run los reiniciaría al salir, y el ritmo dependería de eso. Son jobs, y el
  # planificador fija cuándo corren. Si un webhook o una conexión no se pudo
  # procesar, el script sale con código 2 y la ejecución queda fallida, a la vista.
  lotes = {
    payment-reconciliation = {
      script      = "scripts/job-payment-reconciliation.mjs"
      schedule    = "0 4 * * *"
      timeout     = "1800s"
      max_retries = 2
    }
    # Cada minuto: la API sólo encola el aviso de Mercado Pago, así que es la
    # demora máxima hasta que el pago se refleja. Es el mínimo de Cloud Scheduler.
    mercadopago-webhooks = {
      script      = "scripts/mercadopago-webhook-worker.mjs"
      schedule    = "* * * * *"
      timeout     = "300s"
      max_retries = 0
    }
    payment-oauth-refresh = {
      script      = "scripts/payment-oauth-refresh-worker.mjs"
      schedule    = "*/15 * * * *"
      timeout     = "600s"
      max_retries = 0
    }
  }

  env_publico = merge(var.plain_env, {
    APP_PUBLIC_URL = var.app_public_url
    # Las tiendas exigen la política de privacidad pública (LAN-002).
    LEGAL_TERMS_URL   = var.legal_terms_url
    LEGAL_PRIVACY_URL = var.legal_privacy_url
    CORS_ORIGIN       = var.cors_origins
    WEB_MAP_ORIGINS   = var.web_map_origins
    SMTP_FROM         = var.smtp_from
    # Cloud Run entrega el tráfico en la interfaz del contenedor, no en loopback.
    HOST = "0.0.0.0"
    # Mercado Pago vuelve a la API después de vincular la cuenta del comercio.
    MERCADOPAGO_REDIRECT_URI = "${var.api_public_url}/api/payment-provider/mercadopago/callback"
    PAYMENT_OAUTH_RETURN_URL = var.app_public_url
  })
}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# --- Imágenes ---------------------------------------------------------------
resource "google_artifact_registry_repository" "flash" {
  repository_id = "flash"
  location      = var.region
  format        = "DOCKER"
  description   = "Imágenes de Flash, construidas desde un commit de main que pasó CI."
  depends_on    = [google_project_service.apis]
}

# --- Red privada: Redis sólo es alcanzable por VPC --------------------------
resource "google_compute_network" "flash" {
  name                    = "flash"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "flash" {
  name          = "flash-${var.region}"
  ip_cidr_range = "10.20.0.0/24"
  region        = var.region
  network       = google_compute_network.flash.id
}

# --- Base: Cloud SQL PostgreSQL 17 + PostGIS -------------------------------
resource "google_sql_database_instance" "flash" {
  name             = "flash-pg"
  database_version = "POSTGRES_17"
  region           = var.region
  # La base no se borra con un `terraform destroy` distraído.
  deletion_protection = true

  settings {
    # Explícita: PostgreSQL 16+ toma Enterprise Plus por defecto, y los tamaños
    # `db-custom-*` sólo existen en Enterprise.
    edition           = "ENTERPRISE"
    tier              = var.database_tier
    availability_type = "REGIONAL"
    disk_autoresize   = true

    backup_configuration {
      enabled = true
      # PITR: es lo que cubre el RPO de 15 minutos del deployment-checklist.
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      ipv4_enabled = true
      # Sin redes autorizadas: sólo se entra por el conector de Cloud SQL, con
      # identidad de IAM, nunca por IP pública abierta.
      ssl_mode = "ENCRYPTED_ONLY"
    }

    database_flags {
      name  = "cloudsql.enable_pgaudit"
      value = "on"
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "flash" {
  name     = "flash"
  instance = google_sql_database_instance.flash.name
}

# --- Redis --------------------------------------------------------------------
resource "google_redis_instance" "flash" {
  name               = "flash-redis"
  tier               = "STANDARD_HA"
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = google_compute_network.flash.id
  redis_version      = "REDIS_7_2"
  depends_on         = [google_project_service.apis]
}

# --- Secretos -----------------------------------------------------------------
resource "google_secret_manager_secret" "flash" {
  for_each  = local.secretos
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# --- Identidad del runtime ----------------------------------------------------
resource "google_service_account" "runtime" {
  account_id   = "flash-runtime"
  display_name = "Flash API y workers"
}

resource "google_project_iam_member" "runtime" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/cloudtrace.agent",
    "roles/monitoring.metricWriter",
    "roles/logging.logWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each  = local.secretos
  secret_id = google_secret_manager_secret.flash[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
