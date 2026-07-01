import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(async ({ mode }) => ({
  plugins: [
    react(),
    basicSsl(),
    ...(mode === "analyze"
      ? [
          (await import("rollup-plugin-visualizer")).visualizer({
            filename: "dist/stats.html",
            open: false,
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
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
      "/lite": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Terminal emulator — large, stable, only used in RepositoryPage
          if (id.includes("@xterm")) return "vendor-xterm";
          // Markdown renderer + sanitizer — used only in lazy-loaded detail pages
          if (id.includes("marked") || id.includes("dompurify"))
            return "vendor-markdown";
          // Icon library — must come BEFORE /react/ check because @heroicons/react/* paths contain '/react/'
          if (id.includes("@heroicons")) return "vendor-icons";
          // Core React runtime — highly stable, long-lived cache
          if (id.includes("react-dom") || id.includes("/react/"))
            return "vendor-react";
          // Router — stable, separate from app code
          if (id.includes("react-router")) return "vendor-router";
          // Virtualised list — used in ChatWindow inside lazy pages
          if (id.includes("react-virtuoso")) return "vendor-virtuoso";
          // Everything else from node_modules
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
}));
