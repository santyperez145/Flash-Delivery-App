// Cada build móvil contiene una sola pantalla (ticket ARC-001).
//
// Los dos criterios de build del ticket —«el build de driver no incluye
// pantallas de comercio», «el build de customer no incluye backoffice»— no se
// pueden verificar leyendo el código: dependen de qué módulos alcanza el
// empaquetador, y eso lo decide `metro.config.js` con
// `EXPO_PUBLIC_APP_VARIANT`.
//
// Así que esta puerta empaqueta de verdad. Corre `expo export` tres veces, una
// por variante, y busca en el bytecode Hermes resultante una cadena propia de
// cada pantalla. Lo que tiene que salir es una diagonal: cada bundle con la
// suya y sin las otras dos.
//
// **Los marcadores son ASCII a propósito.** El primer intento usó «Abrir guía
// operativa del conductor» y dio ausente en el bundle que sí contenía esa
// pantalla: Hermes no guarda las cadenas con caracteres no ASCII de forma que
// `grep` sobre el binario encuentre. Un marcador con tilde convierte esta
// puerta en una que pasa siempre, que es peor que no tenerla.
//
// Por eso también se comprueba primero que cada marcador siga existiendo y siga
// siendo único. Si alguien reescribe el texto de la interfaz, esto falla
// pidiendo un marcador nuevo en lugar de dar verde sobre una búsqueda vacía.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MOBILE = "apps/mobile";
const MARCADORES = [
  { variante: "customer", pantalla: "CustomerScreen", marcador: "Activar Seguridad Flash" },
  { variante: "driver", pantalla: "DriverScreen", marcador: "ACTIVIDAD OBSERVADA" },
  { variante: "merchant", pantalla: "MerchantScreen", marcador: "Abierto y recibiendo" },
];

const problemas = [];
const check = (condicion, etiqueta) => {
  if (condicion) console.log(`ok - ${etiqueta}`);
  else problemas.push(etiqueta);
};

for (const { pantalla, marcador } of MARCADORES) {
  check(
    /^[\x20-\x7e]+$/.test(marcador),
    `el marcador de ${pantalla} es ASCII y Hermes lo conserva buscable`,
  );
  const fuente = fs.readFileSync(path.posix.join(MOBILE, "src/screens", `${pantalla}.tsx`), "utf8");
  check(fuente.includes(marcador), `el marcador de ${pantalla} sigue existiendo en su pantalla`);
  for (const otra of MARCADORES) {
    if (otra.pantalla === pantalla) continue;
    const vecina = fs.readFileSync(
      path.posix.join(MOBILE, "src/screens", `${otra.pantalla}.tsx`),
      "utf8",
    );
    check(
      !vecina.includes(marcador),
      `el marcador de ${pantalla} no aparece también en ${otra.pantalla}`,
    );
  }
}

if (problemas.length) {
  console.error(`\n${problemas.length} marcador(es) dejaron de servir:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  console.error("\nElegí una cadena ASCII que exista sólo en esa pantalla y actualizá MARCADORES.");
  process.exit(1);
}

const salida = fs.mkdtempSync(path.join(os.tmpdir(), "flash-variantes-"));
try {
  for (const { variante } of MARCADORES) {
    console.log(`\n--- empaquetando ${variante} ---`);
    // Se invoca el CLI de Expo por su entrada de Node y no por `npx`. Con
    // `shell: true` Node avisa que concatena argumentos sin escapar, y sin shell
    // no resuelve `npx.cmd` en Windows. Llamar al archivo evita las dos cosas y
    // además se saltea la resolución de npx en cada corrida.
    execFileSync(
      process.execPath,
      [
        path.resolve(MOBILE, "node_modules", "expo", "bin", "cli"),
        "export",
        "--platform",
        "android",
        "--output-dir",
        path.join(salida, variante),
        "--no-minify",
      ],
      {
        cwd: MOBILE,
        env: { ...process.env, EXPO_PUBLIC_APP_VARIANT: variante },
        stdio: ["ignore", "ignore", "inherit"],
      },
    );
  }

  for (const { variante } of MARCADORES) {
    const raiz = path.join(salida, variante, "_expo", "static", "js", "android");
    const archivos = fs.readdirSync(raiz).filter((archivo) => archivo.endsWith(".hbc"));
    if (archivos.length !== 1)
      throw new Error(`${variante}: se esperaba un bundle y hay ${archivos.length}`);
    const bytecode = fs.readFileSync(path.join(raiz, archivos[0]), "latin1");
    const tamaño = (fs.statSync(path.join(raiz, archivos[0])).size / 1048576).toFixed(1);

    for (const { variante: otra, pantalla, marcador } of MARCADORES) {
      const presente = bytecode.includes(marcador);
      if (otra === variante)
        check(presente, `el bundle de ${variante} (${tamaño} MB) contiene ${pantalla}`);
      else check(!presente, `el bundle de ${variante} no contiene ${pantalla}`);
    }
  }
} finally {
  fs.rmSync(salida, { recursive: true, force: true });
}

if (problemas.length) {
  console.error(`\n${problemas.length} comprobación(es) fallaron:\n`);
  for (const problema of problemas) console.error(`  - ${problema}`);
  console.error("\nUna pantalla en el bundle equivocado significa que `metro.config.js` dejó de");
  console.error("cortar el grafo, o que alguien volvió a importar la pantalla desde `App.tsx`.");
  process.exit(1);
}
console.log("\nok - cada variante empaqueta su pantalla y ninguna de las otras dos");
