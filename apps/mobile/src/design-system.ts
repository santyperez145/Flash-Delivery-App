export const flashDesign = {
  color: {
    brand: "#7C3CFF",
    brandDeep: "#5E28D6",
    food: "#FF6A21",
    foodDeep: "#D84D0D",
    ride: "#6D35E0",
    shipment: "#087A50",
    ink: "#17131C",
    inkSoft: "#746E78",
    muted: "#9A949E",
    canvas: "#F7F5F8",
    surface: "#FFFFFF",
    surfaceMuted: "#F2EFF4",
    line: "#E9E5EC",
    successSoft: "#E8F7F0",
    warningSoft: "#FFF2E8",
    danger: "#B42318",
  },
  space: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
  radius: {
    control: 12,
    card: 18,
    surface: 24,
    sheet: 30,
    pill: 999,
  },
  type: {
    display: 30,
    title: 24,
    section: 18,
    body: 14,
    metadata: 12,
  },
  control: {
    touch: 44,
    primaryHeight: 50,
  },
} as const;

export type FlashService = "food" | "ride" | "shipment";

export function serviceAccent(service: FlashService) {
  if (service === "food") return flashDesign.color.food;
  if (service === "shipment") return flashDesign.color.shipment;
  return flashDesign.color.ride;
}
