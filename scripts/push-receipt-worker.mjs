// Worker de recibos de push (ticket NOT-001).
//
// Expo no confirma la entrega en la respuesta del envío: devuelve un ticket y la
// confirmación llega después, consultando el recibo. Sin este worker, cada
// notificación se quedaría en `sent` para siempre y nadie sabría si llegó.
//
// Producción debe programarlo igual que `worker:notifications`.
import { config } from "../server/config.js";
import { processPostgresPushReceipts } from "../server/notification-repository.js";
import { closePostgres } from "../server/postgres.js";

if (config.notificationProvider !== "expo")
  throw new Error("Los recibos de push sólo aplican con NOTIFICATION_PROVIDER=expo");

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

do {
  const result = await processPostgresPushReceipts({});
  if (result.checked)
    console.log(JSON.stringify({ level: "info", event: "push.receipts", ...result }));
  // Un recibo desconocido no es un éxito: se deja pendiente y la alerta
  // `FlashPushReceiptsStale` lo levanta si se acumulan.
  if (result.unknown)
    console.log(
      JSON.stringify({
        level: "warn",
        event: "push.receipts_unknown",
        unknown: result.unknown,
      }),
    );
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 15_000));
} while (!stopping);

await closePostgres();
