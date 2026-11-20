<#
.SYNOPSIS
  Primer despliegue real de Flash en Google Cloud (INF-003), de punta a punta.

.DESCRIPTION
  Lo corre el dueño una sola vez, después de crear el proyecto con facturación y de
  iniciar sesión (gcloud auth login y gcloud auth application-default login). Hace, en
  orden y sin pasos a mano:

    1. Revisa las herramientas, la sesión y la facturación del proyecto.
    2. Muestra el costo estimado y pide confirmación escrita antes de crear algo pago.
    3. Crea el bucket del estado de Terraform y la primera parte de la infraestructura:
       red, Cloud SQL PostgreSQL 17, Redis, registro de imágenes, secretos vacíos,
       identidades y la conexión sin claves con GitHub.
    4. Genera y carga los secretos propios (claves de cifrado, JWT, claves de la base).
       Nunca se imprimen. Los de terceros los carga el dueño cuando tenga las cuentas.
    5. Construye la imagen en Cloud Build (no hace falta Docker en la compu).
    6. Prepara la base: roles separados, PostGIS y las migraciones. Sin semillas.
    7. Despliega la API, los workers y los lotes, y verifica /api/ready.
    8. Deja las variables de GitHub para que cada cambio de main se publique solo.

  Es seguro volver a correrlo: cada paso mira lo que ya existe y no pisa secretos.

.EXAMPLE
  .\infra\gcp\bootstrap.ps1 -ProjectId flash-staging-123 -Stage staging
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [ValidateSet("staging", "production")][string]$Stage = "staging",
  [string]$Region = "southamerica-east1"
)

$ErrorActionPreference = "Stop"
$raiz = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$infra = $PSScriptRoot

function Write-Paso([string]$texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }

function Invoke-Herramienta {
  param([string]$Exe, [string[]]$Argumentos, [switch]$Silencioso)
  if ($Silencioso) { $salida = & $Exe @Argumentos 2>$null } else { $salida = & $Exe @Argumentos }
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($Argumentos -join ' ') terminó con error ($LASTEXITCODE)" }
  return $salida
}

# Un secreto aleatorio: 32 bytes en base64 sin caracteres que haya que escapar en una URL.
function New-Secreto {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes)).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

# Las claves de cifrado del servidor son 32 bytes en base64 estándar.
function New-ClaveDeCifrado {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return [Convert]::ToBase64String($bytes)
}

function Test-SecretoCargado([string]$nombre) {
  $versiones = & gcloud secrets versions list $nombre --project $ProjectId --limit 1 --format "value(name)" 2>$null
  return [bool]$versiones
}

# Carga el valor sólo si el secreto todavía no tiene versión: volver a correr el script no
# cambia una clave que ya usan la base o las sesiones. El valor va por un archivo temporal
# sin salto de línea y se borra enseguida.
function Set-SecretoSiFalta([string]$nombre, [string]$valor) {
  if (Test-SecretoCargado $nombre) { Write-Host "  $nombre ya tenía valor"; return $false }
  $archivo = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($archivo, $valor)
    Invoke-Herramienta gcloud @("secrets", "versions", "add", $nombre, "--project", $ProjectId, "--data-file", $archivo) -Silencioso | Out-Null
    Write-Host "  $nombre cargado"
    return $true
  } finally {
    Remove-Item $archivo -Force
  }
}

function Invoke-Terraform([string[]]$Argumentos) {
  Push-Location $infra
  try { Invoke-Herramienta terraform $Argumentos } finally { Pop-Location }
}

