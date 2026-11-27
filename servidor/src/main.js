import { root } from './env.js'; // primero: la configuración
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, watchFile } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import archivos from '@fastify/static';
import { iniciarCola } from './analisis/cola.js';
import { iniciarVibra } from './analisis/vibra.js';
import { iniciarLastfm } from './datos/lastfm.js';
import { iniciarLetras } from './datos/letras.js';
import rutasLetras from './rutas/letras.js';
import { iniciarYtmusic } from './datos/ytmusic.js';
import { iniciarAnioOriginal } from './datos/anioOriginal.js';
import admin from './rutas/admin.js';
import cuentas from './rutas/cuentas.js';
import musica from './rutas/musica.js';
import social, { enviarATodos } from './rutas/social.js';
import party from './rutas/party.js';
import datos from './rutas/datos.js';
import estadisticas from './rutas/estadisticas.js';
import apiPublica from './rutas/apiPublica.js';
import rutasCategorias from './rutas/categorias.js';
import rutasArtistas from './rutas/artistas.js';
import rutasBot from './rutas/bot.js';
import { iniciarCategorias } from './categorias.js';
import { iniciarFaltantes } from './importarPlaylist.js';
import { iniciarPaises } from './pais.js';
import { iniciarEntrada } from './entrada.js';
import { avisarMudanza, iniciarAlmacen } from './almacen.js';
import { iniciarDuplicados } from './duplicados.js';
import { paginaDescargaPc } from './descargaPc.js';
import { db, migrate } from './db.js';

/**
 * Servidor del reproductor.
 *
 * Toda la configuración viene de `.env` (al lado de esta carpeta): puerto, base de datos, carpeta de música y
 * certificado. Nada depende de la IP de este equipo, así que mudarse a otro servidor es copiar la carpeta.
 */

const app = Fastify({
  logger: {
    level: 'info',
    // En el registro no se escriben las llaves ni firmas de audio que van en el enlace (?k=…, ?f=…).
    serializers: {
      req: (req) => ({
        method: req.method,
        url: String(req.url).replace(/([?&](?:k|f)=)[^&]+/g, '$1…'),
        remoteAddress: req.ip,
      }),
    },
  },
  // Con certificado propio (servidor de casa) habla HTTPS directo. Sin TLS_CERT (detrás de nginx, como en el
  // VPS) habla HTTP solo hacia adentro, y nginx pone el candado.
  ...(process.env.TLS_CERT ? { https: { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) } } : {}),
  // Detrás de nginx: la IP real de quien se conecta viene en X-Forwarded-For.
  trustProxy: process.env.TRUST_PROXY === '1',
  bodyLimit: 2 * 1024 * 1024,
  // Al reiniciar se cortan de una las conexiones abiertas (avisos en vivo, música sonando): antes el servidor
  // esperaba a que se cerraran solas y tardaba 90 s en apagarse (ese rato sin servicio). Las apps se reconectan solas.
  forceCloseConnections: true,
});

/**
 * Quién puede hablarle a este servidor desde un navegador (CORS). Solo:
 *  - la propia web (mismo origen: no necesita permiso),
 *  - la app de Android (su interfaz vive en https://localhost dentro del teléfono),
 *  - el PC de desarrollo (localhost) y lo que se agregue en CORS_ORIGENES del .env (separado por comas).
 * Cualquier otro sitio web no recibe permiso: el navegador le bloquea las respuestas.
 */
