# Cloud Run: la API, los workers y el job de conciliación.
#
# Las tres trampas de docs/despliegue.md están acá, en código:
#   1. `min_instance_count = 1` y `cpu_idle = false`: el `LISTEN flash_realtime`
#      vive en una conexión dedicada; si la instancia duerme o le estrangulan la
#      CPU, el socket muere y el SSE sigue aceptando clientes sin entregar nada.
#   2. Conexión directa a Cloud SQL por el conector (`/cloudsql`), nunca un
#      pooler en modo transacción: `LISTEN/NOTIFY` no sobrevive a uno.
#   3. `timeout = "3600s"`: el SSE es de larga duración y cortarlo a los cinco
#      minutos reconecta a todos los clientes sin necesidad.

locals {
  conector_sql = google_sql_database_instance.flash.connection_name
}

resource "google_cloud_run_v2_service" "api" {
  name     = "flash-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email
    timeout         = "3600s"

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.flash.id
        subnetwork = google_compute_subnetwork.flash.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.conector_sql]
      }
    }

    containers {
      image = var.image

      resources {
        cpu_idle = false
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.env_publico
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secretos
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.flash[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      # `/api/ready` saca la instancia del balanceador si el escucha del
      # realtime no se suscribe: la trampa 1, convertida en falla ruidosa.
      startup_probe {
        http_get {
          path = "/api/ready"
        }
        period_seconds    = 10
        failure_threshold = 6
      }
      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# La API es pública: la protegen la autenticación de la app y los límites de tasa.
resource "google_cloud_run_v2_service_iam_member" "api_publica" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service" "worker" {
  for_each = local.workers
  name     = "flash-worker-${each.key}"
  location = var.region
  # Los workers no reciben tráfico: nadie de afuera puede invocarlos.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      # Exactamente una: el despacho y las colas no se reparten entre réplicas.
      min_instance_count = 1
      max_instance_count = 1
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.flash.id
        subnetwork = google_compute_subnetwork.flash.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.conector_sql]
      }
    }

    containers {
      image   = var.image
      command = ["node", each.value]

      resources {
        cpu_idle = false
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      dynamic "env" {
        for_each = local.env_publico
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secretos
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.flash[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# --- Conciliación de pagos: un job, disparado por el planificador -------------
resource "google_cloud_run_v2_job" "conciliacion" {
  name     = "flash-job-payment-reconciliation"
  location = var.region

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = "1800s"
      max_retries     = 2

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.conector_sql]
        }
      }

      containers {
        image   = var.image
        command = ["node", "scripts/job-payment-reconciliation.mjs"]

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        dynamic "env" {
          for_each = local.env_publico
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.secretos
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.flash[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

resource "google_service_account" "planificador" {
  account_id   = "flash-scheduler"
  display_name = "Cloud Scheduler de Flash"
}

resource "google_cloud_run_v2_job_iam_member" "planificador" {
  name     = google_cloud_run_v2_job.conciliacion.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.planificador.email}"
}

# Todos los días a las 4 de la mañana de Buenos Aires: después del corte del
# proveedor y antes de que operaciones empiece el día.
resource "google_cloud_scheduler_job" "conciliacion" {
  name      = "flash-payment-reconciliation"
  region    = var.region
  schedule  = "0 4 * * *"
  time_zone = "America/Argentina/Buenos_Aires"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.conciliacion.name}:run"
    oauth_token {
      service_account_email = google_service_account.planificador.email
    }
  }

  depends_on = [google_project_service.apis]
}
