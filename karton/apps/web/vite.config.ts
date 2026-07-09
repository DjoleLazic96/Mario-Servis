import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Dev server na 5173; /api se proksira na API (3000) da kolačići budu same-origin.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // automatska ažuriranja (odluka: PWA u v1)
      manifest: {
        name: 'Karton — vođenje auto servisa',
        short_name: 'Karton',
        description: 'Evidencija klijenata, vozila, radnih naloga i fakturisanja.',
        lang: 'sr',
        theme_color: '#182027',
        background_color: '#ECEFEC',
        display: 'standalone',
        start_url: '/',
        icons: [
          // Placeholder — konačne PNG ikonice dolaze sa Mariovim logom.
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
