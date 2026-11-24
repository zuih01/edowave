import type { Album, Artist, Track } from '../types';
import { UNKNOWN_ALBUM } from '../types';

const collator =new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** Lo que separa a los artistas de una colaboración. */
const SEPARADOR = /\s*(?:,|;|&|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\s+x\s+|\s+y\s+|\s+and\s+|\s+with\s+|\s+con\s+|\bvs\.?)\s*/i;

/** Nombres de álbum que son bandas sonoras o recopilaciones: todas sus canciones van juntas. */
const ES_OST = /(\bost\b|\bo\.s\.t\b|soundtrack|motion picture|original (series|score|cast)|music from|banda sonora|\bbso\b|\blofi\b|lo-fi|compilation|recopilaci)/i;

/** Nombre de un álbum con artistas distintos (OST, recopilaciones). */
export const VARIOS_ARTISTAS = 'Varios artistas';

/**
 * Agrupa la biblioteca en álbumes y artistas. Esta misma función corre en el servidor (reco/motor.js), así que las
 * claves de álbum y los nombres de artista son iguales en los dos lados.
 *
 * Álbumes: las canciones con el mismo nombre de álbum van juntas si comparten carátula o artista principal. Así un
 * OST o una recopilación ("Grease", "Best-of lofi hip-hop 2021") es un solo álbum aunque cada canción sea de otro
 * artista, y dos "Greatest Hits" de artistas distintos (con carátulas distintas) siguen separados.
 *
 * Artistas: una colaboración ("Kenny Rogers y Kim Carnes") no es un artista aparte. La canción va con cada uno de
 * sus artistas que ya exista por su cuenta; si ninguna parte existe sola ("Simon & Garfunkel"), es un grupo.
 */
