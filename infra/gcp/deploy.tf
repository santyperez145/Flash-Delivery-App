# Despliegue real (INF-003): la base se prepara y se migra con trabajos de Cloud Run, y
# GitHub publica cada cambio de main sin claves guardadas.
#
# Nada de esto necesita conectarse a la base desde una computadora: el script de arranque
# (bootstrap.ps1) y el workflow de despliegue ejecutan estos trabajos dentro del proyecto.

locals {
  # Los trabajos de la base. `bootstrap` crea los tres roles separados con sus claves,
  # le da la base a `flash_app` y habilita PostGIS; `migrate` aplica las migraciones con
  # `flash_app`. Los dos son idempotentes: correrlos de nuevo no rompe nada.
  trabajos_base = {
    bootstrap = {
      script   = "scripts/db-bootstrap-cloud.mjs"
      secretos = ["POSTGRES_ADMIN_URL", "DB_PASSWORD_MIGRATION", "DB_PASSWORD_RUNTIME", "DB_PASSWORD_AUDIT"]
    }
    migrate = {
      script   = "scripts/db-migrate.mjs"
      secretos = ["MIGRATION_DATABASE_URL"]
    }
  }

  # Secretos de la base: sólo los leen los trabajos de la base, nunca la API ni los
  # workers. La API usa DATABASE_URL con el rol de runtime, sin privilegios.
  secretos_base = toset(["POSTGRES_ADMIN_URL", "MIGRATION_DATABASE_URL", "DB_PASSWORD_MIGRATION", "DB_PASSWORD_RUNTIME", "DB_PASSWORD_AUDIT"])
}

resource "google_secret_manager_secret" "base" {
  for_each  = local.secretos_base
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# Identidad propia de los trabajos de la base: la del runtime no puede leer la clave del
# administrador de la base.
resource "google_service_account" "base" {
  account_id   = "flash-db-jobs"
  display_name = "Trabajos de base de Flash (roles y migraciones)"
}

resource "google_project_iam_member" "base" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.base.email}"
}

resource "google_secret_manager_secret_iam_member" "base" {
  for_each  = local.secretos_base
  secret_id = google_secret_manager_secret.base[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.base.email}"
}

# Se crean apenas hay imagen, antes que los servicios: la API no arranca sin la base
# migrada, así que primero corre esto y después se despliegan los servicios.
resource "google_cloud_run_v2_job" "base" {
  for_each = var.image != "" ? local.trabajos_base : {}
  name     = "flash-db-${each.key}"
  location = var.region

  template {
    template {
      service_account = google_service_account.base.email
      timeout         = "1800s"
      max_retries     = 0

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

        env {
          name  = "DATABASE_SSL"
          value = "false"
        }

        dynamic "env" {
          for_each = toset(each.value.secretos)
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.base[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  # La imagen la actualiza el workflow de despliegue en cada cambio de main: Terraform
  # crea el trabajo y no vuelve a la imagen del primer arranque.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.base, google_project_iam_member.base]
}

# --- GitHub publica sin claves (Workload Identity Federation) -----------------
# GitHub Actions presenta su token OIDC y recibe credenciales de corta vida, sólo para
# este repositorio. No hay una clave de cuenta de servicio guardada en ningún lado.
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # Sólo este repositorio y sólo su rama main pueden desplegar.
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/main\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "flash-deployer"
  display_name = "Despliegue de Flash desde GitHub"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# Lo justo para publicar: subir imágenes, actualizar los servicios y trabajos de Cloud
# Run y ejecutar los trabajos de la base, actuando como sus cuentas de servicio.
resource "google_artifact_registry_repository_iam_member" "deployer" {
  repository = google_artifact_registry_repository.flash.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_actua" {
  for_each = {
    runtime = google_service_account.runtime.name
    base    = google_service_account.base.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# --- La imagen del primer arranque, con una identidad propia ---------------------------
# Cloud Build corre como la cuenta que se le indique. Sin indicarla usa la de Compute
# Engine por omisión, que en proyectos nuevos (o con organizaciones que bloquean los
# permisos automáticos) no puede leer el código subido, escribir logs ni publicar la
# imagen. `flash-build` tiene exactamente eso, y el código se sube a un bucket propio que
# borra lo viejo solo.
resource "google_service_account" "build" {
  account_id   = "flash-build"
  display_name = "Construcción de la imagen de Flash (Cloud Build)"
}

resource "google_storage_bucket" "build_source" {
  name                        = "${var.project_id}-flash-build"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "build_source" {
  bucket = google_storage_bucket.build_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.build.email}"
}

resource "google_artifact_registry_repository_iam_member" "build" {
  repository = google_artifact_registry_repository.flash.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}
