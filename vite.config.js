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
      // 'prompt' hands update control to the app (no auto-reload). SilentUpdater in
      // src/main.jsx then applies the new build silently, only when the tab is
      // backgrounded and nothing is mid-flow — so it never reloads mid-edit.
      registerType: 'prompt',
      injectRegister: false,
      // Keep the existing hand-authored public/manifest.json + its <link> in index.html.
      manifest: false,
      workbox: {
        // Precache the whole fingerprinted build. Hashed filenames make cache
        // invalidation automatic — a new deploy = new hashes = clean update.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,txt,json}'],
        // The landing page's own JS/CSS chunk is small today and fine to precache.
        // But future landing IMAGES belong in public/landing/ and should be
        // runtime-cached (on first visit), not precached onto every signed-in
        // user's device who will never see the landing page again. Exclude that
        // folder now so it's a non-issue later.
        globIgnores: ['landing/**'],
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
  test: {
    // jsdom so importing src/lib/data.js is safe — that module runs a bare
    // setInterval IIFE on import whose callback touches `window`.
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    // Deterministic money/date math: pin the runner to a fixed clock/locale.
    // (Individual tests still pass explicit dates; this guards the defaults.)
    globals: false,
  },
});
