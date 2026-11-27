// Letras de las canciones, desde LRCLIB (lrclib.net: gratis, sin clave). Cada canción se busca una sola vez y la
// letra queda en la tabla `letras`: LRCLIB no recibe una consulta por cada persona y la letra sigue saliendo si
// LRCLIB se cae. Se buscan (1) al pedirlas, (2) al subir una canción y (3) por detrás, de a una, para toda la biblioteca.
import { db } from '../db.js';

const API = 'https://lrclib.net/api';
const PAUSA_MS = 1500;
/** Si la duración de LRCLIB difiere más que esto, los tiempos no sirven (otra versión): solo se guarda la letra normal. */
const MARGEN_TIEMPOS = 3;
/** Lo que no se encontró se vuelve a probar a los 30 días (LRCLIB crece). */
const REINTENTO_DIAS = 30;

let log = console;
let corriendo = false;
const enCurso = new Map(); // canción → promesa (para no buscar dos veces lo mismo a la vez)

/** Quita lo que estorba al buscar: "(con X)", "feat.", "(Single Version)", "- Remastered 2011"… */
export function limpiarTitulo(t) {
  return String(t ?? '')
    .replace(/\s*[([][^)\]]*(?:feat|ft\.|con |with|version|remaster|edit|mix|live|en vivo|bonus|deluxe)[^)\]]*[)\]]\s*/gi, ' ')
    .replace(/\s+-\s+(?:remaster(?:ed)?|single|radio|album|original|\d{4}).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function artistaPrincipal(a) {
  return String(a ?? '').split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\s+x\s+|\s+y\s+|\s+con\s+)\s*/i)[0]?.trim() || String(a ?? '');
}

async function pedir(ruta, params) {
  const u = new URL(API + ruta);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { 'User-Agent': 'Edowave/1.0 (https://musica.empanados.io)' }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 404) return null;
  if (r.status === 429) throw Object.assign(new Error('LRCLIB: demasiadas consultas'), { esperar: 60_000 });
  if (!r.ok) throw new Error(`LRCLIB respondió ${r.status}`);
  return r.json();
}

/** Busca en LRCLIB y devuelve la fila a guardar (sin la canción) o null si no hay nada. */
export async function buscarEnLrclib(c) {
  const titulo = limpiarTitulo(c.titulo) || c.titulo;
  const artista = artistaPrincipal(c.artista);
  const dur = Math.round(c.duracion);
  const album = c.album && c.album !== 'Álbum desconocido' ? c.album : undefined;
  // 1) Coincidencia exacta con la duración (LRCLIB exige ±2 s: es la misma versión).
  let hit = await pedir('/get', { artist_name: artista, track_name: titulo, album_name: album, duration: dur });
  if (!hit && album) hit = await pedir('/get', { artist_name: artista, track_name: titulo, duration: dur });
  // 2) Búsqueda abierta: la que más se parezca en duración, prefiriendo las sincronizadas.
  if (!hit) {
    const lista = (await pedir('/search', { track_name: titulo, artist_name: artista })) ?? [];
    const buenas = lista
      .filter((x) => Math.abs((x.duration ?? 0) - dur) <= 8)
      .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || Math.abs(a.duration - dur) - Math.abs(b.duration - dur));
    hit = buenas[0] ?? null;
  }
  if (!hit) return null;
  if (hit.instrumental) return { estado: 'instrumental', lrc: null, texto: null, lrclib_id: hit.id };
  const delta = Math.abs((hit.duration ?? dur) - dur);
  const texto = (hit.plainLyrics || (hit.syncedLyrics ?? '').replace(/^\[[^\]]*\]\s?/gm, '')).trim() || null;
  if (hit.syncedLyrics && delta <= MARGEN_TIEMPOS) return { estado: 'sincronizada', lrc: hit.syncedLyrics, texto, lrclib_id: hit.id };
  if (texto) return { estado: 'normal', lrc: null, texto, lrclib_id: hit.id };
  return null;
}

