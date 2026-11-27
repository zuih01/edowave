import { existsSync, readFileSync } from 'node:fs';
import { Agent } from 'node:https';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Certificado local para instalar la app en el iPhone por el Wi-Fi de casa (lo crea `npm run certificado`).
const certs = existsSync('certs/servidor.key') && existsSync('certs/servidor.crt')
  ? { key: readFileSync('certs/servidor.key'), cert: readFileSync('certs/servidor.crt') }
  : undefined;

/**
 * Servidor de música: el VPS (https://musica.empanados.io, con certificado real). La app le habla por /api en su
 * mismo origen y Vite lo reenvía. Para volver al servidor de casa: SERVIDOR_MUSICA=https://192.168.1.5:8443 npm run dev
 */
const SERVIDOR_MUSICA = process.env.SERVIDOR_MUSICA ?? 'https://musica.empanados.io';
const esCasa = SERVIDOR_MUSICA.includes('192.168.') || SERVIDOR_MUSICA.includes('.local');
const proxyMusica = {
  '/api': {
    target: SERVIDOR_MUSICA,
    changeOrigin: true,
    secure: true,
    // El de casa usa la autoridad propia (certs/ca.crt); el VPS, un certificado normal de internet.
    agent: esCasa && existsSync('certs/ca.crt') ? new Agent({ ca: readFileSync('certs/ca.crt') }) : undefined,
  },
};

/** El iPhone solo ofrece instalar el certificado como perfil si llega con su tipo correcto. */
const certificateMime = {
  name: 'certificado-mime',
  configureServer(server: { middlewares: { use: (fn: CertMiddleware) => void } }) {
    server.middlewares.use(setCertMime);
  },
  configurePreviewServer(server: { middlewares: { use: (fn: CertMiddleware) => void } }) {
    server.middlewares.use(setCertMime);
  },
};
type CertMiddleware = (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void;
const setCertMime: CertMiddleware = (req, res, next) => {
  const path = req.url?.split('?')[0] ?? '';
  // /instalar y /instalar/ muestran la página de instrucciones (no la app).
  if (path === '/instalar' || path === '/instalar/') req.url = '/instalar/index.html';
  if (path.endsWith('.crt')) res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  next();
};

/** Versión de la app (la de PC, en tauri.conf.json): se muestra junto al perfil también en la web de computador. */
const VERSION_APP: string = (() => {
  try {
    return JSON.parse(readFileSync('escritorio-pc/app/src-tauri/tauri.conf.json', 'utf8')).version ?? '';
  } catch {
    return '';
  }
})();

export default defineConfig({
  define: { 'import.meta.env.VITE_VERSION_APP': JSON.stringify(VERSION_APP) },
  plugins: [
    react(),
    certificateMime,
    // App instalable (PWA): con su ícono en la pantalla de inicio y funcionando sin conexión.
    // (No en la app de Android: ahí la app ya viene instalada dentro del .apk.)
    !process.env.VITE_SERVIDOR && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Edowave',
        short_name: 'Edowave',
        description: 'Tu música, recomendada para ti',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#030303',
        theme_color: '#0f0f0f',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Todo lo de la app queda guardado en el teléfono: abre y funciona sin internet.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/instalar/**'],
        navigateFallback: '/index.html',
        // Páginas del servidor que no son la app: el navegador debe ir a buscarlas (no mostrar el reproductor).
        navigateFallbackDenylist: [/^\/instalar/, /^\/api\//, /^\/admin/, /^\/download-beta/, /^\/pc\//, /^\/android\//],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    // Las copias de seguridad y las propuestas de íconos no son parte de la app: que no provoquen recargas.
    watch: { ignored: ['**/backups/**', '**/propuestas/**', '**/certs/**', '**/servidor/**'] },
    proxy: proxyMusica,
  },
  // Para instalar en el iPhone: la versión final se sirve por https en tu red local (`npm run iphone`).
  preview: {
    host: true,
    port: 4443,
    https: certs,
    proxy: proxyMusica,
  },
  // App de PC: además de la app, la página del notch (segunda ventana; ver src/notch/notch.ts). Solo en PC.
  build: process.env.VITE_PLATAFORMA === 'pc' ? { rollupOptions: { input: { main: 'index.html', notch: 'notch.html' } } } : undefined,
  // Vite tampoco debe buscar dependencias dentro de las copias de seguridad.
  optimizeDeps: { entries: ['index.html'] },
});
