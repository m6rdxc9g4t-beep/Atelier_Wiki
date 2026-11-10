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
  build: {
    sourcemap: false,
    // Le rendu LaTeX (analyseur + KaTeX) est un morceau à part, chargé seulement par les pages LaTeX.
    chunkSizeWarningLimit: 1200,
    // Polices (KaTeX) servies comme fichiers : la CSP du Wiki (font-src 'self') refuse les polices en data:.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
})
