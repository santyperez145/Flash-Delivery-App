# Infraestructura de Flash en Google Cloud (ver docs/despliegue.md).
#
# El estado de Terraform vive en un bucket de GCS que se crea una sola vez, a
# mano, antes del primer `terraform init` (ver README.md de esta carpeta). No va
# en el repositorio: el estado contiene identificadores de toda la plataforma.
terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 7.0"
    }
  }

  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
