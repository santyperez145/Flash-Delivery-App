// Auditoría de dependencias, de producción y de desarrollo (ticket INF-001).
//
// Antes esto era una línea en `package.json` con dos `npm audit --omit=dev`.
// Auditaba sólo lo que se despliega, que es la pregunta correcta para decidir
// si un despliegue es seguro, pero deja fuera todo lo que corre en la máquina
// de quien desarrolla y en el runner de CI: el empaquetador, el formateador, el
// navegador de pruebas. Un compromiso ahí llega igual al artefacto, sólo que
// por el camino de la construcción en lugar del de la ejecución.
//
// La razón concreta de ampliarlo ahora: `react`, `react-dom`, `lucide-react`,
// `maplibre-gl` y el SDK de Mercado Pago están declarados como dependencias de
// producción aunque el servidor no importe ninguno. Moverlos a desarrollo saca
// 380 MiB de imagen del artefacto productivo, pero con la puerta anterior los
// habría sacado también de la auditoría. **Primero se amplía la puerta y después
// se mueven**, nunca al revés: cambiar tamaño por cobertura de auditoría no es
// una mejora.
//
// Los dos alcances se reportan por separado a propósito. Son preguntas
// distintas —«¿es seguro lo que desplegamos?» y «¿es seguro lo que usamos para
// construirlo?»— y mezclarlas haría que una vulnerabilidad en el empaquetador
// se leyera como un problema de producción, o al revés.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const NIVEL = "high";

// Se invoca npm por su entrada de Node y no por el ejecutable del sistema.
// `npm.cmd` no se resuelve sin shell en Windows, y pasar argumentos a un shell
// los concatena sin escapar. Llamar al archivo evita las dos cosas.
const NPM_CLI = [
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  path.join(path.dirname(process.execPath), "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((candidato) => fs.existsSync(candidato));

if (!NPM_CLI) throw new Error("No se encontró el CLI de npm junto al ejecutable de Node");

const ALCANCES = [
  { etiqueta: "raíz · producción", prefijo: ".", omitirDev: true },
  { etiqueta: "raíz · desarrollo", prefijo: ".", omitirDev: false },
  { etiqueta: "móvil · producción", prefijo: "apps/mobile", omitirDev: true },
  { etiqueta: "móvil · desarrollo", prefijo: "apps/mobile", omitirDev: false },
];

function auditar({ prefijo, omitirDev }) {
  const argumentos = ["--prefix", prefijo, "audit", "--json"];
  if (omitirDev) argumentos.push("--omit=dev");
  try {
    // `npm audit` sale con código 1 cuando encuentra algo, así que el resultado
    // se lee del JSON y no del código de salida.
    const salida = execFileSync(process.execPath, [NPM_CLI, ...argumentos], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(salida);
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const problemas = [];
for (const alcance of ALCANCES) {
  const reporte = auditar(alcance);
  const conteo = reporte.metadata?.vulnerabilities ?? {};
  const graves = (conteo.high ?? 0) + (conteo.critical ?? 0);
  const total = Object.values(conteo).reduce((suma, valor) => suma + valor, 0);

  if (graves > 0) {
    problemas.push(`${alcance.etiqueta}: ${graves} de nivel ${NIVEL} o superior`);
    for (const [nombre, dato] of Object.entries(reporte.vulnerabilities ?? {})) {
      if (dato.severity === "high" || dato.severity === "critical") {
        problemas.push(`  ${nombre} (${dato.severity})`);
      }
    }
  } else {
    const resto = total ? ` · ${total} por debajo del umbral` : "";
    console.log(`ok - ${alcance.etiqueta}: sin vulnerabilidades ${NIVEL} o superiores${resto}`);
  }
}

if (problemas.length) {
  console.error(`\nVulnerabilidades de nivel ${NIVEL} o superior:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  console.error(
    "\nActualizá el paquete, o dejá escrito por qué no se puede y qué mitiga el riesgo.",
  );
  process.exit(1);
}

console.log(`\nok - ${ALCANCES.length} alcances auditados: producción y desarrollo, raíz y móvil`);
