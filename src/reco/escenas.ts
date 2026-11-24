import type { Track, Vibe } from '../types';

/**
 * Escenas: estilo + época + sonido. Sirven para que un Mix diario sea coherente, no un género enorme.
 *  - Las etiquetas específicas mandan; las generales ("rock", "pop", "electronic") solo apoyan.
 *  - Lo que suele tocar el artista corrige una etiqueta equivocada en una canción.
 *  - Una canción fuera de la época de la escena no entra, y el sonido puede descartar pero nunca decide solo.
 *  - Si hay dudas entre escenas, la canción queda sin escena: mejor una lista corta que una incoherente.
 */
export interface Escena {
  id: string;
  nombre: string;
  desde: number;
  hasta: number;
  fuertes: string[];
  apoyo: string[];
  /** Con estas etiquetas (en la canción o típicas del artista), la canción no pertenece a la escena. */
  excluye?: string[];
  sonido?: (v: Vibe) => boolean;
}

const URBANO = ['hip hop', 'rap', 'trap', 'pop rap', 'gangsta rap', 'reggaeton', 'urbano latino', 'latin urban', 'r&b', 'contemporary r&b', 'k pop', 'kpop'];
const HOUSE = ['house', 'deep house', 'french house', 'tech house', 'electro house', 'progressive house'];
const electronico = (v: Vibe) => v.electronica >= 0.4;

