import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Pre-bundle heavy deps at startup to avoid lazy esbuild round-trips on first detail-page visit.
  // Keep this list updated when adding new heavy npm deps used by lazy-loaded routes.
  optimizeDeps: {
    include: ["marked", "dompurify", "react-virtuoso"],
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    // ✅ allow ngrok tunnels to access the dev server
    allowedHosts: [
      ".ngrok-free.dev", // current default ngrok domain
      ".ngrok.io", // legacy domain
      ".ngrok.app", // alternate domain
      ".org", // org domains
    ],
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
