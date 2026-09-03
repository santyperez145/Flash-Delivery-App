import fs from "node:fs";
import { parse } from "yaml";

const compose = parse(fs.readFileSync("docker-compose.yml", "utf8"));
const postgres = compose.services?.postgres;
const api = compose.services?.flash;
const runtimeUrl = String(api?.environment?.DATABASE_URL || "");
const migrationUrl = String(api?.environment?.MIGRATION_DATABASE_URL || "");
const initMounts = postgres?.volumes || [];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
};

assert(
  postgres?.environment?.POSTGRES_USER === "postgres",
  "el superusuario queda limitado al bootstrap del contenedor",
);
assert(
  runtimeUrl.startsWith("postgresql://flash_runtime:"),
  "la API usa flash_runtime y no el owner del esquema",
);
assert(
  migrationUrl.startsWith("postgresql://flash_app:"),
  "el migrador recibe una conexion separada",
);
assert(runtimeUrl !== migrationUrl, "runtime y migraciones no comparten credenciales");
assert(
  initMounts.some((entry) => String(entry).includes("/docker-entrypoint-initdb.d")),
  "PostgreSQL carga el bootstrap de roles",
);

const init = fs.readFileSync("database/docker-init/001-runtime-roles.sh", "utf8");
for (const role of ["flash_app", "flash_runtime", "flash_rls_audit"])
  assert(
    init.includes(`${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`),
    `${role} queda sin privilegios administrativos ni BYPASSRLS`,
  );

// --- Imagen productiva (ticket INF-001, hallazgo H-05) ---------------------
//
// Contrato estático sobre el Dockerfile. La verificación real —construir la
// imagen y comprobar que el proceso no corre como root— vive en el job
// `container-image` de `ci-fast.yml`, que sí tiene demonio Docker.

const dockerfile = fs.readFileSync("Dockerfile", "utf8");
const stages = [...dockerfile.matchAll(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/gim)];
const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf("FROM "));

assert(stages.length >= 2, "la imagen es multi-etapa y no arrastra el toolchain de build");

const userDirective = runtimeStage.match(/^USER\s+(\S+)/m);
assert(Boolean(userDirective), "la etapa de runtime declara un USER explícito");
assert(userDirective[1] !== "root" && userDirective[1] !== "0", "el proceso no corre como root");
assert(
  /useradd|adduser/.test(runtimeStage) && new RegExp(userDirective[1]).test(runtimeStage),
  "el usuario no privilegiado se crea en la propia imagen",
);

const cmd = dockerfile.match(/^CMD\s+(.+)$/m);
assert(Boolean(cmd), "la imagen declara un CMD");
assert(
  cmd[1].includes("server/start.js"),
  "la imagen arranca el entrypoint instrumentado y no `server/index.js`",
);

const composeCommand = String(api?.command || "");
assert(
  !composeCommand || composeCommand.includes("server/start.js"),
  "Compose y la imagen arrancan el mismo entrypoint",
);

assert(
  /npm ci --omit=dev/.test(dockerfile),
  "las dependencias de producción se instalan sin devDependencies",
);
assert(
  !/^COPY \. \.\s*$/m.test(runtimeStage),
  "la etapa de runtime no copia el repositorio completo",
);

// Endurecimiento declarado en Compose. `cap_drop` y `no-new-privileges` valen
// tanto en desarrollo como en producción y no dependen del orquestador.
assert(
  (api?.cap_drop || []).map(String).includes("ALL"),
  "el contenedor de la API renuncia a todas las capabilities",
);
assert(
  (api?.security_opt || []).some((entry) => String(entry).includes("no-new-privileges")),
  "el contenedor de la API no permite escalar privilegios",
);

// Filesystem raíz de sólo lectura (ticket INF-001).
//
// Es la diferencia entre un contenedor comprometido que puede dejar algo
// escrito —un binario, una tarea, una clave— y uno que no. El endurecimiento
// anterior ya le quitaba capabilities y escalada de privilegios; sin esto, el
// proceso todavía podía escribir en cualquier parte de su propia imagen.
//
// Lo escribible queda declarado y es poco: `/tmp` y `/app/server/data`. El
// segundo es el volumen del respaldo SQLite cuando no hay `DATABASE_URL`; la
// apertura es perezosa (importar `store.js` no abre la base). Con PostgreSQL
// configurado ese fallback no se usa en runtime productivo.
assert(api?.read_only === true, "el contenedor de la API monta su raíz de sólo lectura");
assert(
  (api?.tmpfs || []).some((entry) => String(entry).startsWith("/tmp")),
  "el contenedor declara /tmp escribible en lugar de abrir la raíz entera",
);
assert(
  (api?.volumes || []).some((entry) => String(entry).includes("/app/server/data")),
  "el respaldo SQLite escribe en un volumen y no en la imagen",
);

// `npm run` escribe su caché y su log en el home, que con la raíz de sólo
// lectura no acepta escrituras. El comando invoca el script directamente.
assert(
  !String(api?.command || "").includes("npm run"),
  "el arranque no pasa por npm, que necesitaría escribir en el home",
);
