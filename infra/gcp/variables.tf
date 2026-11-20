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
  description = "Imagen de la API en Artifact Registry, fijada por digest, construida desde un commit de main que pasó CI (README, paso 7). Hace falta recién con deploy_services."
  type        = string
  default     = ""
}

variable "deploy_services" {
  description = "Despliega la API, los workers y los lotes. La primera aplicación va en false: Cloud Run lee los secretos al crear la revisión, y todavía están vacíos."
  type        = bool
  default     = false
}

variable "deploy_stage" {
  description = "production o staging. Staging es un despliegue real con todo el endurecimiento de producción, pero con proveedores de prueba donde todavía no hay cuenta de tercero (mapas, email, SMS, push, Mercado Pago) y una infraestructura más chica (base zonal, Redis básico). Ver docs/despliegue.md, «Staging»."
  type        = string
  default     = "production"
  validation {
    condition     = contains(["production", "staging"], var.deploy_stage)
    error_message = "deploy_stage es production o staging."
  }
}

variable "staging_expose_dev_codes" {
  description = "Sólo staging: mostrar en pantalla los códigos de verificación mientras no haya SMTP ni SMS. Quien tenga la URL puede crear cuentas con emails ajenos: se prende a propósito y se apaga al tener proveedor."
  type        = bool
  default     = false
}

variable "staging_smtp" {
  description = "Sólo staging: usar el SMTP real (cargar SMTP_HOST, SMTP_USER y SMTP_PASSWORD en Secret Manager). Con esto los códigos llegan por email y staging_expose_dev_codes queda en false."
  type        = bool
  default     = false
}

variable "legal_terms_url" {
  description = "URL pública de los términos y condiciones (LEGAL_TERMS_URL). La redacta el dueño con asesoría. En staging puede quedar vacía."
  type        = string
  default     = ""
  validation {
    condition     = startswith(var.legal_terms_url, "https://") || (var.deploy_stage == "staging" && var.legal_terms_url == "")
    error_message = "legal_terms_url tiene que ser HTTPS: el servidor no arranca en producción sin eso."
  }
}

variable "legal_privacy_url" {
  description = "URL pública de la política de privacidad (LEGAL_PRIVACY_URL). Las tiendas la exigen. En staging puede quedar vacía."
  type        = string
  default     = ""
  validation {
    condition     = startswith(var.legal_privacy_url, "https://") || (var.deploy_stage == "staging" && var.legal_privacy_url == "")
    error_message = "legal_privacy_url tiene que ser HTTPS: el servidor no arranca en producción sin eso."
  }
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
