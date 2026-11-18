// El parser JSON de la API, con el límite según la ruta.
//
// 1 MB alcanza para todo, salvo las evidencias de entrega: una foto o una firma
// llega en base64 y el repositorio acepta hasta 1,5 MB de imagen, que en base64
// son unos 2 MB. Con el límite global de 1 MB, una foto de cámara se rechazaba
// antes de llegar a la ruta, en envíos (POST /api/shipments/:id/delivery-evidence)
// y en pedidos dejados en la puerta (POST /api/orders/:id/delivery-photo, P-02b).
// El límite grande vale sólo para esas dos rutas.
import express from "express";

const conservarCuerpo = (req, _res, buffer) => {
  req.rawBody = Buffer.from(buffer);
};
const normal = express.json({ limit: "1mb", verify: conservarCuerpo });
const evidencia = express.json({ limit: "2200kb", verify: conservarCuerpo });
const RUTAS_DE_EVIDENCIA = [
  /^\/api\/shipments\/[^/]+\/delivery-evidence$/,
  /^\/api\/orders\/[^/]+\/delivery-photo$/,
];

export const jsonBody = (req, res, next) =>
  (RUTAS_DE_EVIDENCIA.some((ruta) => ruta.test(req.path)) ? evidencia : normal)(req, res, next);
