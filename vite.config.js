import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      // Whenever frontend hits /api, route it to the Python backend
      '/api': {
        target: 'http://127.0.0.1:8000', // <-- CHANGE 5000 TO YOUR PYTHON PORT
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
