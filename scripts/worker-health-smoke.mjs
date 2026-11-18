// Salud de los workers en bucle (infraestructura de Cloud Run, PR de infra/gcp).
//
// Cloud Run sólo acepta servicios que escuchan en un puerto; un worker no atiende
// tráfico, así que expone su latido. Esta prueba ejecuta el helper de verdad: sin
// `WORKER_HEALTH_PORT` no abre nada (en local no choca con la API), con él contesta
// 200 mientras el bucle late y 503 cuando deja de latir. Además verifica que los
// cinco workers en bucle lo usen y que Terraform les dé el puerto.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";

import { contains } from "./source-contract.mjs";
import { startWorkerHealth } from "./worker-health.mjs";

const ok = (mensaje) => console.log(`ok - ${mensaje}`);

const puertoLibre = () =>
  new Promise((resolve) => {
    const servidor = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });

delete process.env.WORKER_HEALTH_PORT;
const sinPuerto = startWorkerHealth({ name: "prueba" });
sinPuerto.beat();
await sinPuerto.close();
ok("sin WORKER_HEALTH_PORT el worker no abre ningún puerto");

const puerto = await puertoLibre();
process.env.WORKER_HEALTH_PORT = String(puerto);
const salud = startWorkerHealth({ name: "prueba", staleAfterMs: 150 });
try {
  await new Promise((resolve) => setTimeout(resolve, 50));
  const vivo = await fetch(`http://127.0.0.1:${puerto}/`);
  assert.equal(vivo.status, 200, "un worker que late no contesta 200");
  assert.equal((await vivo.json()).worker, "prueba");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const trabado = await fetch(`http://127.0.0.1:${puerto}/`);
  assert.equal(trabado.status, 503, "un worker que dejó de latir sigue contestando 200");
  salud.beat();
  assert.equal((await fetch(`http://127.0.0.1:${puerto}/`)).status, 200, "el latido no recupera");
} finally {
  await salud.close();
  delete process.env.WORKER_HEALTH_PORT;
}
ok("contesta 200 mientras el bucle late y 503 cuando se traba");

for (const worker of [
  "dispatch-worker",
  "notification-worker",
  "push-receipt-worker",
  "pricing-worker",
  "support-worker",
]) {
  const fuente = await fs.readFile(`scripts/${worker}.mjs`, "utf8");
  assert.ok(
    contains(fuente, "const salud = startWorkerHealth({") &&
      contains(fuente, "do { salud.beat();") &&
      contains(fuente, "await salud.close();"),
    `${worker} no informa su latido en cada vuelta`,
  );
}
ok("los cinco workers en bucle laten en cada vuelta y cierran el puerto al salir");

const terraform = await fs.readFile("infra/gcp/cloud_run.tf", "utf8");
assert.ok(
  contains(terraform, 'name = "WORKER_HEALTH_PORT"') &&
    contains(terraform, "container_port = local.puerto_salud_worker") &&
    contains(terraform, "liveness_probe {"),
  "Terraform no le da a los workers el puerto de salud o el liveness",
);
ok("Terraform les da el puerto y los reinicia si dejan de latir");
