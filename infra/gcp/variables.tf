variable "project_id" {
  description = "Proyecto de GCP del dueño. Se crea a mano, con facturación (ver docs/lanzamiento.md)."
  type        = string
}

variable "region" {
  description = "São Paulo: ~30 ms de Buenos Aires contra ~120 ms de Virginia. Es la única decisión de infraestructura que no se corrige después con más plata."
  type        = string
  default     = "southamerica-east1"
}

variable "image" {
  description = "Imagen de la API en Artifact Registry, con su digest. La construye y verifica CI; nunca una build local."
  type        = string
}

variable "app_public_url" {
  description = "URL pública de la web (APP_PUBLIC_URL): correos, enlaces de seguimiento y retorno de OAuth."
  type        = string
}

variable "database_tier" {
  description = "Tamaño de Cloud SQL. El piloto de La Rioja (15-25 comercios) entra en el más chico con HA; se sube cuando las métricas lo pidan, no antes."
  type        = string
  default     = "db-custom-1-3840"
}

variable "redis_memory_gb" {
  description = "Memoria de Memorystore: cache de rutas y geocoding, límites de tasa y colas."
  type        = number
  default     = 1
}

variable "plain_env" {
  description = "Variables no secretas de la API y los workers (proveedores, radios, límites). Las secretas van en Secret Manager."
  type        = map(string)
  default = {
    NODE_ENV          = "production"
    REDIS_REQUIRED    = "true"
    REQUIRE_ADMIN_MFA = "true"
    # Apagado hasta que exista un colector OTLP (Cloud Trace o un collector propio):
    # prenderlo antes enviaría trazas a ningún lado. Ver README.md.
    OTEL_ENABLED                 = "false"
    OTEL_SERVICE_NAME            = "flash-api"
    LOG_LEVEL                    = "info"
    PAYMENT_MARKETPLACE_PROVIDER = "mercadopago"
    MAPS_PROVIDER                = "google"
    NOTIFICATION_PROVIDER        = "expo"
    EMAIL_PROVIDER               = "smtp"
    PHONE_VERIFY_PROVIDER        = "twilio"
  }
}

variable "api_public_url" {
  description = "URL pública de la API (dominio propio mapeado a Cloud Run). De acá salen las URLs de retorno de Mercado Pago."
  type        = string
}

variable "cors_origins" {
  description = "Orígenes web que pueden llamar a la API (CORS_ORIGIN), separados por coma: la PWA y el portal de negocios."
  type        = string
}

variable "web_map_origins" {
  description = "Orígenes HTTPS de teselas de mapa que la web puede cargar (WEB_MAP_ORIGINS)."
  type        = string
}

variable "smtp_from" {
  description = "Remitente de los correos (SMTP_FROM), del dominio con SPF y DKIM configurados."
  type        = string
}
