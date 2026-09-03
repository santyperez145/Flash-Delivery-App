// Cobertura de puertas CI (ticket CI-001).
//
// Verifica que cada script `test:*` declarado en package.json esté referenciado
// por algún workflow, o exceptuado explícitamente acá con su motivo.
//
// Existe porque el hallazgo H-01 fue precisamente ese: 104 scripts declarados y
// 15 ejecutados, sin que nada lo hiciera evidente. Una suite que se escribe y no
// se conecta a una puerta no protege nada, y el olvido es silencioso.
import fs from "node:fs/promises";

const WORKFLOWS_DIR = ".github/workflows";

// Excepciones deliberadas. Cada entrada necesita un motivo: si no se puede
// escribir uno, la suite va a una puerta.
const EXCLUDED = new Map([
  ["test:security", "corre dentro de `npm run check`, que sí está en ci-fast"],
  [
    "test:mobile-location-permission",
    "corre dentro de `test:mobile-build-variants`, que sí está en ci-fast",
  ],
]);

// Nocturnas: tienen puerta —`ci-nightly.yml`— pero no bloquean un merge, y por
// eso no pueden contarse junto a las que sí.
//
// La distinción importa porque el número que este script publica se usa para
// decir cuánto protege CI. Meter una suite nocturna en ese total diría que un
// PR queda bloqueado por algo que en realidad corre ocho horas después.
//
// Las dos están acá por motivos distintos y los dos son legítimos: una mide
// latencia en un runner compartido, la otra necesita tres servidores y un
// bundle de Expo por variante.
const NIGHTLY = new Map([
  ["test:performance", "mide latencia: sensible al ruido del runner"],
  ["test:responsive-browser", "navegador real, tres servidores y un bundle por variante"],
]);

// Cuarentena: suites conectadas a una puerta pero declaradas no bloqueantes.
// No son una excepción — siguen corriendo y su resultado se publica — pero la
// deuda tiene que decirse en voz alta en cada corrida, no quedar escondida en
// un `continue-on-error` del YAML.
// Vacía desde el 27-08. Se deja el mecanismo porque la cuarentena es la forma
// honesta de tener una suite rota —corre, se publica y se nombra— frente a la
// alternativa de borrarla del pipeline.
//
// Con una advertencia ganada a pulso: **una causa anotada con cautela se lee
// después como un hecho**. Ninguna de las cuatro causas que pasaron por acá
// sobrevivió al contacto con la evidencia, y la última mandó a buscar durante un
// mes un defecto de concurrencia que no existía —a la suite le faltaba una
// cabecera—. Lo que se escriba acá debería decir qué se midió, no qué se supone.
const QUARANTINED = new Map();

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const suites = Object.keys(pkg.scripts).filter((name) => name.startsWith("test:"));

const files = await fs.readdir(WORKFLOWS_DIR);
const workflows = await Promise.all(
  files.map((file) => fs.readFile(`${WORKFLOWS_DIR}/${file}`, "utf8")),
);
const combined = workflows.join("\n");

// Una suite cuenta como cubierta si aparece invocada directamente o listada en
// un bucle de suites, sea una por línea o varias en la misma línea.
const referenced = (suite) => {
  if (combined.includes(`npm run ${suite}`)) return true;
  const escaped = suite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // El nombre debe aparecer como token completo. Un `test:driver` no puede
  // dar por cubierto a `test:driver-kyc`, y el token puede terminar en `;`
  // cuando se lista dentro de un `for ... do`.
  return new RegExp(`(^|[\\s"'])${escaped}(?![\\w:-])`, "m").test(combined);
};

const uncovered = [];
const staleExclusions = [];

for (const suite of suites) {
  if (EXCLUDED.has(suite)) {
    if (referenced(suite)) staleExclusions.push(suite);
    continue;
  }
  // Una nocturna sí tiene que estar referenciada: si no, no corre en ningún
  // lado y la etiqueta la estaría encubriendo.
  if (!referenced(suite)) uncovered.push(suite);
}

const nightlyHuerfanas = [...NIGHTLY.keys()].filter(
  (suite) => !suites.includes(suite) || !referenced(suite),
);

for (const suite of EXCLUDED.keys()) {
  if (!suites.includes(suite)) staleExclusions.push(`${suite} (ya no existe)`);
}

if (uncovered.length) {
  console.error(`${uncovered.length} suite(s) sin puerta CI:\n`);
  for (const suite of uncovered) console.error(`  - ${suite}`);
  console.error("\nConectala a un workflow, o agregala a EXCLUDED en este archivo con su motivo.");
  process.exit(1);
}

if (staleExclusions.length) {
  console.error("Excepciones obsoletas: la suite ya está cubierta o no existe.\n");
  for (const suite of staleExclusions) console.error(`  - ${suite}`);
  console.error("\nQuitala de EXCLUDED.");
  process.exit(1);
}

if (nightlyHuerfanas.length) {
  console.error(`Suites nocturnas sin workflow que las corra: ${nightlyHuerfanas.join(", ")}`);
  console.error("Conectalas a `ci-nightly.yml` o sacalas de NIGHTLY.");
  process.exit(1);
}

const staleQuarantine = [...QUARANTINED.keys()].filter((suite) => !suites.includes(suite));
if (staleQuarantine.length) {
  console.error(`Cuarentena obsoleta, la suite ya no existe: ${staleQuarantine.join(", ")}`);
  process.exit(1);
}

