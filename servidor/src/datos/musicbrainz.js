/**
 * Cliente mínimo de MusicBrainz (datos) y Cover Art Archive (portadas). Gratis y sin cuenta.
 * MusicBrainz pide como máximo 1 consulta por segundo y un nombre de aplicación: todas pasan por una cola.
 *
 * Basado en src/library/musicbrainz.ts de la app (misma lógica), ahora corre en el servidor.
 */
const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const GAP_MS = 1100;
const AGENTE = 'ReproductorCasa/0.3 (servidor privado de musica)';

export class SinConexion extends Error {}

let ultimo = 0;
let cadena = Promise.resolve();

/** Espera su turno para respetar el límite de MusicBrainz. */
function turno(fn) {
  const run = cadena.then(async () => {
    const espera = ultimo + GAP_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    try {
      return await fn();
    } finally {
      ultimo = Date.now();
    }
  });
  cadena = run.catch(() => undefined);
  return run;
}

async function mbGet(ruta) {
  for (let intento = 0; intento < 4; intento++) {
    let res;
    try {
      res = await turno(() =>
        fetch(`${MB}${ruta}${ruta.includes('?') ? '&' : '?'}fmt=json`, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }),
      );
    } catch {
      throw new SinConexion('Sin conexión con MusicBrainz');
    }
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    // 503 = vamos demasiado rápido; se espera y se reintenta.
    if (res.status === 503 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (intento + 1)));
      continue;
    }
    return null;
  }
  return null;
}

/** Escapa la sintaxis de búsqueda (Lucene). */
const q = (s) => s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');

/**
 * Búsqueda amplia (para el año original): el título sin comillas, así "Hey Mickey" también encuentra "Mickey";
 * hasta 100 resultados (las canciones famosas tienen cientos de grabaciones y la original puede no estar entre
 * las primeras 25).
 */
export async function buscarGrabacionesAmplio(titulo, artista) {
  const palabras = q(titulo).split(/\s+/).filter(Boolean).join(' ');
  if (!palabras) return [];
  const query = encodeURIComponent(`recording:(${palabras}) AND artist:"${q(artista)}"`);
  const r = await mbGet(`/recording?query=${query}&limit=100`);
  return r?.recordings ?? [];
}

export async function buscarGrabaciones(titulo, artista) {
  const query = encodeURIComponent(`recording:"${q(titulo)}" AND artist:"${q(artista)}"`);
  const r = await mbGet(`/recording?query=${query}&limit=25`);
  return r?.recordings ?? [];
}

export async function buscarAlbumes(album, artista) {
  const query = encodeURIComponent(`releasegroup:"${q(album)}" AND artist:"${q(artista)}"`);
  const r = await mbGet(`/release-group?query=${query}&limit=10`);
  return r?.['release-groups'] ?? [];
}

export const leerAlbum = (id) => mbGet(`/release-group/${id}?inc=tags`);

/** Grabación con sus relaciones: quién produjo, quién compuso la obra, músicos… y sus géneros. */
export const leerGrabacion = (id) => mbGet(`/recording/${id}?inc=artist-rels+work-rels+work-level-rels+artist-credits+tags`);

/** Portada frontal (500 px) del álbum. null si no tiene. */
export async function bajarPortada(albumId) {
  try {
    const res = await fetch(`${CAA}/release-group/${albumId}/front-500`, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const datos = Buffer.from(await res.arrayBuffer());
    return datos.length > 1000 ? datos : null;
  } catch {
    throw new SinConexion('Sin conexión con Cover Art Archive');
  }
}

/**
 * Integrantes de un artista: busca el artista por nombre y, si es un grupo, devuelve quiénes lo forman
 * (relación "member of band"). Devuelve null si MusicBrainz no lo tiene.
 * @returns {Promise<{ id: string, tipo: string|null, miembros: string[] } | null>}
 */
export async function integrantesDe(nombre, mismoNombre) {
  const r = await mbGet(`/artist?query=${encodeURIComponent(`artist:"${q(nombre)}"`)}&limit=5`);
  const a = (r?.artists ?? []).find((x) => (x.score ?? 0) >= 90 && (mismoNombre(nombre, x.name) || (x.aliases ?? []).some((al) => mismoNombre(nombre, al.name))));
  if (!a) return null;
  if (a.type !== 'Group') return { id: a.id, tipo: a.type ?? null, miembros: [] };
  const d = await mbGet(`/artist/${a.id}?inc=artist-rels`);
  const miembros = [
    ...new Set(
      (d?.relations ?? [])
        .filter((rel) => rel.type === 'member of band' && rel.direction === 'backward' && rel.artist?.name)
        .map((rel) => rel.artist.name),
    ),
  ];
  return { id: a.id, tipo: 'Group', miembros };
}
