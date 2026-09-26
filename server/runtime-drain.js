/** Estado de drenado del proceso (readiness + graceful shutdown). */
let draining = false;

export function isDraining() {
  return draining;
}

export function beginDrain() {
  draining = true;
}