export const ESCENAS: Escena[] = [
  { id: 'electronica-actual', nombre: 'Electrónica actual', desde: 2008, hasta: 2100, sonido: electronico, excluye: URBANO,
    fuertes: [...HOUSE, 'edm', 'future bass', 'big room', 'big room house', 'dubstep', 'brostep', 'melodic dubstep', 'tropical house', 'future house', 'complextro', 'bass house', 'slap house', 'hardstyle', 'moombahton', 'drum and bass', 'trance', 'progressive trance', 'electro'],
    apoyo: ['electronic', 'dance', 'electronica', 'club dance'] },
  { id: 'club-clasico', nombre: 'Clásicos de club', desde: 1988, hasta: 2007, sonido: electronico, excluye: URBANO,
    fuertes: [...HOUSE, 'euro house', 'techno', 'trance', 'eurodance', 'rave', 'happy hardcore', 'acid house', 'big beat', 'breakbeat', 'jungle', 'drum and bass', 'hardcore techno', 'gabber', 'progressive trance', 'vocal trance', 'italo dance'],
    apoyo: ['electronic', 'dance', 'electronica', 'club dance'] },
  { id: 'disco', nombre: 'Disco', desde: 1973, hasta: 1986, sonido: (v) => v.bailable >= 0.35, fuertes: ['disco', 'euro disco', 'eurodisco', 'italo disco', 'post disco', 'boogie'], apoyo: ['funk', 'dance', 'hi nrg'] },
  { id: 'synth', nombre: 'Synth y new wave', desde: 1978, hasta: 1992, fuertes: ['synth pop', 'synthpop', 'new wave', 'new romantic', 'electropop'], apoyo: ['pop', 'electronic', 'post punk'] },
  { id: 'indie-pop', nombre: 'Indie y dream pop', desde: 2005, hasta: 2100, excluye: [...URBANO, 'dance pop', 'electropop', 'teen pop'],
    fuertes: ['indie pop', 'dream pop', 'bedroom pop', 'indietronica', 'chillwave', 'lo fi', 'indie folk'], apoyo: ['indie', 'alternative', 'psychedelic pop'] },
  { id: 'indie-rock', nombre: 'Indie rock', desde: 2000, hasta: 2100, excluye: [...URBANO, 'dream pop', 'indie pop'], fuertes: ['indie rock', 'garage rock revival', 'post punk revival', 'dance punk', 'garage rock'], apoyo: ['rock', 'alternative', 'indie', 'alternative rock'] },
  { id: 'rock-clasico', nombre: 'Rock clásico', desde: 1960, hasta: 1994, fuertes: ['classic rock', 'album rock', 'hard rock', 'blues rock', 'progressive rock', 'arena rock', 'southern rock', 'glam rock', 'art rock', 'folk rock'], apoyo: ['rock', 'heavy metal'] },
  { id: 'rock-alternativo', nombre: 'Rock alternativo', desde: 1988, hasta: 2015, excluye: [...URBANO, 'dance pop', 'teen pop', 'pop'], fuertes: ['alternative rock', 'grunge', 'post grunge', 'britpop', 'modern rock', 'pop punk', 'emo', 'punk rock', 'nu metal'], apoyo: ['rock', 'alternative', 'alternative metal'] },
  { id: 'rock-espanol', nombre: 'Rock en español', desde: 1975, hasta: 2100, fuertes: ['rock en espanol', 'rock latino', 'latin rock', 'rock nacional', 'rock chileno', 'rock argentino'], apoyo: ['rock', 'alternative rock', 'latin'] },
  { id: 'metal', nombre: 'Metal', desde: 1970, hasta: 2100, fuertes: ['heavy metal', 'thrash metal', 'death metal', 'black metal', 'power metal', 'metalcore', 'doom metal', 'progressive metal', 'alternative metal', 'nu metal', 'speed metal'], apoyo: ['metal', 'hard rock'] },
  { id: 'baladas', nombre: 'Baladas y soft rock', desde: 1970, hasta: 2012, excluye: ['hard rock', 'heavy metal', 'dance pop', 'synth pop', 'new wave', 'disco'], fuertes: ['soft rock', 'ballad', 'easy listening', 'yacht rock'], apoyo: ['adult contemporary', 'pop', 'pop rock'] },
  { id: 'pop-clasico', nombre: 'Pop 90s y 2000s', desde: 1990, hasta: 2009, excluye: URBANO, fuertes: ['dance pop', 'teen pop', 'bubblegum pop', 'europop'], apoyo: ['pop', 'pop rock', 'contemporary pop rock'] },
  { id: 'pop-actual', nombre: 'Pop actual', desde: 2010, hasta: 2100, excluye: URBANO, fuertes: ['dance pop', 'electropop', 'teen pop', 'synth pop', 'alt pop', 'art pop', 'pop rock'], apoyo: ['pop'] },
  { id: 'hiphop-clasico', nombre: 'Hip hop clásico', desde: 1985, hasta: 2005, fuertes: ['hip hop', 'rap', 'golden age hip hop', 'gangsta rap', 'east coast hip hop', 'west coast hip hop', 'g funk', 'boom bap', 'hardcore hip hop'], apoyo: ['pop rap'] },
  { id: 'hiphop-actual', nombre: 'Hip hop actual', desde: 2006, hasta: 2100, fuertes: ['hip hop', 'rap', 'trap', 'drill', 'cloud rap', 'pop rap', 'southern hip hop', 'conscious hip hop'], apoyo: [] },
  { id: 'soul', nombre: 'Soul y funk', desde: 1960, hasta: 1985, fuertes: ['soul', 'funk', 'motown', 'northern soul', 'southern soul', 'philly soul'], apoyo: ['r&b'] },
  { id: 'rnb', nombre: 'R&B', desde: 1986, hasta: 2100, fuertes: ['contemporary r&b', 'r&b', 'neo soul', 'new jack swing', 'alternative r&b', 'quiet storm'], apoyo: ['soul', 'r&b soul'] },
  { id: 'urbano-latino', nombre: 'Reggaetón y urbano', desde: 2000, hasta: 2100, fuertes: ['reggaeton', 'urbano latino', 'latin urban', 'dembow', 'trap latino', 'latin trap', 'perreo'], apoyo: ['latin'] },
  { id: 'pop-latino', nombre: 'Pop latino', desde: 1980, hasta: 2100, excluye: ['reggaeton', 'urbano latino', 'latin urban', 'rock en espanol'], fuertes: ['latin pop', 'pop latino', 'pop en espanol', 'balada', 'salsa', 'bachata', 'merengue', 'cumbia'], apoyo: ['latin', 'pop'] },
  { id: 'kpop', nombre: 'K-pop', desde: 2000, hasta: 2100, fuertes: ['k pop', 'kpop', 'korean pop', 'k rap', 'k r&b'], apoyo: ['korean', 'pop'] },
  { id: 'country', nombre: 'Country y folk', desde: 1960, hasta: 2100, fuertes: ['country', 'americana', 'bluegrass', 'folk', 'contemporary country', 'country pop'], apoyo: [] },
  { id: 'jazz', nombre: 'Jazz y chill', desde: 1940, hasta: 2100, excluye: ['rock', 'hip hop', 'reggaeton', 'electronic'], fuertes: ['jazz', 'smooth jazz', 'vocal jazz', 'jazz fusion', 'bossa nova'], apoyo: ['lounge', 'chill', 'downtempo', 'trip hop'] },
];

const tag = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
const artistaPrincipal = (a: string) => tag(a.split(/,|\s+(?:feat\.?|ft\.?|con|with|&|y|x)\s+/i)[0] ?? a);

