// Salud de un worker en bucle, para la plataforma que lo corre.
//
// Cloud Run sólo acepta un servicio que escuche en un puerto, y un worker no
// atiende tráfico: sin esto la revisión no pasa el chequeo de arranque. Pero un
// puerto que responde 200 siempre no dice nada. Este responde según el **latido**
// del bucle: si la última vuelta fue hace más de `staleAfterMs`, contesta 503 y el
// liveness probe reinicia la instancia. Un worker trabado en una consulta deja de
// latir, y eso es justo lo que hay que detectar.
//
// Sólo escucha si `WORKER_HEALTH_PORT` está definido (Terraform lo define en Cloud
// Run). En local los workers no abren ningún puerto: no chocan con la API.
import http from "node:http";

export function startWorkerHealth({ name, staleAfterMs = 5 * 60_000 }) {
  let lastBeat = Date.now();
  const beat = () => {
    lastBeat = Date.now();
  };
  const port = Number(process.env.WORKER_HEALTH_PORT);
  if (!port) return { beat, close: async () => {} };
  const server = http.createServer((_req, res) => {
    const lastBeatAgeMs = Date.now() - lastBeat;
    const ok = lastBeatAgeMs <= staleAfterMs;
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ worker: name, ok, lastBeatAgeMs }));
  });
  server.listen(port, "0.0.0.0");
  return { beat, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
