import type { DriverDocument } from "../types";

// Cómo se llama cada documento en la Argentina y qué se sube.
export const DOCUMENTOS: Record<
  DriverDocument["type"],
  { label: string; ayuda: string; vence: boolean }
> = {
  identity: {
    label: "DNI",
    ayuda: "Frente y dorso en una misma foto, o un PDF.",
    vence: false,
  },
  background_check: {
    label: "Certificado de antecedentes penales",
    ayuda: "El que emite el Registro Nacional de Reincidencia, de los últimos 90 días.",
    vence: false,
  },
  driver_license: {
    label: "Licencia de conducir",
    ayuda: "Vigente y de la categoría de tu vehículo.",
    vence: true,
  },
  vehicle_registration: {
    label: "Cédula del vehículo",
    ayuda: "La cédula verde o azul, con su fecha de vencimiento.",
    vence: true,
  },
  insurance: {
    label: "Seguro del vehículo",
    ayuda: "La póliza con responsabilidad civil, vigente.",
    vence: true,
  },
};
