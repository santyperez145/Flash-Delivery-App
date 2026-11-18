import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { request } from "../api";

// Enlaces a los términos y a la política de privacidad (LAN-002). Las tiendas
// exigen que la política se pueda abrir desde la app, y nadie acepta unos
// términos que no puede leer.
//
// Las URLs las da el servidor (`GET /api/public/legal`), no el build: cambiarlas
// no exige publicar otra versión. **Sin URL no se inventa un enlace:** se dice
// que el documento todavía no está publicado. En producción el servidor no
// arranca sin las dos, así que ese estado sólo se ve en desarrollo.

export type EnlacesLegales = { termsUrl: string | null; privacyUrl: string | null };

export const getLegalLinks = () => request<EnlacesLegales>("/public/legal");

export function LegalLinks() {
  const [enlaces, setEnlaces] = useState<EnlacesLegales | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    getLegalLinks()
      .then((respuesta) => vigente && setEnlaces(respuesta))
      .catch(() => vigente && setError(true));
    return () => {
      vigente = false;
    };
  }, []);

  if (error)
    return (
      <p className="legal-links">No pudimos cargar los términos y la política de privacidad.</p>
    );
  if (!enlaces) return null;
  const documentos = [
    { url: enlaces.termsUrl, nombre: "Términos y condiciones" },
    { url: enlaces.privacyUrl, nombre: "Política de privacidad" },
  ];
  return (
    <nav className="legal-links" aria-label="Documentos legales">
      {documentos.map(({ url, nombre }) =>
        url ? (
          <a key={nombre} href={url} target="_blank" rel="noopener noreferrer">
            <FileText size={15} /> {nombre}
          </a>
        ) : (
          <span key={nombre}>
            <FileText size={15} /> {nombre}: todavía sin publicar
          </span>
        ),
      )}
    </nav>
  );
}
