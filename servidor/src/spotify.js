/**
 * Leer una playlist pública de Spotify (para importarla).
 *
 * - Con clave (SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en el .env, de una app gratis en developer.spotify.com):
 *   se usa la API oficial y llegan TODAS las canciones.
 * - Sin clave: se lee la página "embed" pública de la playlist (la que Spotify da para incrustar en otras webs).
 *   No pide cuenta, pero Spotify solo muestra ahí las primeras 100 canciones.
 *
 * Solo se lee: nunca se manda nada de la cuenta del usuario a Spotify.
 */

// Con un navegador "completo" Spotify manda la página sin las etiquetas con el total; así sí las manda.
const NAVEGADOR = 'Mozilla/5.0';
const MAX_CANCIONES = 5000; // lo mismo que acepta una playlist de la cuenta

/** Id de la playlist desde un enlace (open.spotify.com/…/playlist/ID, con o sin /intl-es) o "spotify:playlist:ID". */
export function idPlaylistSpotify(texto) {
  const t = String(texto ?? '').trim();
  const uri = t.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uri) return uri[1];
  let u;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'open.spotify.com') return null;
  const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?playlist\/([A-Za-z0-9]{22})\/?$/i);
  return m ? m[1] : null;
}

const conClave = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

/**
 * Spotify corta con 429 ("demasiadas peticiones") cuando varias personas importan seguido desde el VPS. El bloqueo
 * dura poco: se espera lo que pide (Retry-After, máximo 6 s) y se prueba una vez más.
 */
