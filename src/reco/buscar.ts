import { candidatos, candidatosExactos, crearIndice, exactMatch, fuzzyScore, type IndiceBusqueda, type SearchField } from '../library/fuzzy';
import type { Album, Artist, Track } from '../types';
import { buildTaste, tasteScore, type Model } from './engine';

/**
 * Buscador (lo usa el SERVIDOR: la app solo muestra lo que él devuelve). Busca con tolerancia a errores
 * ("freddy mercury" encuentra a Queen) y, entre resultados que coinciden parecido, ordena por tus gustos.
 */

/** Cuánto pesa tu perfil al ordenar: decide entre resultados que coinciden parecido (p. ej. dos "Dynamite"). */
const TASTE_WEIGHT = 0.35;

interface Puntuado<T> {
  item: T;
  pos: number; // lugar en la lista original (desempata igual que antes)
  text: number;
  exacto: boolean;
}

/** El índice de cada lista se arma una vez (si el catálogo se rehace, la lista es otra y se arma solo). */
const indices = new WeakMap<object, IndiceBusqueda>();

/**
 * Puntúa solo los que pueden coincidir (mismo resultado que revisar la lista entera). Con `soloExactos`, solo
 * los que coinciden sin errores de tipeo (ver `candidatosExactos`).
 */
function puntuar<T extends object>(query: string, items: T[], fields: (x: T) => SearchField[], soloExactos: boolean): Puntuado<T>[] {
  let ind = indices.get(items);
  if (!ind) indices.set(items, (ind = crearIndice(items.map(fields))));
  const out: Puntuado<T>[] = [];
  for (const pos of soloExactos ? candidatosExactos(ind, query) : candidatos(ind, query)) {
    const item = items[pos];
    const f = fields(item);
    const text = fuzzyScore(query, f);
    if (text > 0) out.push({ item, pos, text, exacto: soloExactos || exactMatch(query, f) });
  }
  return out;
}

/**
 * Los `limit` mejores por texto + gusto. Si `soloExactos`, los parecidos (posibles errores de tipeo) se dejan
 * fuera. El gusto vale entre 0 y 1, así que se recorre de mayor a menor texto y se para cuando ni con el gusto
 * máximo alguien podría entrar: con "t" coinciden miles, pero el gusto solo se calcula para unas decenas.
 */
function mejores<T>(l: Puntuado<T>[], soloExactos: boolean, limit: number, taste: (x: T) => number): T[] {
  const orden = l.filter((r) => !soloExactos || r.exacto).sort((a, b) => b.text - a.text || a.pos - b.pos);
  const top: { item: T; pos: number; score: number }[] = [];
  const antes = (a: { pos: number; score: number }, b: { pos: number; score: number }) => b.score - a.score || a.pos - b.pos;
  for (const r of orden) {
    if (top.length >= limit && r.text + TASTE_WEIGHT < top[limit - 1].score) break;
    const x = { item: r.item, pos: r.pos, score: r.text + TASTE_WEIGHT * taste(r.item) };
    let i = top.length;
    while (i > 0 && antes(x, top[i - 1]) < 0) i--;
    if (i < limit) {
      top.splice(i, 0, x);
      if (top.length > limit) top.pop();
    }
  }
  return top.map((r) => r.item);
}

/** Cada integrante del grupo como un campo aparte (así un nombre no se mezcla con el de al lado). */
function integrantes(tracks: Track[]): SearchField[] {
  const set = new Set<string>();
  for (const t of tracks.slice(0, 30)) for (const m of t.members ?? []) set.add(m);
  return [...set].map((text) => ({ text, weight: 0.75 }));
}

/**
 * Los campos de cada artista, álbum y canción se arman una sola vez (no en cada letra que escribes).
 * Se guardan por objeto: si el catálogo se rehace, son objetos nuevos y se vuelven a armar solos.
 */
const camposGuardados = new WeakMap<object, SearchField[]>();
function campos<T extends object>(x: T, armar: (x: T) => SearchField[]): SearchField[] {
  let f = camposGuardados.get(x);
  if (!f) camposGuardados.set(x, (f = armar(x)));
  return f;
}

/**
 * El perfil de gustos se calcula una vez por modelo (no en cada letra que escribes), y también lo que te gusta
 * cada canción, álbum o artista: al pasar de "c" a "ca" casi todos ya vienen calculados.
 */
const tastes = new WeakMap<Model, { taste: ReturnType<typeof buildTaste>; puntajes: WeakMap<object, number> }>();
function tasteDe(m: Model) {
  let t = tastes.get(m);
  if (!t) tastes.set(m, (t = { taste: buildTaste(m), puntajes: new WeakMap() }));
  return t;
}
function recordado<T extends object>(memo: WeakMap<object, number> | undefined, x: T, calc: (x: T) => number) {
  if (!memo) return calc(x);
  let s = memo.get(x);
  if (s === undefined) memo.set(x, (s = calc(x)));
  return s;
}

export interface Resultados {
  artists: string[]; // nombres
  albums: string[]; // claves de álbum
  tracks: string[]; // ids
}

export function buscarTodo(q: string, lib: { tracks: Track[]; albums: Album[]; artists: Artist[] }, model: Model | null): Resultados {
  if (!q.trim()) return { artists: [], albums: [], tracks: [] };
  const gusto = model ? tasteDe(model) : null;
  const memo = gusto?.puntajes;
  const tScore = (t: Track) => (model && gusto ? recordado(memo, t, (x) => tasteScore(model, gusto.taste, x)) : 0);
  const groupScore = (g: { tracks: Track[] }) =>
    recordado(memo, g, (x) => (x.tracks.length ? Math.max(...x.tracks.slice(0, 20).map(tScore)) : 0));
  // También por sus integrantes: "Freddie Mercury" encuentra a Queen (pesa un poco menos que el nombre).
  const fArtista = (a: Artist) => campos(a, (x) => [{ text: x.name, weight: 1 }, ...integrantes(x.tracks)]);
  const fAlbum = (a: Album) =>
    campos(a, (x) => [
      { text: x.name, weight: 1 },
      { text: x.artist, weight: 0.8 },
    ]);
  const fCancion = (t: Track) =>
    campos(t, (x) => [
      { text: x.title, weight: 1 },
      { text: x.artist, weight: 0.8 },
      { text: x.album, weight: 0.6 },
      ...integrantes([x]),
    ]);
  // Búsqueda precisa: si algo coincide tal cual ("abba" → ABBA), solo se muestra eso. Los parecidos (nombres
  // mal escritos) aparecen únicamente cuando no hay ninguna coincidencia exacta. Por eso primero se buscan solo
  // las exactas (rápido, sin calcular errores de tipeo) y los parecidos solo si no hubo ninguna.
  let artists = puntuar(q, lib.artists, fArtista, true);
  let albums = puntuar(q, lib.albums, fAlbum, true);
  let tracks = puntuar(q, lib.tracks, fCancion, true);
  const hayExactos = artists.length > 0 || albums.length > 0 || tracks.length > 0;
  if (!hayExactos) {
    artists = puntuar(q, lib.artists, fArtista, false);
    albums = puntuar(q, lib.albums, fAlbum, false);
    tracks = puntuar(q, lib.tracks, fCancion, false);
  }
  return {
    artists: mejores(artists, hayExactos, 4, groupScore).map((a) => a.name),
    albums: mejores(albums, hayExactos, 8, groupScore).map((a) => a.key),
    tracks: mejores(tracks, hayExactos, 50, tScore).map((t) => t.id),
  };
}
