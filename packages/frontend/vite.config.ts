import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    // ✅ allow ngrok tunnels to access the dev server
    allowedHosts: [
      ".ngrok-free.dev", // current default ngrok domain
      ".ngrok.io", // legacy domain
      ".ngrok.app", // alternate domain
    ],
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
