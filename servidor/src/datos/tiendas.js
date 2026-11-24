/**
 * Segunda fuente de datos cuando MusicBrainz no encuentra la canción (o no sabe el álbum): las tiendas de
 * iTunes y Deezer. Las dos son gratis y no piden cuenta. Solo se usan para lo que FALTA: álbum, año, pista,
 * género y portada; nunca pisan lo que venía en el archivo.
 */
import { mismoTitulo, normalizar } from './completar.js';

const AGENTE = 'ReproductorCasa/0.3 (servidor privado de musica)';

/** iTunes permite ~20 consultas por minuto: una cada 3 s, en fila. */
let ultimo = 0;
let cadena = Promise.resolve();
function turnoItunes(fn) {
  const run = cadena.then(async () => {
    const espera = ultimo + 3100 - Date.now();
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

async function json(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** "Queen" coincide con "Queen" y con "Queen & David Bowie". */
const mismoArtistaTexto = (nuestro, suyo) => {
  const a = normalizar(nuestro);
  const b = normalizar(suyo);
  return !!a && !!b && (a === b || b.startsWith(a) || a.startsWith(b));
};
/** Recopilatorios y discos en vivo: solo si no hay nada mejor. */
const esRecopilatorio = (nombre) => /greatest hits|best of|essential|collection|anthology|hits|live|en vivo|karaoke|tribute|deluxe edition/i.test(nombre ?? '');
const anioDe = (fecha) => {
  const y = fecha ? parseInt(String(fecha).slice(0, 4), 10) : NaN;
  return y > 1000 ? y : null;
};

async function desdeItunes(titulo, artista) {
  const term = encodeURIComponent(`${artista} ${titulo}`);
  const r = await turnoItunes(() => json(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=25`));
  const ok = (r?.results ?? []).filter(
    (x) => x.collectionName && mismoTitulo(x.trackName, titulo) && mismoArtistaTexto(artista, x.artistName) && x.collectionArtistName !== 'Various Artists',
  );
  // El álbum original: primero los que no son recopilatorios, y de esos el más antiguo.
  ok.sort((a, b) => esRecopilatorio(a.collectionName) - esRecopilatorio(b.collectionName) || String(a.releaseDate).localeCompare(String(b.releaseDate)));
  const x = ok[0];
  if (!x) return null;
  return {
    fuente: 'itunes',
    album: x.collectionName.replace(/\s+-\s+(single|ep)$/i, ''),
    artistaAlbum: x.collectionArtistName || x.artistName,
    anio: anioDe(x.releaseDate),
    pista: x.trackNumber > 0 ? x.trackNumber : null,
    generos: x.primaryGenreName ? [x.primaryGenreName] : [],
    portada: x.artworkUrl100 ? x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.') : null,
  };
}

async function desdeDeezer(titulo, artista) {
  const q = encodeURIComponent(`artist:"${artista}" track:"${titulo}"`);
  const r = await json(`https://api.deezer.com/search?q=${q}&limit=25`);
  const ok = (r?.data ?? []).filter((x) => x.album?.title && mismoTitulo(x.title, titulo) && mismoArtistaTexto(artista, x.artist?.name));
  ok.sort((a, b) => esRecopilatorio(a.album.title) - esRecopilatorio(b.album.title));
  const x = ok[0];
  if (!x) return null;
  return {
    fuente: 'deezer',
    album: x.album.title,
    artistaAlbum: x.artist?.name ?? artista,
    anio: null,
    pista: null,
    generos: [],
    portada: x.album.cover_xl || x.album.cover_big || null,
  };
}

/** Busca la canción en iTunes y, si no está, en Deezer. null si ninguna la tiene. */
export async function buscarEnTiendas(titulo, artista) {
  if (!titulo || !artista) return null;
  return (await desdeItunes(titulo, artista)) ?? (await desdeDeezer(titulo, artista));
}

/** Descarga una portada (para guardarla con las demás). */
export async function bajarImagen(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}
