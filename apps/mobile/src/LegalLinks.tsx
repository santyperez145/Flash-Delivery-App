import { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { request } from "./api";
import { flashDesign } from "./design-system";

// Enlaces a los términos y a la política de privacidad (LAN-002). Mismo
// contrato que `src/ui/LegalLinks.tsx` de la web: las URLs las da el servidor
// (`GET /api/public/legal`), así cambiarlas no exige publicar otra versión en las
// tiendas, y **sin URL no se inventa un enlace**: se dice que el documento
// todavía no está publicado. En producción el servidor no arranca sin las dos.
//
// `aceptacion` es el texto del registro: sólo dice «aceptás» cuando los dos
// documentos existen, porque nadie acepta lo que no puede leer.

export type EnlacesLegales = { termsUrl: string | null; privacyUrl: string | null };

export const getLegalLinks = () => request<EnlacesLegales>("/public/legal");

function useEnlacesLegales() {
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
  return { enlaces, error };
}

function Enlace({ url, children }: { url: string; children: string }) {
  return (
    <Text
      style={estilos.enlace}
      accessibilityRole="link"
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
    >
      {children}
    </Text>
  );
}

export function LegalLinks({
  variante = "lista",
  style,
}: {
  variante?: "lista" | "aceptacion";
  style?: StyleProp<TextStyle>;
}) {
  const { enlaces, error } = useEnlacesLegales();
  if (error)
    return (
      <Text style={[estilos.texto, style]}>
        No pudimos cargar los términos y la política de privacidad.
      </Text>
    );
  if (!enlaces) return null;
  const { termsUrl, privacyUrl } = enlaces;
  if (variante === "aceptacion")
    return termsUrl && privacyUrl ? (
      <Text style={[estilos.texto, style]}>
        Al continuar aceptás los <Enlace url={termsUrl}>Términos</Enlace> y reconocés la{" "}
        <Enlace url={privacyUrl}>Política de privacidad</Enlace> de Flash.
      </Text>
    ) : (
      <Text style={[estilos.texto, style]}>
        Los Términos y la Política de privacidad de Flash todavía no están publicados.
      </Text>
    );
  return (
    <Text style={[estilos.texto, estilos.lista, style]} accessibilityRole="text">
      {termsUrl ? (
        <Enlace url={termsUrl}>Términos y condiciones</Enlace>
      ) : (
        "Términos y condiciones: todavía sin publicar"
      )}
      {"   ·   "}
      {privacyUrl ? (
        <Enlace url={privacyUrl}>Política de privacidad</Enlace>
      ) : (
        "Política de privacidad: todavía sin publicar"
      )}
    </Text>
  );
}

const estilos = StyleSheet.create({
  texto: { color: flashDesign.color.inkSoft, fontSize: 12, lineHeight: 18 },
  lista: { marginHorizontal: flashDesign.space.md, marginTop: 18 },
  enlace: { color: flashDesign.color.ink, fontWeight: "700", textDecorationLine: "underline" },
});
