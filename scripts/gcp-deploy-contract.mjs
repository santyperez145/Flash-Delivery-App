// Despliegue real en Google Cloud (INF-003): el cableado, sin cuenta.
//
// `test:db-bootstrap-cloud` prueba contra PostgreSQL la preparación de la base. Esto vigila
// el resto de lo que hace que el despliegue sea de un comando y que después cada cambio de
// main se publique solo, sin claves guardadas:
//
// - GitHub entra con Workload Identity, sólo este repositorio y sólo su rama main;
// - la clave del administrador de la base la leen sólo los trabajos de la base;
// - el workflow migra la base antes de publicar los servicios, y no despliega nada si no
//   hay proyecto;
// - el script de arranque pide confirmación escrita antes de crear recursos pagos, no pisa
//   secretos, prepara y migra la base antes de los servicios y no corre semillas;
// - Terraform no vuelve a la imagen del primer arranque, y los lotes llegan a Redis.
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { contains, squeeze } from "./source-contract.mjs";

const leer = (ruta) => fs.readFile(ruta, "utf8");
const [deploy, cloudRun, main, workflow, bootstrap, preparacion, ignorar, construccion] =
  await Promise.all(
    [
      "infra/gcp/deploy.tf",
      "infra/gcp/cloud_run.tf",
      "infra/gcp/main.tf",
      ".github/workflows/deploy-gcp.yml",
      "infra/gcp/bootstrap.ps1",
      "scripts/db-bootstrap-cloud.mjs",
      ".gcloudignore",
      "infra/gcp/cloudbuild.yaml",
    ].map(leer),
  );
const antes = (fuente, primero, despues) => {
  const plano = squeeze(fuente);
  const a = plano.indexOf(squeeze(primero));
  const b = plano.indexOf(squeeze(despues));
  return a >= 0 && b >= 0 && a < b;
};

// --- GitHub sin claves --------------------------------------------------------------------
assert.ok(
  contains(
    deploy,
    'attribute_condition = "assertion.repository == \\"${var.github_repository}\\" && assertion.ref == \\"refs/heads/main\\""',
  ),
  "sólo este repositorio y su rama main pueden desplegar",
);
assert.ok(
  contains(deploy, 'role = "roles/run.developer"') &&
    contains(deploy, 'role = "roles/artifactregistry.writer"') &&
    !contains(deploy, "roles/owner") &&
    !contains(deploy, "roles/editor"),
  "quien despliega tiene lo justo, nunca owner ni editor",
);
assert.ok(
  contains(workflow, "id-token: write") &&
    contains(workflow, "uses: google-github-actions/auth@v2") &&
    contains(workflow, "workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}") &&
    !/credentials_json/.test(workflow),
  "el workflow entra con Workload Identity y sin una clave guardada",
);
assert.ok(
  contains(workflow, "if: vars.GCP_PROJECT_ID != ''"),
  "sin proyecto, el workflow no hace nada",
);
assert.ok(
  contains(workflow, "cancel-in-progress: false"),
  "un despliegue a la vez, sin cortar uno a medias",
);

// --- La base primero, siempre -------------------------------------------------------------
assert.ok(
  antes(workflow, "gcloud run jobs execute flash-db-migrate", "gcloud run services update"),
  "el workflow migra la base antes de publicar los servicios",
);
assert.ok(
  contains(workflow, 'gcloud run jobs execute flash-db-migrate --region "$REGION" --wait'),
  "el workflow espera a que la migración termine",
);

// --- Secretos de la base, sólo para los trabajos de la base -------------------------------
assert.ok(
  contains(deploy, 'secretos_base = toset(["POSTGRES_ADMIN_URL", "MIGRATION_DATABASE_URL",') &&
    !contains(main, '"POSTGRES_ADMIN_URL",'),
  "la clave del administrador no está entre los secretos de la API ni de los workers",
);
assert.ok(
  contains(deploy, 'account_id   = "flash-db-jobs"') &&
    contains(deploy, "service_account = google_service_account.base.email"),
  "los trabajos de la base tienen una identidad propia",
);

// --- Terraform deja la imagen al workflow, y los lotes llegan a Redis ---------------------
assert.ok(
  squeeze(cloudRun).split(
    squeeze("ignore_changes = [template[0].containers[0].image, client, client_version]"),
  ).length -
    1 ===
    2 &&
    contains(
      cloudRun,
      "ignore_changes = [template[0].template[0].containers[0].image, client, client_version]",
    ) &&
    contains(
      deploy,
      "ignore_changes = [template[0].template[0].containers[0].image, client, client_version]",
    ),
  "Terraform no vuelve a la imagen del primer arranque en la API, los workers ni los trabajos",
);
const lotes = cloudRun.slice(cloudRun.indexOf('resource "google_cloud_run_v2_job" "lote"'));
assert.ok(
  contains(lotes, 'egress = "PRIVATE_RANGES_ONLY"') &&
    contains(lotes, "vpc_access {") &&
    contains(lotes, "subnetwork = google_compute_subnetwork.flash.id"),
  "los lotes llegan a Redis por la red privada",
);