async function guardar(id, f) {
  await db.query(
    `INSERT INTO letras (cancion, estado, lrc, texto, lrclib_id, buscada) VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (cancion) DO UPDATE SET estado = $2, lrc = $3, texto = $4, lrclib_id = $5, buscada = now()
     WHERE letras.editada_por IS NULL`,
    [id, f.estado, f.lrc, f.texto, f.lrclib_id ?? null],
  );
}

/** Busca la letra de una canción y la guarda (una letra editada a mano en el panel no se pisa). */
export function buscarLetra(id) {
  if (enCurso.has(id)) return enCurso.get(id);
  const p = (async () => {
    const r = await db.query('SELECT id, titulo, artista, album, duracion FROM canciones WHERE id = $1', [id]);
    const c = r.rows[0];
    if (!c) return null;
    let f;
    try {
      f = (await buscarEnLrclib(c)) ?? { estado: 'sin_letra', lrc: null, texto: null };
    } catch (e) {
      log.warn({ err: e.message, cancion: id }, 'LRCLIB: no se pudo buscar la letra');
      f = { estado: 'error', lrc: null, texto: null };
    }
    await guardar(id, f);
    return f;
  })().finally(() => enCurso.delete(id));
  enCurso.set(id, p);
  return p;
}

/** Lo que ve la app de una letra. */
export const paraApp = (fila) => (fila ? { estado: fila.estado, lrc: fila.lrc, texto: fila.texto, desfase: fila.desfase_ms ?? 0 } : null);

/** La letra guardada; si no hay, la busca ahora (hasta 8 s). `pendiente` = sigue buscándose, que la app pregunte de nuevo. */
export async function letraDe(id, { buscar = true } = {}) {
  const r = await db.query('SELECT * FROM letras WHERE cancion = $1', [id]);
  let fila = r.rows[0];
  const vencida = fila && ['sin_letra', 'error'].includes(fila.estado) && Date.now() - new Date(fila.buscada) > REINTENTO_DIAS * 86400_000;
  const errorReciente = fila?.estado === 'error' && Date.now() - new Date(fila.buscada) < 10 * 60_000;
  if ((!fila || vencida) && buscar && !errorReciente) {
    const f = await Promise.race([buscarLetra(id), new Promise((res) => setTimeout(() => res(undefined), 8000))]);
    if (f) fila = { estado: f.estado, lrc: f.lrc, texto: f.texto, desfase_ms: 0 };
    else if (!fila) return { estado: 'pendiente' };
  }
  return paraApp(fila);
}

async function procesar() {
  if (corriendo) return;
  corriendo = true;
  try {
    for (;;) {
      // Primero las nunca buscadas, y entre ellas las más escuchadas; después las que no se encontraron hace 30 días.
      const r = await db.query(
        `SELECT c.id FROM canciones c LEFT JOIN letras l ON l.cancion = c.id
          WHERE l.cancion IS NULL
             OR (l.estado IN ('sin_letra','error') AND l.buscada < now() - make_interval(days => $1))
          ORDER BY (l.cancion IS NOT NULL), (SELECT count(*) FROM escuchas e WHERE e.cancion = c.id) DESC, c.subida DESC
          LIMIT 1`,
        [REINTENTO_DIAS],
      );
      const id = r.rows[0]?.id;
      if (!id) break;
      const f = await buscarLetra(id);
      if (f?.estado === 'error') await new Promise((res) => setTimeout(res, 30_000));
      await new Promise((res) => setTimeout(res, PAUSA_MS));
    }
  } catch (e) {
    log.warn({ err: e.message }, 'Letras: se reintenta más tarde');
  } finally {
    corriendo = false;
  }
}

export function iniciarLetras(logger) {
  log = logger;
  if (process.env.LETRAS === 'no') return log.info('Letras: desactivadas (LETRAS=no)');
  setTimeout(() => void procesar(), 60_000);
  setInterval(() => void procesar(), 30 * 60_000).unref();
}

export const avisarLetras = () => void procesar();