interface Preparada {
  e: Escena;
  fuertes: Set<string>;
  apoyo: Set<string>;
  excluye: Set<string>;
}
const PREPARADAS: Preparada[] = ESCENAS.map((e) => ({ e, fuertes: new Set(e.fuertes), apoyo: new Set(e.apoyo), excluye: new Set(e.excluye ?? []) }));
/** Correcciones por artista, para cuando sus etiquetas públicas no describen bien su música. */
const CORRECCIONES: Record<string, string> = {
  'melanie martinez': 'pop-actual',
  airbag: 'rock-espanol',
  'chancho en piedra': 'rock-espanol',
  'beach house': 'indie-pop',
  'wonder girls': 'kpop',
  'eddy grant': '',
};
const MARGEN = 1.25;
const IDENTIDAD_ARTISTA = 0.35;
const EXCLUSION_ARTISTA = 0.3;
/** Una escena debe ser al menos esta parte de lo clasificado del artista: evita canciones sueltas fuera de lugar. */
const COHERENCIA_ARTISTA = 0.2;
const REEDICION = 15;

/** A qué escena pertenece cada canción del catálogo (las dudosas no aparecen). */
export function clasificarEscenas(tracks: Track[]): Map<string, Escena> {
  const artistas = new Map<string, { n: number; tags: Map<string, number>; fuertes: Map<string, number>; anios: number[] }>();
  const tagsDe = new Map<string, string[]>();
  for (const t of tracks) {
    const tags = [...new Set(t.genres.map(tag))];
    tagsDe.set(t.id, tags);
    const k = artistaPrincipal(t.artist);
    const a = artistas.get(k) ?? { n: 0, tags: new Map<string, number>(), fuertes: new Map<string, number>(), anios: [] };
    a.n++;
    if (t.year) a.anios.push(t.year);
    for (const g of tags) a.tags.set(g, (a.tags.get(g) ?? 0) + 1);
    for (const p of PREPARADAS) if (tags.some((g) => p.fuertes.has(g))) a.fuertes.set(p.e.id, (a.fuertes.get(p.e.id) ?? 0) + 1);
    artistas.set(k, a);
  }
  const out = new Map<string, Escena>();
  for (const t of tracks) {
    if (t.categorias?.length || t.contexto?.length || !t.year) continue;
    const tags = tagsDe.get(t.id)!;
    const a = artistas.get(artistaPrincipal(t.artist))!;
    const parte = (g: string) => (a.tags.get(g) ?? 0) / a.n;
    // Una reedición o recopilatorio trae un año muy posterior: vale la época habitual del artista.
    const anios = [...a.anios].sort((x, y) => x - y);
    const habitual = anios[anios.length >> 1];
    const anio = a.n >= 5 && t.year - habitual > REEDICION ? habitual : t.year;
    const corregida = CORRECCIONES[artistaPrincipal(t.artist)];
    if (corregida !== undefined) {
      const e = ESCENAS.find((x) => x.id === corregida);
      if (e && anio >= e.desde && anio <= e.hasta) out.set(t.id, e);
      continue;
    }
    const opciones: [Preparada, number][] = [];
    for (const p of PREPARADAS) {
      if (anio < p.e.desde || anio > p.e.hasta) continue;
      if (tags.some((g) => p.excluye.has(g))) continue;
      if ([...p.excluye].some((g) => parte(g) >= EXCLUSION_ARTISTA)) continue;
      if (t.vibe && p.e.sonido && !p.e.sonido(t.vibe)) continue;
      const identidad = (a.fuertes.get(p.e.id) ?? 0) / a.n;
      const propia = tags.some((g) => p.fuertes.has(g));
      if (!propia && identidad < IDENTIDAD_ARTISTA) continue;
      const puntos = tags.reduce((x, g) => x + (p.fuertes.has(g) ? 3 : p.apoyo.has(g) ? 1 : 0), 0) + 3 * identidad;
      opciones.push([p, puntos]);
    }
    opciones.sort((x, y) => y[1] - x[1]);
    const [uno, dos] = opciones;
    if (uno && (!dos || uno[1] >= MARGEN * dos[1])) out.set(t.id, uno[0].e);
  }
  // Coherencia: si un artista casi nunca está en una escena, esa canción suya no la representa.
  const cuenta = new Map<string, Map<string, number>>();
  const artistaDe = new Map(tracks.map((t) => [t.id, artistaPrincipal(t.artist)]));
  for (const [id, e] of out) {
    const k = artistaDe.get(id)!;
    const m = cuenta.get(k) ?? new Map<string, number>();
    m.set(e.id, (m.get(e.id) ?? 0) + 1);
    cuenta.set(k, m);
  }
  for (const [id, e] of [...out]) {
    const m = cuenta.get(artistaDe.get(id)!)!;
    const total = [...m.values()].reduce((x, y) => x + y, 0);
    if (total >= 4 && m.get(e.id)! / total < COHERENCIA_ARTISTA) out.delete(id);
  }
  return out;
}