export function groupLibrary(tracks: Track[]) {
  const lower = (s: string) => s.toLowerCase();
  const solos = new Set(tracks.map((t) => lower(t.artist)));
  for (const t of tracks) if (!SEPARADOR.test(t.albumArtist)) solos.add(lower(t.albumArtist));
  /** Artistas de un nombre: las partes que existen solas, o el nombre entero. */
  const cache = new Map<string, string[]>();
  const partesDe = (nombre: string) => {
    let r = cache.get(nombre);
    if (r) return r;
    const partes = nombre
      .split(SEPARADOR)
      .map((x) => x.trim())
      .filter((x) => x && lower(x) !== lower(nombre) && solos.has(lower(x)));
    r = partes.length ? [...new Set(partes)] : [nombre];
    cache.set(nombre, r);
    return r;
  };
  const principal = (nombre: string) => partesDe(nombre)[0];

  // ---- Álbumes
  const porNombre = new Map<string, Track[]>();
  const sueltos: Track[] = [];
  for (const t of tracks) {
    if (!t.album || t.album === UNKNOWN_ALBUM) sueltos.push(t);
    else {
      const k = lower(t.album.trim());
      const g = porNombre.get(k);
      if (g) g.push(t);
      else porNombre.set(k, [t]);
    }
  }
  const grupos: Track[][] = [];
  for (const g of porNombre.values()) {
    // Unión de canciones que comparten carátula o artista principal.
    const padre = g.map((_, i) => i);
    const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    const unir = (a: number, b: number) => {
      padre[raiz(a)] = raiz(b);
    };
    // Un OST o banda sonora es un solo álbum aunque cada canción traiga otra carátula (p. ej. "BIKINI HORRORS OST V4").
    if (ES_OST.test(g[0].album)) g.forEach((_, i) => i && unir(i, 0));
    const visto = new Map<string, number>();
    g.forEach((t, i) => {
      for (const marca of [t.coverId ? `c:${t.coverId}` : null, `a:${lower(principal(t.albumArtist))}`]) {
        if (!marca) continue;
        const j = visto.get(marca);
        if (j === undefined) visto.set(marca, i);
        else unir(i, j);
      }
    });
    const comp = new Map<number, Track[]>();
    g.forEach((t, i) => {
      const r = raiz(i);
      const c = comp.get(r);
      if (c) c.push(t);
      else comp.set(r, [t]);
    });
    grupos.push(...comp.values());
  }
  // Sin álbum: como antes, por artista.
  const sinAlbum = new Map<string, Track[]>();
  for (const t of sueltos) {
    const k = lower(`${principal(t.albumArtist)}|${t.album}`);
    const g = sinAlbum.get(k);
    if (g) g.push(t);
    else sinAlbum.set(k, [t]);
  }
  grupos.push(...sinAlbum.values());

  const albums: Album[] = [];
  const claves = new Set<string>();
  const albumDe = new Map<string, string>();
  for (const g of grupos) {
    // Artista del álbum: el principal de la mayoría; si ninguno llega a la mitad, "Varios artistas".
    const cuenta = new Map<string, { nombre: string; n: number }>();
    for (const t of g) {
      const p = principal(t.albumArtist);
      const c = cuenta.get(lower(p));
      if (c) c.n++;
      else cuenta.set(lower(p), { nombre: p, n: 1 });
    }
    const top = [...cuenta.values()].sort((a, b) => b.n - a.n || collator.compare(a.nombre, b.nombre))[0];
    const artist = cuenta.size === 1 || top.n * 2 >= g.length ? top.nombre : VARIOS_ARTISTAS;
    let key = lower(`${artist}|${g[0].album}`);
    if (claves.has(key)) {
      let n = 2;
      while (claves.has(`${key}#${n}`)) n++;
      key = `${key}#${n}`;
    }
    claves.add(key);
    const a: Album = { key, name: g[0].album, artist, year: undefined, coverId: undefined, tracks: g };
    for (const t of g) {
      a.coverId ??= t.coverId;
      a.year ??= t.year;
      albumDe.set(t.id, key);
    }
    albums.push(a);
  }
  albums.sort((x, y) => collator.compare(x.name, y.name));
  for (const a of albums) {
    a.tracks.sort((x, y) => (x.trackNo ?? 999) - (y.trackNo ?? 999) || collator.compare(x.title, y.title));
  }

  // ---- Artistas
  const artistMap = new Map<string, Artist>();
  const artistOf = (name: string) => {
    const k = lower(name);
    let ar = artistMap.get(k);
    if (!ar) {
      ar = { name, albums: [], tracks: [], aparece: [] };
      artistMap.set(k, ar);
    }
    return ar;
  };
  for (const a of albums) {
    if (a.artist === VARIOS_ARTISTAS) continue;
    const ar = artistOf(a.artist);
    ar.albums.push(a);
    ar.coverId ??= a.coverId;
  }
  for (const t of tracks) {
    for (const n of partesDe(t.artist)) {
      const ar = artistOf(n);
      ar.tracks.push(t);
      ar.coverId ??= t.coverId;
    }
  }
  // "Aparece en": álbumes de otro artista (o de varios) donde tiene canciones.
  for (const a of albums) {
    const ya = new Set<string>([lower(a.artist)]);
    for (const t of a.tracks) {
      for (const n of partesDe(t.artist)) {
        if (ya.has(lower(n))) continue;
        ya.add(lower(n));
        artistOf(n).aparece!.push(a);
      }
    }
  }
  // Un nombre de colaboración que quedó sin canciones ni álbumes propios no se lista como artista.
  for (const [k, ar] of artistMap) if (!ar.tracks.length && !ar.albums.length) artistMap.delete(k);
  const artists = [...artistMap.values()].sort((x, y) => collator.compare(x.name, y.name));
  const sortedTracks = [...tracks].sort((x, y) => collator.compare(x.title, y.title));
  return { tracks: sortedTracks, albums, artists, albumDe };
}

/** El artista de la biblioteca que corresponde a un nombre (si es una colaboración, el primero que exista solo). */
export function buscarArtista(artists: Artist[], nombre: string): Artist | undefined {
  const k = nombre.toLowerCase();
  const exacto = artists.find((a) => a.name.toLowerCase() === k);
  if (exacto) return exacto;
  for (const p of nombre.split(SEPARADOR)) {
    const a = p.trim() && artists.find((x) => x.name.toLowerCase() === p.trim().toLowerCase());
    if (a) return a;
  }
  return undefined;
}
