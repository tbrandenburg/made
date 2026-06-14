import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl()],
  // Only @xterm/xterm needs pre-bundling (480KB terminal emulator). Removed from include: dompurify, react-virtuoso, marked, @xterm/addon-fit (all ESM-native).
  optimizeDeps: {
    include: ["@xterm/xterm"],
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