const ORIGENES = new Set(
  ['https://musica.empanados.io', 'https://localhost', 'capacitor://localhost', 'https://tauri.localhost', 'http://tauri.localhost', ...(process.env.CORS_ORIGENES ?? '').split(',')].map((x) => x.trim()).filter(Boolean),
);
const origenPermitido = (o) => ORIGENES.has(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

app.addHook('onRequest', async (req, reply) => {
  // Cabeceras de seguridad en todas las respuestas.
  reply.header('X-Content-Type-Options', 'nosniff'); // el navegador no "adivina" tipos de archivo
  reply.header('X-Frame-Options', 'DENY'); // nadie puede meter la app dentro de otra página
  reply.header('Referrer-Policy', 'no-referrer'); // no se filtran direcciones (ni llaves de audio) a otros sitios
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Solo por HTTPS de aquí en adelante (en el VPS; en casa con http de prueba no se manda).
  if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000');
  // De dónde puede cargar cosas la página: solo de este mismo servidor (nada de scripts de otros sitios).
  if (!req.url.startsWith('/api/'))
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );

  const origin = req.headers.origin;
  if (origin && origenPermitido(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    // Range: la app de Android pide el audio por trozos desde otro origen (https://localhost).
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    reply.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    // El permiso se recuerda 2 horas: así cada letra del buscador es un solo viaje, no dos.
    reply.header('Access-Control-Max-Age', '7200');
  }
  if (req.method === 'OPTIONS') return reply.code(204).send();
});

/** Para comprobar que el servidor y la base de datos están vivos. */
app.get('/api/salud', async () => {
  const r = await db.query(
    'SELECT now() AS ahora, (SELECT count(*) FROM canciones) AS canciones, (SELECT count(*) FROM usuarios) AS usuarios',
  );
  return { ok: true, version: '0.2.0', hora: r.rows[0].ahora, canciones: Number(r.rows[0].canciones), usuarios: Number(r.rows[0].usuarios) };
});

/**
 * Pedido que no existe. Caso típico: la app quedó abierta en la dirección SIN candado (http://) — el servidor
 * la manda a https y en ese salto el navegador convierte "crear cuenta / entrar" en una simple consulta.
 * En vez de un "not found" que no se entiende, se dice qué hacer.
 */
app.setNotFoundHandler((req, reply) => {
  const desde = String(req.headers.referer ?? req.headers.origin ?? '');
  if (req.url.startsWith('/api/') && desde.startsWith('http://') && !/^http:\/\/(localhost|127\.|\[::1\]|192\.168\.)/.test(desde)) {
    const https = desde.replace(/^http:/, 'https:').replace(/(https:\/\/[^/]+).*/, '$1');
    return reply.code(400).send({ error: `Abriste la app sin candado. Ciérrala y entra a ${https}` });
  }
  return reply.code(404).send({ error: 'No existe' });
});

await app.register(multipart);
await app.register(cuentas);
await app.register(admin);
await app.register(musica);
await app.register(social);
await app.register(party);
await app.register(datos);
await app.register(estadisticas);
await app.register(apiPublica);
await app.register(rutasCategorias);
await app.register(rutasArtistas);
await app.register(rutasBot);
await app.register(rutasLetras);
void iniciarPaises(app.log); // país de cada escucha (sin guardar la IP)
void iniciarEntrada(app.log); // ~/reproductor/entrada: lo que se deja ahí se agrega solo

// Panel de admin (página web): https://<servidor>:8443/admin/
// Cloudflare le dice al navegador que guarde .js y .css 4 horas: tras un cambio, el panel mezclaba la página
// nueva con el admin.js viejo. Por eso la página pide admin.js?v=<huella> y la huella cambia con cada versión.
const huellaAdmin = (f) => createHash('sha256').update(readFileSync(join(root, 'admin', f))).digest('hex').slice(0, 10);
const paginaAdmin = readFileSync(join(root, 'admin', 'index.html'), 'utf8')
  .replace('href="admin.css"', `href="admin.css?v=${huellaAdmin('admin.css')}"`)
  .replace('src="admin.js"', `src="admin.js?v=${huellaAdmin('admin.js')}"`);
await app.register(archivos, { root: join(root, 'admin'), prefix: '/admin/', index: false });
const servirPaginaAdmin = (_req, reply) => reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(paginaAdmin);
app.get('/admin/', servirPaginaAdmin);
app.get('/admin/index.html', servirPaginaAdmin);
app.get('/admin', (_req, reply) => reply.redirect('/admin/'));

// Página para poner una contraseña nueva con el enlace que genera el panel: /clave/#<código>
await app.register(archivos, {
  root: join(root, 'clave'),
  prefix: '/clave/',
  decorateReply: false,
  cacheControl: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex');
  },
});
app.get('/clave', (_req, reply) => reply.redirect('/clave/'));

// Actualizaciones de la app de Android (las sube scripts/compilar-apk.ps1 -Publicar): version.json, la
// interfaz (.zip) y el .apk. version.json nunca se guarda en caché (la app pregunta por él al abrirse).
const android = join(root, '..', 'android');
await mkdir(android, { recursive: true });
await app.register(archivos, {
  root: android,
  prefix: '/android/',
  decorateReply: false,
  cacheControl: false,
  setHeaders(res, ruta) {
    res.setHeader('Cache-Control', ruta.endsWith('.json') ? 'no-store' : 'public, max-age=31536000, immutable');
    if (ruta.endsWith('.apk')) res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  },
});