# --- 1. Herramientas, sesión y facturación ------------------------------------------
Write-Paso "1. Herramientas, sesión y facturación"
foreach ($herramienta in @("gcloud", "terraform")) {
  if (-not (Get-Command $herramienta -ErrorAction SilentlyContinue)) {
    throw "Falta $herramienta. gcloud: winget install Google.CloudSDK · terraform: winget install Hashicorp.Terraform"
  }
}
$cuenta = Invoke-Herramienta gcloud @("auth", "list", "--filter", "status:ACTIVE", "--format", "value(account)")
if (-not $cuenta) { throw "No hay sesión de gcloud. Corré: gcloud auth login" }
& gcloud auth application-default print-access-token *> $null
if ($LASTEXITCODE -ne 0) { throw "Falta la sesión para Terraform. Corré: gcloud auth application-default login" }
Invoke-Herramienta gcloud @("config", "set", "project", $ProjectId) -Silencioso | Out-Null
$numero = Invoke-Herramienta gcloud @("projects", "describe", $ProjectId, "--format", "value(projectNumber)")
$facturacion = Invoke-Herramienta gcloud @("billing", "projects", "describe", $ProjectId, "--format", "value(billingEnabled)")
if ($facturacion -ne "True") { throw "El proyecto $ProjectId no tiene la facturación activada." }
Write-Host "  Sesión: $cuenta · proyecto $ProjectId ($numero) · facturación activa"

$url = "https://flash-api-$numero.$Region.run.app"

