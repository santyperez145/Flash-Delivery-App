export function createGracefulShutdown({ server, realtimeClients, stopRealtimeListener, closePostgres, closeRedis, stopTelemetry, graceMs, onDrain = () => undefined, log = console }) {
  let shutdownPromise = null;
  return function shutdown(signal = "manual") {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      onDrain();
      log.info?.(`Received ${signal}. Draining Flash API.`);
      for (const [client] of realtimeClients) {
        if (!client.destroyed && !client.writableEnded) {
          client.write(`event: server.shutdown\ndata: ${JSON.stringify({ reconnect: true })}\n\n`);
          client.end();
        }
      }
      realtimeClients.clear();
      const forcedClose = setTimeout(() => {
        log.error?.(`Graceful shutdown exceeded ${graceMs}ms; closing remaining HTTP connections.`);
        server.closeAllConnections?.();
      }, graceMs);
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections?.();
      });
      clearTimeout(forcedClose);
      await stopRealtimeListener?.();
      const results = await Promise.allSettled([closePostgres(), closeRedis(), stopTelemetry()]);
      const rejected = results.filter((result) => result.status === "rejected");
      if (rejected.length) throw new AggregateError(rejected.map((result) => result.reason), "No se pudieron cerrar todos los recursos");
      log.info?.("Flash API drained successfully.");
    })();
    return shutdownPromise;
  };
}