// --- El script de arranque ----------------------------------------------------------------
assert.ok(
  antes(bootstrap, 'if ($respuesta -ne "CREAR")', 'Invoke-Terraform @("apply"'),
  "pide confirmación escrita antes de crear recursos pagos",
);
assert.ok(
  contains(bootstrap, 'if ($facturacion -ne "True") { throw'),
  "no sigue si el proyecto no tiene facturación",
);
assert.ok(
  contains(
    bootstrap,
    'if (Test-SecretoCargado $nombre) { Write-Host "  $nombre ya tenía valor"; return $false }',
  ),
  "volver a correrlo no pisa un secreto que ya se usa",
);
assert.ok(
  antes(bootstrap, '"flash-db-bootstrap"', '"flash-db-migrate"') &&
    antes(bootstrap, '"flash-db-migrate"', '"-var=deploy_services=true"'),
  "prepara la base, la migra y recién después despliega los servicios",
);
assert.ok(!/db:seed/.test(bootstrap), "el despliegue no corre semillas de desarrollo");
assert.ok(
  contains(
    bootstrap,
    'throw "Producción necesita estas credenciales de terceros antes de desplegar:',
  ),
  "producción no se despliega sin las credenciales de terceros",
);

// --- La preparación de la base ------------------------------------------------------------
assert.ok(
  contains(
    preparacion,
    "`CREATE ROLE ${client.escapeIdentifier(rol)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD",
  ) &&
    contains(
      preparacion,
      'for (const extension of ["pg_trgm", "postgis", "pgcrypto", "citext"])',
    ) &&
    contains(preparacion, "ALTER DATABASE ${client.escapeIdentifier(base)} OWNER TO flash_app"),
  "la preparación crea roles sin privilegios, habilita PostGIS y le da la base a flash_app",
);

// En Cloud SQL el administrador no es superusuario: a un rol existente sólo se le cambia la
// clave (nombrar SUPERUSER o BYPASSRLS en el ALTER falla), y los atributos se verifican.
assert.ok(
  contains(
    preparacion,
    "? `ALTER ROLE ${client.escapeIdentifier(rol)} PASSWORD ${client.escapeLiteral(clave)}`",
  ) &&
    contains(
      preparacion,
      "AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolinherit OR NOT rolcanlogin)",
    ) &&
    contains(preparacion, "if (desviados.length)"),
  "un rol existente sólo cambia de clave, y un rol con privilegios de más frena la preparación",
);

// --- Volver a correr el arranque no baja lo que está corriendo -------------------------
assert.ok(
  !contains(bootstrap, '"-var=deploy_services=false"') &&
    contains(bootstrap, '"-var=deploy_services=$servicios", "-var=image=$imagenActual"') &&
    contains(bootstrap, "$desplegado = ($LASTEXITCODE -eq 0) -and [bool]$imagenActual") &&
    contains(bootstrap, '"-var=deploy_services=$servicios", "-var=image=$imagen"'),
  "con un despliegue existente, ninguna aplicación de Terraform borra los servicios ni sus trabajos",
);
assert.ok(
  antes(
    bootstrap,
    '@("flash-db-bootstrap", "flash-db-migrate")) {',
    '"run", "jobs", "execute", "flash-db-bootstrap"',
  ) && contains(bootstrap, '"run", "services", "update", $servicio'),
  "en una segunda corrida, la base se prepara con la imagen nueva y los servicios la toman",
);
assert.ok(
  contains(bootstrap, "if ($rol[1] -and -not (Test-SecretoCargado $rol[1])) {") &&
    contains(bootstrap, '@("secrets", "versions", "access", "latest", "--secret", $rol[0]'),
  "una URL de la base que quedó sin cargar se completa con la clave ya cargada, sin cambiarla",
);

// --- Cloud Build con identidad propia ----------------------------------------------------
assert.ok(
  contains(bootstrap, '"--service-account", $cuentaBuild') &&
    contains(bootstrap, '"--gcs-source-staging-dir", "gs://$bucketBuild/source"') &&
    contains(construccion, "logging: CLOUD_LOGGING_ONLY") &&
    contains(deploy, 'account_id   = "flash-build"') &&
    contains(deploy, 'member     = "serviceAccount:${google_service_account.build.email}"') &&
    contains(deploy, 'role   = "roles/storage.objectViewer"') &&
    contains(
      deploy,
      'resource "google_project_iam_member" "build_logs" { project = var.project_id role = "roles/logging.logWriter"',
    ),
  "la imagen del primer arranque se construye con una cuenta que puede leer el código, escribir logs y publicar",
);

// --- Cloud Build no sube secretos -------------------------------------------------------
assert.ok(
  contains(ignorar, "#!include:.gitignore") &&
    contains(ignorar, ".env.*") &&
    contains(ignorar, "*.tfvars"),
  "la imagen del primer arranque no sube archivos de entorno ni de variables",
);

console.log("gcp deploy contract ok");