// App de PC (Windows): la sube scripts\compilar-pc.ps1 -Publicar a ~/reproductor/pc (el instalador .exe y
// version.json). La página para descargarla: https://musica.empanados.io/download-beta
const pc = join(root, '..', 'pc');
await mkdir(pc, { recursive: true });
await app.register(archivos, {
  root: pc,
  prefix: '/pc/',
  decorateReply: false,
  cacheControl: false,
  allowedPath: (ruta) => /^\/?[\w.-]+\.(exe|json)$/.test(ruta),
  setHeaders(res, ruta) {
    res.setHeader('Cache-Control', ruta.endsWith('.json') ? 'no-store' : 'public, max-age=31536000, immutable');
    if (ruta.endsWith('.exe')) {
      res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
      res.setHeader('Content-Disposition', `attachment; filename="${ruta.split(/[\\/]/).pop()}"`);
    }
  },
});
// Versión nueva publicada (los scripts suben version.json al final): se avisa al tiro a todas las apps abiertas,
// que revisan y muestran "Hay una versión nueva" sin esperar. Se mira el archivo cada 5 s (sirve aunque llegue por scp).
for (const [plataforma, carpeta] of [
  ['pc', pc],
  ['android', android],
]) {
  watchFile(join(carpeta, 'version.json'), { interval: 5000 }, (ahora, antes) => {
    if (ahora.mtimeMs && ahora.mtimeMs !== antes.mtimeMs) setTimeout(() => enviarATodos({ tipo: 'version-nueva', plataforma }), 2000);
  });
}
app.get('/download-beta', async (_req, reply) => {
  let v = null;
  try {
    v = JSON.parse(readFileSync(join(pc, 'version.json'), 'utf8'));
  } catch {
    /* todavía no hay ninguna versión publicada */
  }
  // La versión de Android (la sube scripts\compilar-apk.ps1 -Publicar), para el botón "Más opciones".
  let vAndroid = null;
  try {
    vAndroid = JSON.parse(readFileSync(join(android, 'version.json'), 'utf8'));
  } catch {
    /* sin versión de Android */
  }
  reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8');
  return paginaDescargaPc(v, vAndroid);
});
app.get('/download-beta/', (_req, reply) => reply.redirect('/download-beta'));

// La app (versión compilada, la sube scripts/publicar-app.sh): https://<servidor>:8443/
// index.html, sw.js y el manifiesto no se guardan en caché (para que lleguen las actualizaciones);
// lo de /assets/ lleva una huella en el nombre, así que puede guardarse para siempre.
const web = process.env.WEB_DIR ?? join(root, '..', 'web');
if (existsSync(join(web, 'index.html'))) {
  await app.register(archivos, {
    root: web,
    prefix: '/',
    decorateReply: false,
    cacheControl: false,
    setHeaders(res, ruta) {
      if (ruta.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
      if (ruta.endsWith('.crt')) res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      if (ruta.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
    },
  });
} else {
  app.get('/', (_req, reply) => reply.redirect('/admin/'));
}

await migrate(join(root, 'migraciones'));
iniciarCola(app.log);
iniciarVibra(app.log); // vibe de cada canción (Essentia)
iniciarLastfm(app.log); // etiquetas de Last.fm
iniciarLetras(app.log); // letras de LRCLIB
iniciarYtmusic(app.log); // recomendaciones de YouTube Music (radio y "Relacionado" de cada canción)
iniciarAnioOriginal(app.log); // año original de cada canción (MusicBrainz)
iniciarCategorias(app.log); // sugerencias de meme / anime / OST de videojuego para el panel
iniciarFaltantes(app.log); // canciones que faltaban en playlists importadas de Spotify
void iniciarAlmacen(app.log); // servidor de casa (wifi): guarda el audio de las canciones nuevas
iniciarDuplicados(app.log, avisarMudanza); // borra solas las canciones repetidas (queda la más antigua)
await app.listen({ port: Number(process.env.PORT ?? 8443), host: process.env.HOST ?? '0.0.0.0' });

const stop = async () => {
  // Por si algo quedara colgado: a los 5 s se apaga igual (nunca más los 90 s de espera de systemd).
  setTimeout(() => process.exit(0), 5000).unref();
  await app.close().catch(() => {});
  await db.end().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