async function pedir(url, opciones = {}) {
  const una = () => fetch(url, { ...opciones, signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': NAVEGADOR, ...opciones.headers } });
  let r = await una();
  if (r.status === 429) {
    const s = Number(r.headers.get('retry-after'));
    await new Promise((ok) => setTimeout(ok, Math.min(Number.isFinite(s) && s > 0 ? s * 1000 : 3000, 6000)));
    r = await una();
  }
  if (r.status === 429) throw Object.assign(new Error('Spotify respondió 429'), { codigo: 429 });
  return r;
}

// ---------------- Sin clave: página embed ----------------

async function leerEmbed(id) {
  const r = await pedir(`https://open.spotify.com/embed/playlist/${id}`);
  if (r.status === 404) throw Object.assign(new Error('No se encontró esa playlist. ¿Es pública?'), { codigo: 404 });
  if (!r.ok) throw new Error(`Spotify respondió ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const e = m && JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!e || !Array.isArray(e.trackList)) throw Object.assign(new Error('No se pudo leer esa playlist. ¿Es pública?'), { codigo: 404 });
  const canciones = e.trackList
    .filter((t) => t && t.title && (t.entityType ?? 'track') === 'track')
    .map((t) => ({
      spotifyId: String(t.uri ?? '').split(':').pop() || null,
      titulo: String(t.title),
      artistas: String(t.subtitle ?? '').split(/,\s*/).map((a) => a.trim()).filter(Boolean),
      duracion: t.duration ? Math.round(t.duration / 1000) : null,
    }));
  // Cuántas tiene de verdad: la página normal lo dice en una etiqueta (el embed corta en 100).
  let total = canciones.length;
  if (canciones.length >= 100) {
    try {
      const p = await (await pedir(`https://open.spotify.com/playlist/${id}`)).text();
      const n = Number(p.match(/<meta name="music:song_count" content="(\d+)"/)?.[1]);
      if (n > total) total = n;
    } catch {
      /* no importa: queda lo que se leyó */
    }
  }
  return { id, nombre: String(e.name ?? e.title ?? 'Playlist de Spotify'), canciones, total, completa: total <= canciones.length };
}

// ---------------- Con clave: API oficial ----------------

let token = null; // { valor, vence }

async function tokenApi() {
  if (token && token.vence > Date.now() + 60_000) return token.valor;
  const r = await pedir('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`Spotify no aceptó la clave (${r.status})`);
  const j = await r.json();
  token = { valor: j.access_token, vence: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.valor;
}

async function leerApi(id) {
  const auth = { Authorization: `Bearer ${await tokenApi()}` };
  const info = await pedir(`https://api.spotify.com/v1/playlists/${id}?fields=name`, { headers: auth });
  if (info.status === 404) throw Object.assign(new Error('No se encontró esa playlist. ¿Es pública?'), { codigo: 404 });
  if (!info.ok) throw new Error(`Spotify respondió ${info.status}`);
  const nombre = (await info.json()).name;
  const canciones = [];
  let total = 0;
  // Spotify renombró /tracks a /items en 2026: se prueba primero el nombre nuevo.
  let ruta = 'items';
  let url = `https://api.spotify.com/v1/playlists/${id}/${ruta}?limit=100&additional_types=track`;
  while (url && canciones.length < MAX_CANCIONES) {
    const r = await pedir(url, { headers: auth });
    if (r.status === 404 && ruta === 'items' && !canciones.length) {
      ruta = 'tracks';
      url = `https://api.spotify.com/v1/playlists/${id}/${ruta}?limit=100&additional_types=track`;
      continue;
    }
    if (!r.ok) throw new Error(`Spotify respondió ${r.status}`);
    const j = await r.json();
    total = j.total ?? total;
    for (const it of j.items ?? []) {
      const t = it.item ?? it.track;
      if (!t || t.type !== 'track' || !t.name) continue;
      canciones.push({
        spotifyId: t.id ?? null,
        titulo: t.name,
        artistas: (t.artists ?? []).map((a) => a.name).filter(Boolean),
        duracion: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
      });
    }
    url = j.next;
  }
  return { id, nombre: nombre || 'Playlist de Spotify', canciones, total: Math.max(total, canciones.length), completa: true };
}

/** Lee la playlist: { id, nombre, canciones: [{ spotifyId, titulo, artistas, duracion }], total, completa }. */
export async function leerPlaylistSpotify(id) {
  if (conClave()) {
    try {
      return await leerApi(id);
    } catch (e) {
      if (e.codigo === 404) throw e;
      // si la API falla (clave vencida, cambio de Spotify), al menos se traen las primeras 100
    }
  }
  return leerEmbed(id);
}

// ---------------- Canciones pegadas (para completar playlists de más de 100) ----------------

const ENLACE_CANCION = /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/;
export const MAX_PEGADAS = 2000;

/**
 * Lo que la persona pegó: enlaces de canciones de Spotify (lo que copia Spotify con Ctrl+A, Ctrl+C) o líneas
 * "Artista - Canción". Devuelve las canciones en orden ({ spotifyId, titulo, artistas, duracion }); los enlaces
 * se leen de la página pública de cada canción, de a 4 a la vez.
 */
export async function leerCancionesPegadas(texto) {
  const lineas = String(texto ?? '')
    .split(/[\r\n]+|\s+(?=https:\/\/open\.spotify\.com\/)/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_PEGADAS);
  const items = lineas.map((l) => {
    const m = l.match(ENLACE_CANCION);
    if (m) return { spotifyId: m[1] };
    const p = l.split(/\s+[-–—]\s+/);
    if (p.length >= 2 && p[0] && p[1]) return { spotifyId: null, artistas: p[0].split(/,\s*/), titulo: p.slice(1).join(' - '), duracion: null };
    return null;
  }).filter(Boolean);
  const porLeer = [...new Set(items.filter((x) => x.spotifyId && !x.titulo).map((x) => x.spotifyId))];
  const leidas = new Map();
  let i = 0;
  const trabajador = async () => {
    while (i < porLeer.length) {
      const id = porLeer[i++];
      for (let intento = 0; intento < 2 && !leidas.has(id); intento++) {
        try {
          const r = await pedir(`https://open.spotify.com/embed/track/${id}`);
          if (!r.ok) continue;
          const m = (await r.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
          const e = m && JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
          if (e?.name || e?.title) {
            leidas.set(id, {
              titulo: String(e.name ?? e.title),
              artistas: (e.artists ?? []).map((a) => a.name).filter(Boolean),
              duracion: e.duration ? Math.round(e.duration / 1000) : null,
            });
          }
        } catch {
          /* se intenta otra vez, y si no, se salta */
        }
      }
    }
  };
  await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
  const canciones = items.map((x) => (x.titulo ? x : leidas.has(x.spotifyId) ? { spotifyId: x.spotifyId, ...leidas.get(x.spotifyId) } : null)).filter(Boolean);
  return { canciones, lineas: items.length, noLeidas: items.length - canciones.length };
}
