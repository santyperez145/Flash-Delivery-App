output "api_url" {
  description = "URL de la API en Cloud Run. Va detrás del dominio propio una vez mapeado."
  value       = one(google_cloud_run_v2_service.api[*].uri)
}

output "cloudsql_connection_name" {
  description = "Para armar DATABASE_URL: postgresql://flash_runtime:CLAVE@localhost/flash?host=/cloudsql/<este valor>"
  value       = google_sql_database_instance.flash.connection_name
}

output "redis_host" {
  description = "Para armar REDIS_URL: redis://<este valor>:6379"
  value       = google_redis_instance.flash.host
}

output "artifact_registry" {
  description = "Dónde publica CI la imagen."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.flash.repository_id}"
}

output "secretos_a_cargar" {
  description = "Secretos que existen vacíos y hay que cargar antes del primer arranque."
  value       = sort(tolist(local.secretos))
}
