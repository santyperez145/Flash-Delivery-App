import fs from "node:fs/promises";
import YAML from "yaml";

const document = YAML.parse(await fs.readFile("observability/prometheus-rules.yml", "utf8"));
const rules = (document.groups || []).flatMap((group) => group.rules || []);
const names = new Set(rules.map((rule) => rule.alert));
for (const name of ["FlashApiFastErrorBudgetBurn","FlashApiSlowErrorBudgetBurn","FlashApiP95LatencyHigh","FlashPostgresPoolSaturated","FlashNotificationDeadLetters"]) {
  if (!names.has(name)) throw new Error(`Falta alerta ${name}`);
}
for (const rule of rules) {
  if (!rule.expr || !rule.for || !rule.labels?.severity || !rule.annotations?.runbook) throw new Error(`Alerta incompleta: ${rule.alert}`);
  if (!rule.annotations.runbook.startsWith("docs/runbooks/")) throw new Error(`Runbook fuera del repositorio: ${rule.alert}`);
  if (/email|phone|address|customer_id|user_id/i.test(rule.expr)) throw new Error(`Etiqueta sensible en PromQL: ${rule.alert}`);
}
if (!rules.some((rule) => String(rule.expr).includes("[5m]")) || !rules.some((rule) => String(rule.expr).includes("[3d]"))) throw new Error("El burn rate debe cubrir ventanas rápida y sostenida");
console.log(`ok - ${rules.length} alertas Prometheus con severidad, espera y runbook verificadas`);
