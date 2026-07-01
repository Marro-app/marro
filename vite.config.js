import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // We surface our own accessible "Update ready" toast in-app (see UpdateToast
      // in src/main.jsx), so the new build is never force-reloaded mid-edit.
      registerType: 'prompt',
      injectRegister: false,
      // Keep the existing hand-authored public/manifest.json + its <link> in index.html.
      manifest: false,
      workbox: {
        // Precache the whole fingerprinted build. Hashed filenames make cache
        // invalidation automatic — a new deploy = new hashes = clean update.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,txt,json}'],
        // Offline navigations fall back to the cached app shell...
        navigateFallback: '/index.html',
        // ...except real static pages and any serverless routes.
        navigateFallbackDenylist: [/^\/api\//, /^\/privacy\.html$/, /^\/terms\.html$/],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Don't run the service worker in dev — it interferes with HMR.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3456,
  },
});
