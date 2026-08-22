import fs from "node:fs";
import path from "node:path";

const manifestPath = path.join("dist", ".vite", "manifest.json");
if (!fs.existsSync(manifestPath)) throw new Error("Falta dist/.vite/manifest.json; ejecutá npm run build primero");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry?.file) throw new Error("El manifest no declara un entry web");

const bytes = (file) => fs.statSync(path.join("dist", file)).size;
const entryBytes = bytes(entry.file);
const initialFiles = new Set([entry.file, ...(entry.imports || []).map((key) => manifest[key]?.file).filter(Boolean)]);
const initialBytes = [...initialFiles].reduce((total, file) => total + bytes(file), 0);
const format = (value) => `${(value / 1024).toFixed(1)} KiB`;

if (entryBytes > 560 * 1024)
  throw new Error(`El entry propio pesa ${format(entryBytes)}; presupuesto 560 KiB`);
if (initialBytes > 850 * 1024)
  throw new Error(`La carga JS inicial pesa ${format(initialBytes)}; presupuesto 850 KiB`);

console.log(`ok - entry ${format(entryBytes)}; JS inicial ${format(initialBytes)} en ${initialFiles.size} chunks cacheables`);
