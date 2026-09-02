// Reexporta las consolas compactas del phone-stage (ARC-001).
//
// Los cuerpos viven en módulos por audiencia: comercio, conductor, ops y riel.
// App.tsx importa cada uno en su propio chunk; este archivo queda para
// consumidores que todavía resuelvan el barrel.
export { MerchantApp } from "./MerchantApp";
export { DriverApp } from "./DriverApp";
export { OpsApp } from "./OpsApp";
export { OpsRail } from "./OpsRail";
