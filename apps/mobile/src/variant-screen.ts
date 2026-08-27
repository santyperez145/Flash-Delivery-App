// El punto por el que `App.tsx` pide su única pantalla (ticket ARC-001).
//
// **Metro no usa este archivo.** `metro.config.js` intercepta la resolución de
// `./variant-screen` y la manda a `variant-screen.customer`,
// `variant-screen.driver` o `variant-screen.merchant` según
// `EXPO_PUBLIC_APP_VARIANT`. Este archivo existe para que TypeScript tenga algo
// que resolver, y por eso reexporta la variante de cliente: es la que
// `app.config.js` usa cuando la variable no está definida.
//
// La consecuencia útil es que `tsc` typecheckea contra el mismo contrato que el
// empaquetador va a sustituir. Si una variante deja de cumplirlo, el error
// aparece en el typecheck de las tres.
export { variantHeader, variantScreen } from "./variant-screen.customer";
