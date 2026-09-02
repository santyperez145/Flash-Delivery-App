// Resolución de la pantalla por variante, en tiempo de empaquetado
// (ticket ARC-001).
//
// ARC-001 pide que el build de Flash Driver no contenga pantallas de comercio y
// que el de Flash no contenga backoffice. Eso no se puede lograr eligiendo la
// pantalla en runtime: `App.tsx` importaba las tres, así que las tres viajaban
// en los tres bundles —9.715 líneas de pantallas en cada teléfono—.
//
// Acá se corta el grafo de módulos. Cuando algo pide `./variant-screen`, Metro
// resuelve el archivo de la variante que se está empaquetando, y las otras dos
// pantallas quedan sin ninguna arista que las alcance.
//
// El valor se lee de `EXPO_PUBLIC_APP_VARIANT`, la misma variable que
// `app.config.js` usa para el identificador de la aplicación y los permisos
// nativos, y que `eas.json` fija en los tres perfiles de producción. Una sola
// fuente para las tres decisiones: si alguien empaqueta con la variable en
// `driver`, obtiene el bundle de driver, el bundle id de driver y el permiso de
// ubicación en segundo plano, o ninguna de las tres cosas.
//
// Sin la variable la resolución cae en `customer`, igual que `app.config.js`.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const VARIANTS = new Set(["customer", "driver", "merchant"]);
const variant = VARIANTS.has(process.env.EXPO_PUBLIC_APP_VARIANT)
  ? process.env.EXPO_PUBLIC_APP_VARIANT
  : "customer";

const config = getDefaultConfig(__dirname);
const domainContracts = path.resolve(__dirname, "../../packages/domain-contracts");
config.watchFolders = [...(config.watchFolders || []), domainContracts];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../../node_modules"),
  ...(config.resolver.nodeModulesPaths || []),
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@flash/domain-contracts": domainContracts,
};
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Sólo se intercepta el especificador exacto. Un pedido de
  // `./variant-screen.driver` —el que hace este mismo redirigido— tiene que
  // pasar de largo, o la resolución se llamaría a sí misma para siempre.
  if (moduleName === "./variant-screen" || moduleName === "./src/variant-screen") {
    const prefix = moduleName.slice(0, moduleName.lastIndexOf("/") + 1);
    return context.resolveRequest(context, `${prefix}variant-screen.${variant}`, platform);
  }
  return (upstreamResolveRequest || context.resolveRequest)(context, moduleName, platform);
};

// Se deja constancia en la salida del empaquetado: un bundle de variante
// equivocada es difícil de notar mirando la aplicación, y muy fácil mirando
// esta línea.
console.log(`metro: empaquetando la variante "${variant}"`);

module.exports = config;
