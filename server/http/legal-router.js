// Enlaces legales (LAN-002): dónde leer los términos y la política de privacidad.
//
// Es pública porque se muestra antes de tener cuenta: en el registro, donde quien se
// suscribe acepta los términos. Las URLs salen de la configuración del servidor y no
// del build de cada app, así cambiarlas no exige publicar una versión nueva en las
// tiendas. Sin URL configurada responde `null`, y las apps lo dicen en lugar de
// enlazar a una página que no existe.
import { Router } from "express";

import { config } from "../config.js";

export const legalRouter = Router();

legalRouter.get("/api/public/legal", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ termsUrl: config.legal.termsUrl, privacyUrl: config.legal.privacyUrl });
});
