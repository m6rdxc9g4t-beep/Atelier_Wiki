// Vite : interface du Wiki. En développement, /api est relayé vers le backend (127.0.0.1:3200, ou ATELIER_API_URL).
// Ports (suite Atelier) : interface 5176, aperçu 4176, API + interface compilée 3200. strictPort : échec explicite en cas de conflit.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget = process.env.ATELIER_API_URL ?? 'http://127.0.0.1:3200'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
})
