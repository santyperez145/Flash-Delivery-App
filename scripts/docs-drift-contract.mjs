// Las cifras de la documentación tienen que seguir siendo ciertas (H-10).
//
// El hallazgo H-10 de la auditoría —«documentación desalineada del runtime»— es
// el único de los once que **no tiene ticket**, y su ejemplo principal ya derivó
// dos veces: `ROADMAP.MD` decía «migraciones hasta 105», se corrigió a 110, y
// hoy hay 122.
//
// No es un problema de prolijidad. Es la misma falla que apareció en todo lo
// demás durante la semana: una causa de cuarentena que resultó falsa, notas de
// deuda RLS más restrictivas que el esquema, un criterio cumplido y sin marcar,
// la matriz declarando una capacidad respaldada por otra prueba. **Un número
// escrito una vez se lee después como un hecho vigente**, y decidir sobre él
// sale caro.
//
// Lo que se puede automatizar es la parte mecánica: una cifra que el repositorio
// puede calcular no debería poder mentir.
//
// **La distinción que hace difícil esto.** Una afirmación puede ser historia
// correcta: la auditoría dice «110 migraciones» y lo era, el 25 de agosto.
// Reescribirla para que diga 122 destruiría el registro y además la volvería
// falsa. Por eso la regla no es «todos los números tienen que ser el de hoy»
// sino:
//
//   una cifra vale si coincide con la realidad **o** si su línea declara cuándo
//   fue cierta.
//
// Eso obliga a escribir la distinción en lugar de dejarla implícita, que es
// exactamente la cura para H-10. Un número sin fecha es una afirmación sobre
// hoy; con fecha, es historia.
import fs from "node:fs/promises";
import path from "node:path";

// El documento de auditoría queda fuera entero: es un registro fechado por
// construcción —lo dice su título y su encabezado— y cada cifra suya describe el
// día que se escribió.
const EXCLUIDOS = new Set(["docs/auditoria-2026-08-25.md"]);

// Una línea que declara cuándo fue cierta su cifra.
//
// La forma de día y mes no exige preposición: «el 25 de agosto» es como se
// escribe, y la primera versión sólo aceptaba «al». La puerta cazó su propia
// documentación con eso, que es la forma barata de descubrir que una regla
// obliga a redactar raro. Una regla que fuerza una redacción incómoda se
// termina rodeando.
const MESES =
  "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";
const FECHADA = new RegExp(
  [
    String.raw`\bal\s+\d{1,2}[-/]\d{1,2}\b`,
    String.raw`\b\d{1,2}\s+de\s+(?:${MESES})\b`,
    String.raw`\bdec[íi]a\b`,
    String.raw`\bhab[íi]a\b`,
    String.raw`\beran\b`,
  ].join("|"),
  "i",
);

const RAICES = ["docs", "ROADMAP.MD", "README.md", "AGENTS.md"];

async function documentos(entrada) {
  const stat = await fs.stat(entrada).catch(() => null);
  if (!stat) return [];
  if (stat.isFile()) return /\.mdx?$/i.test(entrada) ? [entrada] : [];
  const hijos = await fs.readdir(entrada);
  const anidados = await Promise.all(
    hijos.map((hijo) => documentos(path.posix.join(entrada, hijo))),
  );
  return anidados.flat();
}

const migraciones = (await fs.readdir("database/migrations")).filter((n) =>
  n.endsWith(".sql"),
).length;
const paquete = JSON.parse(await fs.readFile("package.json", "utf8"));
const suites = Object.keys(paquete.scripts).filter((n) => n.startsWith("test:")).length;

// Cada hecho: cómo se escribe en prosa y cuál es su valor real. Se agregan de a
// uno y sólo si el repositorio puede calcularlos: una puerta que adivina produce
// fallos falsos, y un fallo falso enseña a ignorar la puerta.
const HECHOS = [
  {
    nombre: "migraciones",
    real: migraciones,
    patron: /(\d+)\s+migraciones/gi,
  },
  {
    nombre: "suites de prueba",
    real: suites,
    // Se busca la forma «N de M suites», donde M es el total. La forma suelta
    // «N suites» aparece en frases donde N es un subconjunto —«las 31 suites de
    // flujos críticos»— y contarla daría un falso positivo por cada una.
    patron: /\d+\s+de\s+(\d+)\s+suites/gi,
  },
];

const desviaciones = [];
for (const archivo of (await Promise.all(RAICES.map(documentos))).flat()) {
  if (EXCLUIDOS.has(archivo)) continue;
  const lineas = (await fs.readFile(archivo, "utf8")).split(/\r?\n/);
  lineas.forEach((linea, indice) => {
    if (FECHADA.test(linea)) return;
    for (const hecho of HECHOS) {
      hecho.patron.lastIndex = 0;
      for (const coincidencia of linea.matchAll(hecho.patron)) {
        const dicho = Number(coincidencia[1]);
        if (dicho === hecho.real) continue;
        desviaciones.push({
          archivo,
          linea: indice + 1,
          hecho: hecho.nombre,
          dicho,
          real: hecho.real,
          texto: coincidencia[0],
        });
      }
    }
  });
}

console.log(`hechos verificados: ${migraciones} migraciones, ${suites} suites`);

if (desviaciones.length) {
  console.error(`\n${desviaciones.length} cifra(s) de la documentación ya no son ciertas:\n`);
  for (const d of desviaciones) {
    console.error(`  ${d.archivo}:${d.linea}  «${d.texto}» — hoy son ${d.real}`);
  }
  console.error("\nSi la cifra describe el estado de hoy, actualizala.");
  console.error("Si describe lo que era cierto en un momento, decí cuándo: «al 25-08» o «el 25");
  console.error("de agosto». Una cifra sin fecha es una afirmación sobre hoy.");
  process.exit(1);
}

console.log("\nok - las cifras verificables de la documentación coinciden con el repositorio");
