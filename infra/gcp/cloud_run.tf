# Cloud Run: la API, los workers y los lotes programados.
#
# Las tres trampas de docs/despliegue.md están acá, en código:
#   1. `min_instance_count = 1` y `cpu_idle = false`: el `LISTEN flash_realtime`
#      vive en una conexión dedicada; si la instancia duerme o le estrangulan la
#      CPU, el socket muere y el SSE sigue aceptando clientes sin entregar nada.
#   2. Conexión directa a Cloud SQL por el conector (`/cloudsql`), nunca un
#      pooler en modo transacción: `LISTEN/NOTIFY` no sobrevive a uno.
#   3. `timeout = "3600s"`: el SSE es de larga duración y cortarlo a los cinco
#      minutos reconecta a todos los clientes sin necesidad.
#
# **Todo lo de este archivo espera a `deploy_services = true`.** Cloud Run lee los
# secretos al crear la revisión, y la base tiene que tener roles y migraciones
# para que `/api/ready` dé verde: la primera aplicación crea la base, la red y los
# secretos vacíos; se cargan los secretos y se migra; recién la segunda despliega.

locals {
  conector_sql = google_sql_database_instance.flash.connection_name
  # El worker escucha acá sólo para la plataforma: ver scripts/worker-health.mjs.
  puerto_salud_worker = 8080
}

resource "google_cloud_run_v2_service" "api" {
  count    = var.deploy_services ? 1 : 0
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

      # `/api/ready` falla si el escucha del realtime no se suscribe: la trampa 1,
      # convertida en falla ruidosa.
      startup_probe {
        http_get {
          path = "/api/ready"
        }
        period_seconds    = 10
        failure_threshold = 6
      }
      # Cloud Run no tiene probe de readiness que saque una instancia del tráfico:
      # el startup probe deja de correr cuando pasa. Por eso el liveness mira
      # `/api/ready` y no `/api/health`. Una instancia con el realtime caído se
      # reinicia en lugar de seguir aceptando clientes que no reciben nada. Dos
      # minutos de tolerancia, para no reiniciar por un parpadeo de la base.
      liveness_probe {
        http_get {
          path = "/api/ready"
        }
        period_seconds    = 30
        failure_threshold = 4
      }
    }
  }

  lifecycle {
    precondition {
      condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
      error_message = "image tiene que ser la imagen que publicó CI, fijada por digest (…@sha256:<digest>)."
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# La API es pública: la protegen la autenticación de la app y los límites de tasa.
resource "google_cloud_run_v2_service_iam_member" "api_publica" {
  count    = var.deploy_services ? 1 : 0
  name     = google_cloud_run_v2_service.api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Workers en bucle: servicios con una instancia siempre viva --------------
resource "google_cloud_run_v2_service" "worker" {
  for_each = var.deploy_services ? local.workers : {}
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

      # Cloud Run exige un puerto que escuche. El worker contesta según el latido
      # de su bucle, no un 200 fijo: si se traba, el liveness lo reinicia.
      ports {
        container_port = local.puerto_salud_worker
      }

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

      env {
        name  = "WORKER_HEALTH_PORT"
        value = tostring(local.puerto_salud_worker)
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

      startup_probe {
        http_get {
          path = "/"
        }
        period_seconds    = 10
        failure_threshold = 6
      }
      liveness_probe {
        http_get {
          path = "/"
        }
        period_seconds    = 60
        failure_threshold = 3
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.runtime]
}

# --- Lotes: procesan una tanda y terminan; los dispara el planificador --------
resource "google_cloud_run_v2_job" "lote" {
  for_each = var.deploy_services ? local.lotes : {}
  name     = "flash-job-${each.key}"
  location = var.region

  template {
    template {
      service_account = google_service_account.runtime.email
      timeout         = each.value.timeout
      max_retries     = each.value.max_retries

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.conector_sql]
        }
      }

      containers {
        image   = var.image
        command = ["node", each.value.script]

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
  for_each = google_cloud_run_v2_job.lote
  name     = each.value.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.planificador.email}"
}

# El horario es de Buenos Aires: la conciliación corre a las 4, después del corte
# del proveedor y antes de que operaciones empiece el día.
resource "google_cloud_scheduler_job" "lote" {
  for_each  = google_cloud_run_v2_job.lote
  name      = "flash-${each.key}"
  region    = var.region
  schedule  = local.lotes[each.key].schedule
  time_zone = "America/Argentina/Buenos_Aires"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${each.value.name}:run"
    oauth_token {
      service_account_email = google_service_account.planificador.email
    }
  }

  depends_on = [google_project_service.apis]
}
