// Qué orígenes web son de fiar (ticket ARC-001).
//
// Se extrajo al sacar el router de credenciales, que necesita
// `requireTrustedWebOrigin` para `POST /api/me/sessions/revoke-others`.
//
// Esa ruta lo lleva explícito y las quince de `/api/auth` no, porque a esas las
// cubre un `app.use("/api/auth", requireTrustedWebOrigin)`. La excepción existe
// por el mismo motivo por el que la ruta estaba archivada lejos de su familia:
// vive bajo `/api/me`, así que el montaje por prefijo no la alcanza. Revocar
// todas las demás sesiones desde otro sitio es exactamente lo que hay que
// impedir.
//
// **La guarda sólo aplica a clientes web.** Un pedido sin `x-flash-client: web`
// pasa de largo: una aplicación móvil no tiene origen ni `Sec-Fetch-Site`, y
// exigírselos la dejaría afuera. La protección que importa acá es contra el
// navegador de la víctima, que sí manda las dos cosas.
//
// `isSameOrigin` compara protocolo y host contra los del propio pedido, así que
// el frente servido por el mismo proceso no necesita figurar en `CORS_ORIGINS`.
// Sin eso, cada despliegue nuevo tendría que acordarse de listarse a sí mismo.
import { config } from "../config.js";
import { fail } from "./responses.js";

export function isSameOrigin(req, origin) {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === `${req.protocol}:` && parsed.host === req.get("host");
  } catch {
    return false;
  }
}

export function isAllowedOrigin(req, origin) {
  return (
    !origin ||
    config.corsOrigins.includes("*") ||
    config.corsOrigins.includes(origin) ||
    isSameOrigin(req, origin)
  );
}

export function requireTrustedWebOrigin(req, res, next) {
  if (req.get("x-flash-client") !== "web") return next();
  const origin = req.get("origin");
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return fail(res, 403, "Solicitud web cross-site rechazada");
  }
  if (!isAllowedOrigin(req, origin)) {
    return fail(res, 403, "Origen web no permitido");
  }
  return next();
}
