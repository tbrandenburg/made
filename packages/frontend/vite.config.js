import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    
    // ✅ allow ngrok tunnels to access the dev server
    allowedHosts: [
      '.ngrok-free.dev', // current default ngrok domain
      '.ngrok.io',       // legacy domain
      '.ngrok.app'       // alternate domain
    ],

    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      }
    }
  }
});