# --- 2. Costo y confirmación ---------------------------------------------------------
Write-Paso "2. Lo que se va a crear y su costo aproximado"
if ($Stage -eq "staging") {
  Write-Host @"
  Staging (estimación, en dólares por mes; confirmala en https://cloud.google.com/products/calculator):
    - Cloud SQL PostgreSQL 17, 1 vCPU y 3,75 GB, zonal, con backups y PITR .... ~ 50-70
    - Memorystore Redis básico, 1 GB ......................................... ~ 35-45
    - Cloud Run: API + 5 workers, 1 vCPU cada uno siempre encendida .......... ~ 250-400
    - Secret Manager, Artifact Registry, Cloud Build, Scheduler, logs ........ ~ 5-15
    Total aproximado ......................................................... ~ 340-530
  Lo que más pesa son los 6 servicios siempre encendidos: el despacho y el realtime no
  toleran que se duerman. Juntar los workers en menos procesos lo bajaría (pendiente).
"@
} else {
  Write-Host @"
  Producción (estimación, en dólares por mes; confirmala en https://cloud.google.com/products/calculator):
    - Cloud SQL PostgreSQL 17 con alta disponibilidad regional, backups y PITR  ~ 100-140
    - Memorystore Redis con alta disponibilidad, 1 GB ........................ ~ 70-90
    - Cloud Run: API + 5 workers, 1 vCPU cada uno siempre encendida .......... ~ 250-400
    - Secret Manager, Artifact Registry, Cloud Build, Scheduler, logs ........ ~ 5-15
    Total aproximado ......................................................... ~ 430-650
"@
}
Write-Host "  URL: $url"
$respuesta = Read-Host "  Para crear estos recursos pagos en $ProjectId escribí CREAR"
if ($respuesta -ne "CREAR") { throw "Cancelado: no se creó nada." }

# --- 3. Estado de Terraform e infraestructura base ----------------------------------
Write-Paso "3. Estado de Terraform e infraestructura base"
Invoke-Herramienta gcloud @("services", "enable", "cloudresourcemanager.googleapis.com", "serviceusage.googleapis.com", "storage.googleapis.com", "--project", $ProjectId) -Silencioso | Out-Null
$bucket = "gs://$ProjectId-tfstate"
& gcloud storage buckets describe $bucket --project $ProjectId *> $null
if ($LASTEXITCODE -ne 0) {
  Invoke-Herramienta gcloud @("storage", "buckets", "create", $bucket, "--project", $ProjectId, "--location", $Region, "--uniform-bucket-level-access", "--public-access-prevention") | Out-Null
  Invoke-Herramienta gcloud @("storage", "buckets", "update", $bucket, "--versioning") | Out-Null
}

$tfvars = Join-Path $infra "$Stage.tfvars"
if (-not (Test-Path $tfvars)) {
  $contenido = @"
project_id      = "$ProjectId"
region          = "$Region"
deploy_stage    = "$Stage"
app_public_url  = "$url"
api_public_url  = "$url"
cors_origins    = "$url"
web_map_origins = "https://tile.openstreetmap.org"
smtp_from       = "Flash <no-responder@example.invalid>"
"@
  [System.IO.File]::WriteAllText($tfvars, $contenido)
  Write-Host "  $Stage.tfvars creado (no se versiona)"
}

Invoke-Terraform @("init", "-input=false", "-reconfigure", "-backend-config=bucket=$ProjectId-tfstate", "-backend-config=prefix=flash-$Stage") | Out-Null

# Si ya hay un despliegue, volver a correr el script no lo baja: las aplicaciones de
# Terraform conservan los servicios y la imagen que están corriendo. Con
# `deploy_services=false` o sin imagen, Terraform borraría la API, los workers, los lotes,
# sus horarios y los trabajos de la base hasta la última aplicación, y un fallo en el medio
# dejaría Flash caído.
$imagenActual = & gcloud run services describe flash-api --region $Region --project $ProjectId --format "value(spec.template.spec.containers[0].image)" 2>$null
$desplegado = ($LASTEXITCODE -eq 0) -and [bool]$imagenActual
if (-not $desplegado) {
  $imagenActual = & gcloud run jobs describe flash-db-migrate --region $Region --project $ProjectId --format "value(spec.template.spec.template.spec.containers[0].image)" 2>$null
  if ($LASTEXITCODE -ne 0) { $imagenActual = "" }
}
$imagenActual = "$imagenActual".Trim()
$servicios = if ($desplegado) { "true" } else { "false" }
if ($desplegado) { Write-Host "  Ya hay un despliegue ($imagenActual): se conserva mientras se actualiza" }
Invoke-Terraform @("apply", "-input=false", "-auto-approve", "-var-file=$tfvars", "-var=deploy_services=$servicios", "-var=image=$imagenActual")

$conexion = (Invoke-Terraform @("output", "-raw", "cloudsql_connection_name")).Trim()
$redis = (Invoke-Terraform @("output", "-raw", "redis_host")).Trim()
$registro = (Invoke-Terraform @("output", "-raw", "artifact_registry")).Trim()
$cuentaBuild = (Invoke-Terraform @("output", "-raw", "build_service_account")).Trim()
$bucketBuild = (Invoke-Terraform @("output", "-raw", "build_source_bucket")).Trim()

# --- 4. Secretos propios ---------------------------------------------------------------
Write-Paso "4. Secretos propios (se generan acá y nunca se muestran)"
$propios = @{
  JWT_SECRET                    = New-Secreto
  DELIVERY_PIN_SECRET           = New-Secreto
  FEATURE_FLAG_SALT             = New-Secreto
  METRICS_TOKEN                 = New-Secreto
  PAYMENT_WEBHOOK_SECRET        = New-Secreto
  DELIVERY_PROOF_ENCRYPTION_KEY = New-ClaveDeCifrado
  KYC_DOCUMENT_ENCRYPTION_KEY   = New-ClaveDeCifrado
  MFA_ENCRYPTION_KEY            = New-ClaveDeCifrado
  PAYMENT_OAUTH_ENCRYPTION_KEY  = New-ClaveDeCifrado
  PUSH_TOKEN_ENCRYPTION_KEY     = New-ClaveDeCifrado
  RECOVERY_TOKEN_ENCRYPTION_KEY = New-ClaveDeCifrado
  REDIS_URL                     = "redis://$($redis):6379/0"
}
foreach ($nombre in $propios.Keys) { Set-SecretoSiFalta $nombre $propios[$nombre] | Out-Null }

# Las claves de la base. La del administrador (`postgres`) se fija en Cloud SQL sólo la
# primera vez, junto con su secreto: así nunca quedan distintas.
$sufijoConexion = "@localhost/flash?host=/cloudsql/$conexion"
if (-not (Test-SecretoCargado "POSTGRES_ADMIN_URL")) {
  $claveAdmin = New-Secreto
  Invoke-Herramienta gcloud @("sql", "users", "set-password", "postgres", "--instance", "flash-pg", "--project", $ProjectId, "--password", $claveAdmin) -Silencioso | Out-Null
  Set-SecretoSiFalta "POSTGRES_ADMIN_URL" "postgresql://postgres:$claveAdmin$sufijoConexion" | Out-Null
}
# Cada clave y su URL se miran por separado: si una corrida anterior cargó la clave y se
# cortó antes de la URL, la URL se arma con la clave ya cargada, sin cambiarla.
foreach ($rol in @(@("DB_PASSWORD_MIGRATION", "MIGRATION_DATABASE_URL", "flash_app"), @("DB_PASSWORD_RUNTIME", "DATABASE_URL", "flash_runtime"), @("DB_PASSWORD_AUDIT", $null, "flash_rls_audit"))) {
  $clave = $null
  if (-not (Test-SecretoCargado $rol[0])) {
    $clave = New-Secreto
    Set-SecretoSiFalta $rol[0] $clave | Out-Null
  }
  if ($rol[1] -and -not (Test-SecretoCargado $rol[1])) {
    if (-not $clave) {
      $clave = ("" + (Invoke-Herramienta gcloud @("secrets", "versions", "access", "latest", "--secret", $rol[0], "--project", $ProjectId) -Silencioso)).Trim()
    }
    Set-SecretoSiFalta $rol[1] "postgresql://$($rol[2]):$clave$sufijoConexion" | Out-Null
  }
}

if ($Stage -eq "production") {
  $faltan = @()
  foreach ($nombre in (Invoke-Terraform @("output", "-json", "secretos_a_cargar") | ConvertFrom-Json)) {
    if (-not (Test-SecretoCargado $nombre)) { $faltan += $nombre }
  }
  if ($faltan.Count) {
    throw "Producción necesita estas credenciales de terceros antes de desplegar: $($faltan -join ', '). Cargalas con: gcloud secrets versions add NOMBRE --data-file=archivo"
  }
}

# --- 5. Imagen ---------------------------------------------------------------------------
Write-Paso "5. Imagen en Cloud Build"
$commit = (& git -C $raiz rev-parse --short HEAD).Trim()
$etiqueta = "$($registro)/api:bootstrap-$commit"
Push-Location $raiz
# Con la cuenta `flash-build` y su bucket: la cuenta por omisión de Compute Engine no
# tiene permisos en proyectos nuevos.
try { Invoke-Herramienta gcloud @("builds", "submit", "--project", $ProjectId, "--region", $Region, "--config", (Join-Path $infra "cloudbuild.yaml"), "--substitutions", "_IMAGE=$etiqueta", "--service-account", $cuentaBuild, "--gcs-source-staging-dir", "gs://$bucketBuild/source", ".") }
finally { Pop-Location }
$digest = (Invoke-Herramienta gcloud @("artifacts", "docker", "images", "describe", $etiqueta, "--format", "value(image_summary.digest)")).Trim()
$imagen = "$($registro)/api@$digest"
Write-Host "  Imagen: $imagen"

# --- 6. Base: roles, PostGIS y migraciones ----------------------------------------------
Write-Paso "6. Base: roles separados, PostGIS y migraciones (sin semillas)"
Invoke-Terraform @("apply", "-input=false", "-auto-approve", "-var-file=$tfvars", "-var=deploy_services=$servicios", "-var=image=$imagen")
# Terraform crea los trabajos pero no les cambia la imagen después (la publica el
# workflow): en una segunda corrida se la pone acá, para preparar y migrar con esta.
foreach ($trabajo in @("flash-db-bootstrap", "flash-db-migrate")) {
  Invoke-Herramienta gcloud @("run", "jobs", "update", $trabajo, "--region", $Region, "--project", $ProjectId, "--image", $imagen, "--quiet") -Silencioso | Out-Null
}
Invoke-Herramienta gcloud @("run", "jobs", "execute", "flash-db-bootstrap", "--region", $Region, "--project", $ProjectId, "--wait")
Invoke-Herramienta gcloud @("run", "jobs", "execute", "flash-db-migrate", "--region", $Region, "--project", $ProjectId, "--wait")

# --- 7. Servicios ------------------------------------------------------------------------
Write-Paso "7. API, workers y lotes"
Invoke-Terraform @("apply", "-input=false", "-auto-approve", "-var-file=$tfvars", "-var=deploy_services=true", "-var=image=$imagen")
# Los servicios que ya existían no toman la imagen de Terraform: se publica como lo hace
# el workflow, servicio por servicio, con la base ya migrada.
if ($desplegado) {
  foreach ($servicio in (Invoke-Herramienta gcloud @("run", "services", "list", "--region", $Region, "--project", $ProjectId, "--format", "value(metadata.name)", "--filter", "metadata.name ~ ^flash-"))) {
    Invoke-Herramienta gcloud @("run", "services", "update", $servicio, "--region", $Region, "--project", $ProjectId, "--image", $imagen, "--quiet") -Silencioso | Out-Null
  }
  foreach ($trabajo in (Invoke-Herramienta gcloud @("run", "jobs", "list", "--region", $Region, "--project", $ProjectId, "--format", "value(metadata.name)", "--filter", "metadata.name ~ ^flash-job-"))) {
    Invoke-Herramienta gcloud @("run", "jobs", "update", $trabajo, "--region", $Region, "--project", $ProjectId, "--image", $imagen, "--quiet") -Silencioso | Out-Null
  }
}
$listo = Invoke-RestMethod -Uri "$url/api/ready" -TimeoutSec 60
if (-not $listo.ok) { throw "La API respondió pero no está lista: $($listo | ConvertTo-Json -Depth 4)" }
Write-Host "  /api/ready en verde · base $($listo.database.database) · realtime $($listo.realtime.listening)"

# --- 8. GitHub publica solo -------------------------------------------------------------
Write-Paso "8. Despliegue continuo desde GitHub"
$proveedor = (Invoke-Terraform @("output", "-raw", "workload_identity_provider")).Trim()
$desplegador = (Invoke-Terraform @("output", "-raw", "deployer_service_account")).Trim()
$variables = [ordered]@{
  GCP_PROJECT_ID                 = $ProjectId
  GCP_REGION                     = $Region
  GCP_WORKLOAD_IDENTITY_PROVIDER = $proveedor
  GCP_DEPLOYER_SA                = $desplegador
}
if (Get-Command gh -ErrorAction SilentlyContinue) {
  $siGh = Read-Host "  ¿Cargar estas variables en el repositorio de GitHub para que main se publique solo? (si/no)"
  if ($siGh -eq "si") {
    foreach ($nombre in $variables.Keys) {
      Invoke-Herramienta gh @("variable", "set", $nombre, "--body", $variables[$nombre]) | Out-Null
      Write-Host "  $nombre"
    }
  }
}
Write-Host "  Variables de GitHub (Settings > Secrets and variables > Actions > Variables):"
foreach ($nombre in $variables.Keys) { Write-Host "    $nombre = $($variables[$nombre])" }

Write-Host "`nListo. Flash corre en $url" -ForegroundColor Green
if ($Stage -eq "staging") {
  Write-Host "Sin SMTP los códigos de verificación no llegan: cargá SMTP_HOST, SMTP_USER y SMTP_PASSWORD y aplicá con staging_smtp = true (docs/despliegue.md)."
}
