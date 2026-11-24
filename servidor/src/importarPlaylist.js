import { db } from './db.js';
import { emparejar, indiceCatalogo } from './emparejar.js';
import { normal } from './repetidas.js';

/**
 * Playlists importadas de Spotify.
 *
 * Al importar, cada canción se busca en el catálogo (ver emparejar.js). Las que están entran a la playlist en el
 * orden de Spotify; las que no, quedan anotadas en `playlist_faltantes` con su lugar (`despues_de`: la canción que
 * va justo antes). La app las muestra ahí, en gris, como "Canción no disponible".
 *
 * Cada vez que se sube o corrige una canción se revisan las faltantes: si alguna ya calza, se pone sola en su
 * lugar de la playlist y la app de esa persona se entera al tiro (aviso en vivo "playlists").
 */

let log = console;
let avisarUsuario = () => {};

/** social.js entrega aquí su función para mandar avisos en vivo (así no se importan en círculo). */
export function conAvisos(fn) {
  avisarUsuario = fn;
}

const CATALOGO = 'SELECT id, titulo, artista, duracion FROM canciones';

/** Para no anotar dos veces la misma canción que falta. */
const identidad = (s) => s.spotifyId ?? s.spotify_id ?? `${normal((s.artistas ?? []).join(' '))}|${normal(s.titulo)}`;

/** Reescribe las canciones de la playlist en este orden (dentro de una transacción abierta). */
async function escribirOrden(c, playlistId, claves) {
  await c.query('DELETE FROM playlist_canciones WHERE playlist_id = $1', [playlistId]);
  if (claves.length) {
    await c.query(
      'INSERT INTO playlist_canciones (playlist_id, posicion, cancion) SELECT $1, i - 1, x FROM unnest($2::text[]) WITH ORDINALITY AS t(x, i)',
      [playlistId, claves],
    );
  }
}

/**
 * Agrega a la playlist (dentro de una transacción abierta) canciones en el orden de Spotify. Las que ya estaban
 * (como canción o como faltante) no se repiten: así se puede pegar la playlist entera para completar las que
 * pasaban de 100.
 */
async function mezclar(c, playlistId, canciones, indice) {
  const claves = (await c.query('SELECT cancion FROM playlist_canciones WHERE playlist_id = $1 ORDER BY posicion', [playlistId])).rows.map((r) => r.cancion);
  const ya = await c.query('SELECT spotify_id, titulo, artistas, posicion FROM playlist_faltantes WHERE playlist_id = $1', [playlistId]);
  const vistas = new Set(ya.rows.map(identidad));
  let posicion = ya.rows.reduce((m, f) => Math.max(m, f.posicion), -1);
  let anterior = claves.at(-1) ?? '';
  let encontradas = 0;
  const faltan = [];
  for (const s of canciones) {
    const cat = emparejar(s, indice);
    if (cat) {
      const k = `s:${cat.id}`;
      if (!claves.includes(k)) {
        claves.push(k);
        encontradas++;
      }
      anterior = k;
      continue;
    }
    const id = identidad(s);
    if (vistas.has(id)) continue;
    vistas.add(id);
    faltan.push({
      posicion: ++posicion,
      spotify_id: s.spotifyId ?? null,
      titulo: String(s.titulo).slice(0, 300),
      artistas: (s.artistas ?? []).slice(0, 20),
      duracion: s.duracion ?? null,
      despues_de: anterior,
    });
  }
  if (encontradas) await escribirOrden(c, playlistId, claves);
  if (faltan.length) {
    await c.query(
      `INSERT INTO playlist_faltantes (playlist_id, posicion, spotify_id, titulo, artistas, duracion, despues_de)
       SELECT $1, f.posicion, f.spotify_id, f.titulo, ARRAY(SELECT jsonb_array_elements_text(f.artistas)), f.duracion, f.despues_de
         FROM jsonb_to_recordset($2::jsonb) AS f(posicion int, spotify_id text, titulo text, artistas jsonb, duracion int, despues_de text)`,
      [playlistId, JSON.stringify(faltan)],
    );
  }
  return { encontradas, faltan: faltan.length };
}

async function enTransaccion(fn) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Crea la playlist en la cuenta con lo que se encontró y anota lo que falta.
 * @param {{ usuarioId: number|string, id: string, nombre: string, origen: string,
 *           canciones: { spotifyId: string|null, titulo: string, artistas: string[], duracion: number|null }[] }} p
 */
export async function guardarImportada({ usuarioId, id, nombre, origen, canciones }) {
  const indice = indiceCatalogo((await db.query(CATALOGO)).rows);
  return enTransaccion(async (c) => {
    await c.query(
      `INSERT INTO playlists (id, usuario_id, nombre, creada, actualizada, publica, borrada, origen)
       VALUES ($1, $2, $3, now(), now(), false, false, $4)`,
      [id, usuarioId, nombre, origen],
    );
    return mezclar(c, id, canciones, indice);
  });
}

/** Completar una playlist ya importada (las canciones que pasaban de 100, pegadas por la persona). */
export async function completarImportada(playlistId, canciones) {
  const indice = indiceCatalogo((await db.query(CATALOGO)).rows);
  return enTransaccion(async (c) => {
    const p = await c.query('SELECT 1 FROM playlists WHERE id = $1 AND NOT borrada FOR UPDATE', [playlistId]);
    if (!p.rowCount) return null;
    const r = await mezclar(c, playlistId, canciones, indice);
    if (r.encontradas || r.faltan) await c.query('UPDATE playlists SET actualizada = now() WHERE id = $1', [playlistId]);
    return r;
  });
}

