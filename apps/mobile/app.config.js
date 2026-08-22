const base = require("./app.base.json").expo;

const variants = {
  customer: { name: "Flash", slug: "flash-customer", scheme: "flash", bundle: "app.flash.customer" },
  driver: { name: "Flash Driver", slug: "flash-driver", scheme: "flash-driver", bundle: "app.flash.driver" },
  merchant: { name: "Flash Negocios", slug: "flash-merchant", scheme: "flash-merchant", bundle: "app.flash.merchant" },
};

module.exports = () => {
  const key = process.env.EXPO_PUBLIC_APP_VARIANT || "customer";
  const variant = variants[key] || variants.customer;
  const isDriver = key === "driver";
  const androidGoogleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
  const sharedPlugins = base.plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "expo-location" && name !== "react-native-maps";
  });
  const locationPlugin = isDriver
    ? [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "Si activás disponibilidad, Flash Driver mantiene tu ubicación en segundo plano hasta que vuelvas a estar offline.",
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
        },
      ]
    : [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Flash usa tu ubicación para elegir origen, destino y comercios cercanos.",
        },
      ];
  const mapsPlugin = androidGoogleMapsApiKey
    ? ["react-native-maps", { androidGoogleMapsApiKey }]
    : "react-native-maps";

  return {
    ...base,
    name: variant.name,
    slug: variant.slug,
    scheme: variant.scheme,
    plugins: [locationPlugin, mapsPlugin, ...sharedPlugins],
    ios: {
      ...base.ios,
      bundleIdentifier: variant.bundle,
      infoPlist: isDriver
        ? base.ios.infoPlist
        : {
            NSLocationWhenInUseUsageDescription:
              "Flash usa tu ubicación para elegir origen, destino y comercios cercanos.",
          },
    },
    android: {
      ...base.android,
      package: variant.bundle,
      permissions: isDriver
        ? base.android.permissions
        : ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "POST_NOTIFICATIONS"],
    },
    extra: {
      ...base.extra,
      appVariant: key,
      maps: { androidGoogleMapsConfigured: Boolean(androidGoogleMapsApiKey) },
    },
  };
};
