import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // MapLibre bundles its own worker; prebundling can orphan that worker after HMR.
    exclude: ["maplibre-gl"],
  },
  build: {
    manifest: true,
    // Terser is slower than Vite's default minifier, but keeps the production
    // entry below the measured delivery budget without weakening browser support.
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react")) return "icons";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler"))
            return "react-vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
});
