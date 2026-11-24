// Categorías especiales: 'meme', 'anime', 'ost-videojuego'.
//
// Las marca el admin en el panel (editor de la canción). Para no tener que revisar 30 000 canciones a mano, el
// servidor SUGIERE candidatas con pistas gratis (sin IA):
//   - géneros de MusicBrainz y etiquetas de Last.fm (cuando haya clave): "anime", "anisong", "video game music",
//     "comedy", "parody", "novelty", "meme"…;
//   - palabras del título o del álbum: "Opening", "TV Size", "OST", "Original Soundtrack", "FNF", "Friday Night
//     Funkin'", "parodia", "meme"…;
//   - la lista Anime Now (datos-listas/anime-now.json);
//   - el mismo artista o el mismo álbum que otra canción que ya marcaste.
// Las sugerencias nunca se aplican solas: el admin las acepta o las rechaza (y una rechazada no vuelve).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

export const CATEGORIAS = ['meme', 'anime', 'ost-videojuego'];

// ---------------- Anime Now (la lista de Spotify, guardada como texto) ----------------

const ANIME_NOW = (() => {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL('../datos-listas/anime-now.json', import.meta.url)), 'utf8'));
  } catch {
    return [];
  }
})();

/** Texto comparable: sin mayúsculas, acentos, paréntesis ni signos ("SPIN (TV Size)" = "spin"). */
const plano = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|（.*?）/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
const artistas = (s) => String(s ?? '').split(/,|&| y | x | feat\.?| ft\.?|×/i).map(plano).filter(Boolean);
/** Títulos en japonés/chino/coreano: casi únicos, así que alcanzan aunque el artista esté escrito en romaji. */
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/**
 * Ids (`s:<id>`) de las canciones de Anime Now que ya están en el servidor, en el orden de la lista.
 * Calza si el título es el mismo y (algún artista coincide, o el título está en japonés/chino/coreano).
 */
export function idsAnimeNow(tracks) {
  const porTitulo = new Map();
  for (const t of tracks) {
    const k = plano(t.title);
    if (!k) continue;
    if (!porTitulo.has(k)) porTitulo.set(k, []);
    porTitulo.get(k).push(t);
  }
  const out = [];
  for (const s of ANIME_NOW) {
    const candidatas = porTitulo.get(plano(s.titulo)) ?? [];
    const suyos = artistas(s.artista);
    const t =
      candidatas.find((c) => artistas(`${c.artist}, ${c.albumArtist}`).some((a) => suyos.includes(a))) ??
      (CJK.test(s.titulo) && candidatas.length === 1 ? candidatas[0] : null);
    if (t && !out.includes(t.id)) out.push(t.id);
  }
  return out;
}

// ---------------- Pistas para sugerir ----------------

const REGLAS = {
  anime: {
    generos: /\banime\b|anisong|anime song|\bseiyuu?\b|japanese animation/i,
    texto: /\b(opening|ending)\b|\bOP\s?\d+\b|\bED\s?\d+\b|tv\s?size|\banime\b|アニメ/i,
  },
  'ost-videojuego': {
    generos: /video ?game|\bvgm\b|chiptune|game soundtrack|8-bit|16-bit/i,
    texto: /\bFNF\b|friday night funkin|\bOST\b|original (game |video game )?soundtrack|game soundtrack|video ?game|sonic\.?exe|\bvs\.? .+ mod\b|sprunki|incredibox|poppy playtime|bendy|\bfnaf\b|five nights at freddy|undertale|deltarune|hypno'?s lullaby|cuphead|geometry dash/i,
  },
  meme: {
    generos: /\bcomedy\b|\bparody\b|novelty|\bmeme\b|shitpost|humou?r/i,
    texto: /\bmeme\b|\bparod(y|ia)\b|earrape|ear rape|shitpost|aura farm|skibidi|brainrot|\brizz\b|\bgyatt\b|sigma boy/i,
  },
};

let log = console;
let revisando = false;

