// Etiquetas de Last.fm de cada canción: lo que la gente escribe sobre ella ("chill", "sad", "party", "jazz",
// "80s", "love"…). Ayudan a la radio a saber qué canciones van juntas. Primero las de la canción; si no tiene,
// las del artista. Se piden de a una (Last.fm permite unas pocas por segundo) para toda la biblioteca y después,
// solas, para las que se suban.
//
// Necesita una clave de la API de Last.fm (gratis): LASTFM_API_KEY en el .env del servidor. Sin clave, no hace nada.
import { db } from '../db.js';

const API = 'https://ws.audioscrobbler.com/2.0/';
const CLAVE = () => process.env.LASTFM_API_KEY;
const PAUSA_MS = 300; // ~3 por segundo (el límite de Last.fm es 5)
/** Etiquetas que no dicen nada de cómo suena (gustos personales, años de escucha, ruido). */
const INUTILES = new Set(['seen live', 'favorites', 'favourite', 'favorite', 'my favorite', 'favourites', 'love it', 'awesome', 'beautiful',
  'cool', 'good', 'great', 'best', 'amazing', 'spotify', 'youtube', 'check out', 'albums i own', 'under 2000 listeners']);

let log = console;
let corriendo = false;

const limpiar = (tags) =>
  (Array.isArray(tags) ? tags : [tags])
    .filter(Boolean)
    .map((t) => ({ n: String(t.name ?? '').toLowerCase().trim(), c: Number(t.count) || 0 }))
    .filter((t) => t.n && t.n.length <= 30 && t.c >= 5 && !INUTILES.has(t.n))
    .slice(0, 15);

async function pedir(params) {
  const u = new URL(API);
  for (const [k, v] of Object.entries({ ...params, api_key: CLAVE(), format: 'json', autocorrect: '1' })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'User-Agent': 'Musica/0.9 (reproductor privado)' }, signal: AbortSignal.timeout(15000) });
  if (r.status === 429) throw Object.assign(new Error('Last.fm: demasiadas consultas'), { esperar: 60_000 });
  const j = await r.json().catch(() => ({}));
  if (j.error === 10 || j.error === 26) throw Object.assign(new Error('Last.fm: la clave no es válida'), { detener: true });
  return j;
}

/** Etiquetas de una canción: las suyas; si no tiene, las del artista principal. */
async function etiquetasDe(artista, titulo) {
  const principal = String(artista).split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\s+x\s+|\s+y\s+|\s+con\s+)\s*/i)[0] || artista;
  const t = await pedir({ method: 'track.gettoptags', artist: principal, track: titulo.replace(/\s*[([].*?[)\]]\s*/g, ' ').trim() });
  const deCancion = limpiar(t.toptags?.tag);
  if (deCancion.length >= 3) return { tags: deCancion, fuente: 'cancion' };
  await new Promise((r) => setTimeout(r, PAUSA_MS));
  const a = await pedir({ method: 'artist.gettoptags', artist: principal });
  const deArtista = limpiar(a.toptags?.tag);
  if (deArtista.length) return { tags: [...deCancion, ...deArtista.filter((x) => !deCancion.some((y) => y.n === x.n))].slice(0, 15), fuente: 'artista' };
  return { tags: deCancion, fuente: deCancion.length ? 'cancion' : 'nada' };
}

async function procesar() {
  if (corriendo || !CLAVE()) return;
  corriendo = true;
  try {
    for (;;) {
      const r = await db.query(
        `SELECT c.id, c.artista, c.titulo FROM canciones c LEFT JOIN etiquetas e ON e.cancion_id = c.id
          WHERE e.cancion_id IS NULL ORDER BY c.subida DESC LIMIT 1`,
      );
      const c = r.rows[0];
      if (!c) break;
      try {
        const { tags, fuente } = await etiquetasDe(c.artista, c.titulo);
        await db.query(
          `INSERT INTO etiquetas (cancion_id, tags, fuente) VALUES ($1, $2, $3) ON CONFLICT (cancion_id) DO UPDATE SET tags = $2, fuente = $3, fecha = now()`,
          [c.id, JSON.stringify(tags), fuente],
        );
      } catch (e) {
        if (e.detener) {
          log.warn('Last.fm: la clave (LASTFM_API_KEY) no es válida; se detienen las etiquetas');
          return;
        }
        log.warn({ err: e.message }, 'Last.fm: se reintenta en un rato');
        await new Promise((res) => setTimeout(res, e.esperar ?? 30_000));
      }
      await new Promise((res) => setTimeout(res, PAUSA_MS));
    }
  } finally {
    corriendo = false;
  }
}

export function iniciarLastfm(logger) {
  log = logger;
  if (!CLAVE()) {
    log.info('Last.fm: falta LASTFM_API_KEY en el .env (las etiquetas se omiten)');
    return;
  }
  setTimeout(() => void procesar(), 30_000);
  setInterval(() => void procesar(), 10 * 60_000).unref();
}

export const avisarLastfm = () => void procesar();