/** Lo que falta de una playlist (en el orden de Spotify), con su lugar. */
export async function faltantesDe(playlistId) {
  const r = await db.query(
    'SELECT id, titulo, artistas, duracion, despues_de FROM playlist_faltantes WHERE playlist_id = $1 ORDER BY posicion',
    [playlistId],
  );
  return r.rows.map((f) => ({ id: Number(f.id), titulo: f.titulo, artistas: f.artistas, duracion: f.duracion, despuesDe: f.despues_de }));
}

let corriendo = false;
let otraVez = false;

/** Revisa todas las faltantes contra el catálogo y pone en su lugar las que ya están. */
export async function completarFaltantes() {
  if (corriendo) {
    otraVez = true;
    return;
  }
  corriendo = true;
  try {
    do {
      otraVez = false;
      await revisar();
    } while (otraVez);
  } catch (e) {
    log.warn({ err: e.message }, 'faltantes: no se pudieron revisar');
  } finally {
    corriendo = false;
  }
}

async function revisar() {
  const f = await db.query(
    `SELECT f.id, f.playlist_id, f.titulo, f.artistas, f.duracion, p.usuario_id
       FROM playlist_faltantes f JOIN playlists p ON p.id = f.playlist_id
      WHERE NOT p.borrada`,
  );
  if (!f.rowCount) return;
  const indice = indiceCatalogo((await db.query(CATALOGO)).rows);
  const porPlaylist = new Map();
  for (const x of f.rows) {
    const c = emparejar({ titulo: x.titulo, artistas: x.artistas, duracion: x.duracion }, indice);
    if (!c) continue;
    const l = porPlaylist.get(x.playlist_id) ?? { usuario: Number(x.usuario_id), calzan: new Map() };
    l.calzan.set(String(x.id), { cancion: `s:${c.id}`, nombre: `${c.artista} – ${c.titulo}` });
    porPlaylist.set(x.playlist_id, l);
  }
  for (const [playlistId, { usuario, calzan }] of porPlaylist) {
    const agregadas = await enTransaccion(async (c) => {
      // Se bloquea la playlist: así no choca con un cambio que llegue del teléfono al mismo tiempo.
      const p = await c.query('SELECT 1 FROM playlists WHERE id = $1 AND NOT borrada FOR UPDATE', [playlistId]);
      if (!p.rowCount) return [];
      const claves = (await c.query('SELECT cancion FROM playlist_canciones WHERE playlist_id = $1 ORDER BY posicion', [playlistId])).rows.map((r) => r.cancion);
      const todas = (await c.query('SELECT id, posicion, despues_de FROM playlist_faltantes WHERE playlist_id = $1 ORDER BY posicion', [playlistId])).rows.map((r) => ({ ...r, id: String(r.id) }));
      const nuevas = [];
      for (const falt of todas) {
        const m = calzan.get(falt.id);
        if (!m) continue;
        if (!claves.includes(m.cancion)) {
          // En su lugar: justo después de la canción que iba antes (o al final, si esa ya no está).
          const i = falt.despues_de === '' ? 0 : falt.despues_de == null ? -1 : claves.indexOf(falt.despues_de) + 1;
          if (i <= 0 && falt.despues_de !== '') claves.push(m.cancion);
          else claves.splice(i, 0, m.cancion);
          nuevas.push(m.nombre);
        }
        // Las que faltan y venían después de esta en el mismo hueco ahora van detrás de ella.
        for (const otra of todas) {
          if (otra !== falt && otra.despues_de === falt.despues_de && otra.posicion > falt.posicion) otra.despues_de = m.cancion;
        }
        await c.query('UPDATE playlist_faltantes SET despues_de = $2 WHERE playlist_id = $1 AND despues_de IS NOT DISTINCT FROM $3 AND posicion > $4', [
          playlistId,
          m.cancion,
          falt.despues_de,
          falt.posicion,
        ]);
      }
      await c.query('DELETE FROM playlist_faltantes WHERE id = ANY($1::bigint[])', [[...calzan.keys()]]);
      if (nuevas.length) {
        await escribirOrden(c, playlistId, claves);
        await c.query('UPDATE playlists SET actualizada = now() WHERE id = $1', [playlistId]);
      }
      return nuevas;
    });
    if (agregadas.length) {
      log.info({ playlist: playlistId, canciones: agregadas }, 'faltantes: agregadas a una playlist importada');
      avisarUsuario(usuario, { tipo: 'playlists' });
    }
  }
}

let pendiente;
/** Después de subir o corregir canciones: revisa en unos segundos (junta varias subidas seguidas). */
export function avisarFaltantes() {
  clearTimeout(pendiente);
  pendiente = setTimeout(() => void completarFaltantes(), 5_000);
}

export function iniciarFaltantes(logger) {
  log = logger;
  setTimeout(() => void completarFaltantes(), 20_000);
  // Por si algo cambió por otro lado (nombres unificados en el panel, canciones movidas…).
  setInterval(() => void completarFaltantes(), 60 * 60_000).unref();
}
