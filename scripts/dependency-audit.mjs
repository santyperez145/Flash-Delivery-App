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

// **Excepciones por aviso, nunca por paquete.** Un aviso sin versión corregida
// no se arregla actualizando, y dejar la puerta roja hasta que el mantenedor
// publique enseña a ignorarla. Pero exceptuar un paquete entero taparía también
// el próximo aviso que le salga. Por eso cada entrada nombra un aviso, dice por
// qué no se puede actualizar y qué mitiga el riesgo, y vence: pasada la fecha,
// la puerta vuelve a fallar. Una entrada que ya no corresponde a ningún aviso
// también falla, así que la lista sólo puede achicarse.
const EXCEPCIONES = JSON.parse(
  fs.readFileSync(new URL("./dependency-audit-exceptions.json", import.meta.url), "utf8"),
).excepciones;
const hoy = new Date().toISOString().slice(0, 10);
const vigentes = new Map(
  EXCEPCIONES.filter((entrada) => entrada.revisar >= hoy).map((entrada) => [
    entrada.aviso,
    entrada,
  ]),
);
const usadas = new Set();

/** Los avisos que originan la vulnerabilidad de un paquete, siguiendo la cadena. */
function avisosRaiz(vulnerabilidades, nombre, vistos = new Set()) {
  if (vistos.has(nombre)) return [];
  vistos.add(nombre);
  const dato = vulnerabilidades[nombre];
  if (!dato) return [];
  return dato.via.flatMap((via) =>
    typeof via === "string"
      ? avisosRaiz(vulnerabilidades, via, vistos)
      : ["high", "critical"].includes(via.severity)
        ? [
            String(via.url || via.source)
              .split("/")
              .pop(),
          ]
        : [],
  );
}

// Se invoca npm por su entrada de Node y no por el ejecutable del sistema.
// `npm.cmd` no se resuelve sin shell en Windows, y pasar argumentos a un shell
// los concatena sin escapar. Llamar al archivo evita las dos cosas.
// `npm_execpath` lo define npm al ejecutar un script, y apunta a su propio
// `npm-cli.js`. Es la fuente correcta porque esto siempre corre por `npm run`.
//
// Las rutas junto al ejecutable son el respaldo para cuando se invoca a mano.
// Hacen falta las dos formas: en Windows npm queda en `<node>/node_modules`, y
// en Linux un nivel más arriba, en `<node>/../lib/node_modules`. Buscar sólo la
// primera hacía fallar la puerta en el runner de CI.
const raiz = path.dirname(process.execPath);
const NPM_CLI = [
  process.env.npm_execpath,
  path.join(raiz, "node_modules", "npm", "bin", "npm-cli.js"),
  path.join(raiz, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  path.join(raiz, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
].find((candidato) => candidato && fs.existsSync(candidato));

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
  const total = Object.values(conteo).reduce((suma, valor) => suma + valor, 0);
  const vulnerabilidades = reporte.vulnerabilities ?? {};

  // Un paquete se excusa sólo si **todos** sus avisos graves están exceptuados:
  // uno solo sin excepción alcanza para que la puerta falle.
  const graves = [];
  const excusados = [];
  for (const [nombre, dato] of Object.entries(vulnerabilidades)) {
    if (dato.severity !== "high" && dato.severity !== "critical") continue;
    const raices = avisosRaiz(vulnerabilidades, nombre);
    if (raices.length && raices.every((aviso) => vigentes.has(aviso))) {
      raices.forEach((aviso) => usadas.add(aviso));
      excusados.push(nombre);
    } else graves.push(`${nombre} (${dato.severity})`);
  }

  if (graves.length) {
    problemas.push(`${alcance.etiqueta}: ${graves.length} de nivel ${NIVEL} o superior`);
    for (const grave of graves) problemas.push(`  ${grave}`);
  } else {
    const resto = total ? ` · ${total} por debajo del umbral` : "";
    const excepcion = excusados.length
      ? ` · ${excusados.length} por avisos exceptuados con fecha de revisión`
      : "";
    console.log(
      `ok - ${alcance.etiqueta}: sin vulnerabilidades ${NIVEL} o superiores${excepcion}${resto}`,
    );
  }
}

for (const entrada of EXCEPCIONES) {
  if (entrada.revisar < hoy)
    problemas.push(
      `excepción vencida el ${entrada.revisar}: ${entrada.aviso} (${entrada.paquete}) — revisá si ya hay versión corregida`,
    );
  else if (!usadas.has(entrada.aviso))
    problemas.push(
      `excepción sin uso: ${entrada.aviso} (${entrada.paquete}) ya no aparece — borrala`,
    );
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