/** Revisa las canciones y anota sugerencias nuevas (no repite las que ya existen ni las rechazadas). */
export async function sugerirCategorias() {
  if (revisando) return 0;
  revisando = true;
  try {
    const r = await db.query(
      `SELECT c.id, c.titulo, c.artista, c.album, c.artista_album, c.generos, c.categorias, e.tags
         FROM canciones c LEFT JOIN etiquetas e ON e.cancion_id = c.id`,
    );
    const ya = new Set((await db.query('SELECT cancion_id, categoria FROM categoria_sugerencias')).rows.map((x) => `${x.cancion_id}|${x.categoria}`));
    const nuevas = [];
    const anotar = (c, categoria, motivo) => {
      const k = `${c.id}|${categoria}`;
      if (ya.has(k) || (c.categorias ?? []).includes(categoria)) return;
      ya.add(k);
      nuevas.push([c.id, categoria, motivo.slice(0, 200)]);
    };

    // 1) Géneros, etiquetas y palabras.
    for (const c of r.rows) {
      const generos = [...(c.generos ?? []), ...(Array.isArray(c.tags) ? c.tags.map((t) => t.n ?? t.name ?? t) : [])].map(String);
      const texto = `${c.titulo ?? ''} · ${c.album ?? ''}`;
      for (const [cat, regla] of Object.entries(REGLAS)) {
        const g = generos.find((x) => regla.generos.test(x));
        if (g) anotar(c, cat, `género/etiqueta "${g}"`);
        else {
          const m = regla.texto.exec(texto);
          if (m) anotar(c, cat, `dice "${m[0].trim()}" en el título o el álbum`);
        }
      }
    }

    // 2) Anime Now.
    const tracks = r.rows.map((c) => ({ id: c.id, title: c.titulo, artist: c.artista, albumArtist: c.artista_album ?? c.artista }));
    const porId = new Map(r.rows.map((c) => [c.id, c]));
    for (const id of idsAnimeNow(tracks)) anotar(porId.get(id), 'anime', 'está en la playlist Anime Now');

    // 3) Mismo artista o mismo álbum que otra ya marcada.
    const marcadosArtista = new Map(); // artista → Set(categorías)
    const marcadosAlbum = new Map();
    const kAlbum = (c) => (c.album ? `${plano(c.artista_album ?? c.artista)}|${plano(c.album)}` : null);
    for (const c of r.rows) {
      for (const cat of c.categorias ?? []) {
        const a = plano(c.artista);
        if (!marcadosArtista.has(a)) marcadosArtista.set(a, new Set());
        marcadosArtista.get(a).add(cat);
        const al = kAlbum(c);
        if (al) {
          if (!marcadosAlbum.has(al)) marcadosAlbum.set(al, new Set());
          marcadosAlbum.get(al).add(cat);
        }
      }
    }
    for (const c of r.rows) {
      for (const cat of marcadosAlbum.get(kAlbum(c)) ?? []) anotar(c, cat, `mismo álbum que otra marcada como ${cat}`);
      for (const cat of marcadosArtista.get(plano(c.artista)) ?? []) anotar(c, cat, `mismo artista (${c.artista}) que otra marcada como ${cat}`);
    }

    for (let i = 0; i < nuevas.length; i += 500) {
      const lote = nuevas.slice(i, i + 500);
      await db.query(
        `INSERT INTO categoria_sugerencias (cancion_id, categoria, motivo)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[]) ON CONFLICT DO NOTHING`,
        [lote.map((x) => x[0]), lote.map((x) => x[1]), lote.map((x) => x[2])],
      );
    }
    if (nuevas.length) log.info({ nuevas: nuevas.length }, 'categorías: sugerencias nuevas para revisar en el panel');
    return nuevas.length;
  } catch (e) {
    log.error({ err: e.message }, 'categorías: no se pudieron revisar');
    return 0;
  } finally {
    revisando = false;
  }
}

let pendiente;
/** Hubo cambios (subidas, categorías marcadas): revisar en un rato. */
// ---------------- Categoría probable (para la radio) ----------------

/**
 * Pistas en las que se puede confiar aunque el admin todavía no las revise. Quedan fuera las que suelen
 * equivocarse: "Original Soundtrack" (también son películas), "Opening"/"Ending" y la lista Anime Now (trae K-pop).
 */
const PISTA_CONFIABLE = /friday night funkin|\bfnf\b|chiptune|video ?game|\bvgm\b|sonic\.?exe|mod\b|sprunki|incredibox|poppy playtime|bendy|fnaf|five nights|undertale|deltarune|hypno|cuphead|geometry dash|"meme"|comedy|parody|novelty|shitpost|aura farm|skibidi|brainrot|rizz|gyatt|sigma boy|"anime"|anisong|アニメ|mismo álbum/i;

/**
 * Categorías probables por canción (id sin prefijo): sugerencias pendientes con pistas confiables y, si la mitad o
 * más de las canciones de un artista ya tienen categoría (confirmada o probable), también el resto de las suyas.
 */
export async function categoriasProbables(filas, extra = []) {
  const r = await db.query(`SELECT cancion_id, categoria, motivo FROM categoria_sugerencias WHERE estado = 'pendiente'`);
  r.rows.push(...extra);
  const rechazadas = new Set(
    (await db.query(`SELECT cancion_id || '|' || categoria AS k FROM categoria_sugerencias WHERE estado = 'rechazada'`)).rows.map((x) => x.k),
  );
  const out = new Map();
  const poner = (id, cat) => {
    if (rechazadas.has(`${id}|${cat}`)) return;
    const s = out.get(id) ?? new Set();
    s.add(cat);
    out.set(id, s);
  };
  for (const x of r.rows) if (PISTA_CONFIABLE.test(x.motivo)) poner(x.cancion_id, x.categoria);
  const porArtista = new Map();
  for (const c of filas) {
    const k = plano(c.artista);
    if (!k) continue;
    const a = porArtista.get(k) ?? { n: 0, conCat: 0, cats: new Map(), ids: [] };
    a.n++;
    a.ids.push(c.id);
    const cats = new Set([...(c.categorias ?? []), ...(out.get(c.id) ?? [])]);
    if (cats.size) a.conCat++;
    for (const cat of cats) a.cats.set(cat, (a.cats.get(cat) ?? 0) + 1);
    porArtista.set(k, a);
  }
  // Si la mitad o más de sus canciones tiene alguna categoría, el resto toma la más común (un artista de
  // contenido de juegos y memes no pasa a ser música normal en sus otras canciones).
  for (const a of porArtista.values()) {
    if (a.n < 2 || a.conCat / a.n < 0.5) continue;
    const [cat] = [...a.cats].sort((x, y) => y[1] - x[1])[0] ?? [];
    if (cat) for (const id of a.ids) if (!out.has(id)) poner(id, cat);
  }
  return out;
}

export function avisarCategorias() {
  clearTimeout(pendiente);
  pendiente = setTimeout(() => void sugerirCategorias(), 30_000);
}

export function iniciarCategorias(logger) {
  log = logger;
  setTimeout(() => void sugerirCategorias(), 60_000);
  setInterval(() => void sugerirCategorias(), 30 * 60_000).unref();
}