const covered = suites.length - EXCLUDED.size;
const blocking = covered - QUARANTINED.size - NIGHTLY.size;
console.log(`ok - ${covered} de ${suites.length} suites en una puerta CI`);
console.log(
  `     ${blocking} bloquean el merge, ${NIGHTLY.size} nocturnas, ${QUARANTINED.size} en cuarentena`,
);
for (const [suite, reason] of EXCLUDED) console.log(`     excepción:  ${suite} — ${reason}`);
for (const [suite, reason] of NIGHTLY) console.log(`     nocturna:   ${suite} — ${reason}`);
for (const [suite, reason] of QUARANTINED) console.log(`     cuarentena: ${suite} — ${reason}`);

// ---------------------------------------------------------------------------
// La otra mitad de «existe y algo lo corre»: los lotes operativos.
//
// Una suite que no esta en ningun workflow no protege nada — eso es lo que
// verifica el resto de este archivo. Un lote sin punto de entrada desatendido
// tampoco corre nunca, y es peor: la suite silenciosa deja pasar un defecto, el
// lote silencioso **es** el defecto.
//
// > **Correccion del 28-08.** La primera version de esta puerta afirmaba que el
// > despacho, las notificaciones y el SLA de soporte **no tenian** punto de
// > entrada, y creaba uno nuevo. Era falso: `worker:dispatch`,
// > `worker:notifications` y `worker:support` existian desde antes, con bucle
// > propio, backoff y apagado ordenado, y estaban documentados en
// > `docs/operations.md`. El error fue buscar solo `job:*` y `setInterval`,
// > encontrar lo que se esperaba, y escribirlo como hecho. El trabajo duplicado
// > se borro; la puerta se quedo, apuntando a lo que si existe.
const LOTES_DESATENDIDOS = new Map([
  ["processPostgresDispatchBatch", "worker:dispatch"],
  ["processPostgresNotificationBatch", "worker:notifications"],
  ["processSupportQueue", "worker:support"],
  ["scanPaymentReconciliation", "job:payment-reconciliation"],
]);

// **Los comentarios no cuentan.** La primera version de esta comprobacion usaba
// `includes`, y al falsificarla —sacando la llamada del lote— siguio pasando: el
// nombre seguia estando en el comentario de cabecera del propio trabajo. Una
// puerta que se satisface con una mencion en prosa no verifica nada.
const sinComentarios = (fuente) =>
  fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const puntosDeEntrada = Object.keys(pkg.scripts).filter(
  (name) => name.startsWith("job:") || name.startsWith("worker:"),
);
const fuentesDeEntrada = await Promise.all(
  puntosDeEntrada.map(async (name) => ({
    name,
    // El script apunta a un `.mjs` de `scripts/`; se lee ese archivo para
    // comprobar que efectivamente invoque el lote, y no solo que exista un
    // script con nombre parecido.
    source: sinComentarios(
      await fs
        .readFile(pkg.scripts[name].match(/scripts\/[\w-]+\.mjs/)?.[0] ?? "package.json", "utf8")
        .catch(() => ""),
    ),
  })),
);

const lotesSinEntrada = [];
for (const [lote, entradaEsperada] of LOTES_DESATENDIDOS) {
  const entrada = fuentesDeEntrada.find((candidata) => candidata.name === entradaEsperada);
  // En posicion de llamada, no en cualquier lado: importar el lote y no
  // invocarlo es exactamente el estado que esta puerta viene a cerrar.
  if (!entrada || !new RegExp(`${lote}\\s*\\(`).test(entrada.source))
    lotesSinEntrada.push(`${lote} → ${entradaEsperada}`);
}

// Un planificador dentro del servidor es la otra forma de equivocarse aca, y es
// la que parece bien mientras hay una sola replica: corre una vez por replica y
// no sobrevive a un reinicio en el momento equivocado.
const servidor = await fs.readdir("server", { recursive: true });
const modulosServidor = servidor.filter((nombre) => String(nombre).endsWith(".js"));
const conTemporizador = [];
for (const modulo of modulosServidor) {
  const fuente = sinComentarios(await fs.readFile(`server/${modulo}`, "utf8"));
  // Se mira la vecindad del `setInterval`, no un patron que tenga que cruzar
  // parentesis: `setInterval(() => procesarLote(...))` tiene un `()` en el
  // medio, y un `[^)]*` no lo pasa. La primera version fallo justo ahi.
  for (const temporizador of fuente.matchAll(/set(?:Interval|Timeout)\(/g)) {
    const vecindad = fuente.slice(temporizador.index, temporizador.index + 240);
    for (const [lote] of LOTES_DESATENDIDOS)
      if (vecindad.includes(lote) && !conTemporizador.includes(modulo))
        conTemporizador.push(modulo);
  }
}

if (lotesSinEntrada.length || conTemporizador.length) {
  if (lotesSinEntrada.length) {
    console.error("\nLote(s) operativo(s) sin punto de entrada desatendido:\n");
    for (const linea of lotesSinEntrada) console.error(`  ${linea}`);
    console.error("\nUn lote que solo se dispara desde una ruta de admin corre cuando alguien");
    console.error("se acuerda. Sin planificador, el pedido se cobra y se queda quieto.");
  }
  if (conTemporizador.length) {
    console.error("\nLote(s) programado(s) dentro del servidor:\n");
    for (const modulo of conTemporizador) console.error(`  ${modulo}`);
    console.error("\nUn `setInterval` en proceso corre una vez por replica y no sobrevive a");
    console.error("un reinicio. El planificador es del entorno que despliega.");
  }
  process.exit(1);
}
console.log(
  `\nok - ${LOTES_DESATENDIDOS.size} lote(s) operativo(s) tienen punto de entrada desatendido`,
);
console.log(`     invocables como: ${[...new Set(LOTES_DESATENDIDOS.values())].join(", ")}`);
