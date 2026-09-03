/**
 * Carga local con k6 (CI-001) — sin k6 Cloud ni secrets del dueño.
 *
 * Ejercita health/ready: el camino más barato que demuestra que el binario
 * corre en nightly y que umbrales de falla/latencia se aplican. Escenarios
 * autenticados y sandbox de proveedores siguen abiertos (credenciales).
 */
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: Number(__ENV.K6_VUS || 5),
  duration: __ENV.K6_DURATION || "15s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: [`p(95)<${Number(__ENV.K6_P95_MS || 800)}`],
  },
};

const base = (__ENV.API_URL || "http://127.0.0.1:4000/api").replace(/\/$/, "");

export default function () {
  const health = http.get(`${base}/health`);
  check(health, {
    "health 200": (res) => res.status === 200,
    "health ok": (res) => {
      try {
        return res.json("ok") === true;
      } catch {
        return false;
      }
    },
  });

  const ready = http.get(`${base}/ready`);
  check(ready, {
    "ready 200 o 503": (res) => res.status === 200 || res.status === 503,
  });

  sleep(0.2);
}
