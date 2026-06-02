import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  // Pre-bundle heavy deps at startup to avoid lazy esbuild round-trips on first detail-page visit.
  // Keep this list updated when adding new heavy npm deps used by lazy-loaded routes.
  optimizeDeps: {
    include: [
      "@heroicons/react/24/outline",
      "@xterm/xterm",
      "@xterm/addon-fit",
      "marked",
      "dompurify",
      "react-virtuoso",
    ],
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    https: true, // enables HTTP/2 — eliminates 6-connection HTTP/1.1 bottleneck
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
