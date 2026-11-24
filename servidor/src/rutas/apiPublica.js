import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { db } from '../db.js';
import { enlaceSugerenciaValido } from '../enlaces.js';

const gzipAsync = promisify(gzip);

/**
 * API para otras aplicaciones: SOLO listas de canciones. Nada de audio, carátulas, usuarios ni escuchas.
 *
 *   GET /api/v1/canciones   cabecera X-Api-Key: <clave>   las del servidor (artista, título, álbum, año, duración)
 *   GET /api/v1/faltantes   cabecera X-Api-Key: <clave>   las que esperan las playlists importadas de Spotify y
 *                                                          todavía no están en el servidor (la más pedida primero),
 *                                                          y en "sugerencias" lo pedido en "Sugerir una canción"
 *
 * - Cada aplicación tiene su clave (sistema/crear-clave-api.mjs); en la base solo está su huella.
 * - Máximo 60 pedidos por minuto por clave (y 30 intentos fallidos por minuto por IP).
 * - Lleva ETag: con If-None-Match, si nada cambió responde 304 sin mandar la lista.
 * - Sin CORS: es para programas y servidores, no para páginas web ajenas (el navegador no deja mandar X-Api-Key).
 */
const POR_MINUTO = 60;
const FALLOS_POR_MINUTO = 30;
const usos = new Map(); // clave/ip → { t: inicio de la ventana, n }

function pasaLimite(k, max) {
  const ahora = Date.now();
  const u = usos.get(k);
  if (!u || ahora - u.t >= 60_000) {
    usos.set(k, { t: ahora, n: 1 });
    return true;
  }
  return ++u.n <= max;
}
setInterval(() => {
  const ahora = Date.now();
  for (const [k, u] of usos) if (ahora - u.t >= 60_000) usos.delete(k);
}, 60_000).unref();

export const huellaDe = (clave) => createHash('sha256').update(clave).digest('hex');

export default async function apiPublica(app) {
  let lista = null; // { firma, etag, json, gz }
  let armando = null;

  async function listaCanciones() {
    const f = await db.query(`SELECT count(*)::int AS n, coalesce(max(greatest(subida, datos_revisado)), now())::text AS c FROM canciones`);
    const firma = JSON.stringify(f.rows[0]);
    if (lista?.firma === firma) return lista;
    armando ??= (async () => {
      try {
        const r = await db.query(
          `SELECT artista, titulo, album, anio, duracion FROM canciones ORDER BY lower(artista), lower(titulo)`,
        );
        const json = Buffer.from(JSON.stringify({ total: r.rows.length, canciones: r.rows }));
        lista = { firma, etag: `"${createHash('sha1').update(json).digest('base64url')}"`, json, gz: await gzipAsync(json, { level: 6 }) };
        return lista;
      } finally {
        armando = null;
      }
    })();
    return armando;
  }

  /** Revisa la clave y los límites. Devuelve true si se puede seguir (si no, ya respondió con el error). */
  async function autorizado(req, reply) {
    reply.header('Cache-Control', 'private, no-cache');
    const clave = req.headers['x-api-key'];
    if (typeof clave !== 'string' || clave.length < 20 || clave.length > 200) {
      if (!pasaLimite(`ip:${req.ip}`, FALLOS_POR_MINUTO)) return reply.code(429).send({ error: 'Demasiados intentos' });
      return reply.code(401).send({ error: 'Falta la clave (cabecera X-Api-Key)' });
    }
    const r = await db.query(
      `UPDATE api_claves SET ultimo_uso = now(), usos = usos + 1 WHERE huella = $1 AND activa RETURNING id`,
      [huellaDe(clave)],
    );
    if (!r.rowCount) {
      if (!pasaLimite(`ip:${req.ip}`, FALLOS_POR_MINUTO)) return reply.code(429).send({ error: 'Demasiados intentos' });
      return reply.code(401).send({ error: 'Clave no válida' });
    }
    if (!pasaLimite(`clave:${r.rows[0].id}`, POR_MINUTO)) {
      return reply.code(429).header('Retry-After', '60').send({ error: 'Máximo 60 pedidos por minuto' });
    }
    return true;
  }

  /** Responde el JSON con ETag (304 si no cambió) y en gzip si el programa lo acepta. */
  function enviar(req, reply, l) {
    reply.header('ETag', l.etag).header('Vary', 'Accept-Encoding, X-Api-Key');
    if (req.headers['if-none-match'] === l.etag) return reply.code(304).send();
    reply.type('application/json; charset=utf-8');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) return reply.header('Content-Encoding', 'gzip').send(l.gz);
    return reply.send(l.json);
  }

  app.get('/api/v1/canciones', async (req, reply) => {
    if ((await autorizado(req, reply)) !== true) return reply;
    return enviar(req, reply, await listaCanciones());
  });

  /**
   * Canciones que esperan las playlists importadas de Spotify (no están en el servidor). Se arma en el momento:
   * cuando una se sube, sale sola de la lista. Lo que pasaba de 100 en Spotify solo aparece si alguien lo pegó con
   * "Traer el resto" (el servidor no puede leer más de 100 por enlace).
   */
  app.get('/api/v1/faltantes', async (req, reply) => {
    if ((await autorizado(req, reply)) !== true) return reply;
    const r = await db.query(
      `SELECT min(array_to_string(f.artistas, ', ')) AS artista, min(f.titulo) AS titulo, max(f.duracion) AS duracion,
              CASE WHEN min(f.spotify_id) IS NULL THEN NULL ELSE 'https://open.spotify.com/track/' || min(f.spotify_id) END AS spotify,
              count(DISTINCT f.playlist_id)::int AS playlists, min(f.creada) AS desde
         FROM playlist_faltantes f JOIN playlists p ON p.id = f.playlist_id AND NOT p.borrada
        GROUP BY coalesce(f.spotify_id, lower(f.titulo) || '|' || lower(array_to_string(f.artistas, ',')))
        ORDER BY playlists DESC, desde, artista, titulo`,
    );
    // Lo que la gente pidió en "Sugerir una canción" y sigue pendiente (sin decir quién lo pidió). Puede ser un
    // artista solo, "artista - canción" o un enlace de Spotify / YouTube. Sale de aquí cuando el admin la marca como
    // subida o descartada en el panel.
    const s = await db.query(
      `SELECT CASE WHEN min(enlace) IS NOT NULL THEN 'enlace' WHEN min(titulo) = '' THEN 'artista' ELSE 'cancion' END AS tipo,
              nullif(min(artista), '') AS artista, nullif(min(titulo), '') AS titulo, min(enlace) AS enlace,
              count(*)::int AS veces, min(creada) AS desde
         FROM sugerencias WHERE estado = 'pendiente'
        GROUP BY coalesce(enlace, lower(artista) || '|' || lower(titulo))
        ORDER BY veces DESC, desde`,
    );
    // No se confía en lo guardado: el enlace solo sale si vuelve a pasar la validación de dominio.
    const sugerencias = s.rows.map((x) => ({ ...x, enlace: x.enlace ? enlaceSugerenciaValido(x.enlace) : null }));
    const json = Buffer.from(JSON.stringify({ total: r.rows.length, canciones: r.rows, sugerencias }));
    return enviar(req, reply, { json, etag: `"${createHash('sha1').update(json).digest('base64url')}"`, gz: await gzipAsync(json, { level: 6 }) });
  });
}
