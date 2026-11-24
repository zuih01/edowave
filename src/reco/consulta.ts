import type { Track, Vibe } from '../types';
import { dailyNoise, diverse, isTestSilence, mundoDe, type Model } from './engine';
import { clasificarEscenas } from './escenas';

/**
 * Búsquedas que piden una LISTA, no una canción: "80s", "2015 popular", "hits de los 80", "r&b de los 90",
 * "reggaetón viejo", "rock clásico", "música para entrenar"…
 *  - La búsqueda se reconoce solo si TODAS sus palabras son de época, estilo, ánimo o de relleno ("de", "los",
 *    "songs"…). "Daft Punk" o "Pop Smoke" no son listas: les sobra una palabra.
 *  - Con la consulta, el servidor arma la lista con su catálogo: lo más conocido (éxitos de fin de año,
 *    popularidad) y lo que va con cada persona.
 */

export interface Estilo {
  id: string;
  nombre: string;
  /** Cómo lo escribe la gente (sobre el texto ya normalizado). */
  alias: RegExp;
  /** ¿Esta etiqueta de género (normalizada) es del estilo? */
  tags?: (g: string) => boolean;
  /** Etiquetas que lo descartan (en la canción o típicas de su artista). */
  sin?: (g: string) => boolean;
  /**
   * Escenas que valen (las mismas de los Mix diario, ver escenas.ts). Si el estilo las tiene, mandan ellas y no
   * las etiquetas sueltas: así "rock" no trae pop con una etiqueta "rock" ni "electrónica" trae a Cher.
   */
  escenas?: string[];
  escenasViejo?: string[];
  /** Estilos que son una categoría especial (anime, OST de videojuego, meme). */
  categoria?: string;
  sonido?: (v: Vibe) => boolean;
  /** "viejo", "old school", "clásico": su época antigua. */
  viejo?: [number, number];
  nombreViejo?: string;
}

const re = (r: RegExp) => (g: string) => r.test(g);
const URBANO = /hip hop|\brap\b|trap|reggaeton|urbano latino|latin urban|dembow|k pop|korean/;

/** Orden importante: los nombres largos primero ("rock en español" antes que "rock", "k-pop" antes que "pop"). */
export const ESTILOS: Estilo[] = [
  { id: 'reggaeton', nombre: 'Reggaetón', alias: /\b(reggaeton|regueton|reggueton|reggeton|regeton|reguetton|reggaetton|perreo|urbano latino|musica urbana)\b/,
    tags: re(/reggaeton|urbano latino|latin urban|dembow|perreo|trap latino|latin trap/), viejo: [1990, 2009], nombreViejo: 'Reggaetón old school' },
  { id: 'rock-espanol', escenas: ['rock-espanol'],  nombre: 'Rock en español', alias: /\brock (en )?espanol\b|\brock (latino|nacional|chileno|argentino)\b/,
    tags: re(/rock en espanol|rock latino|latin rock|rock nacional|rock chileno|rock argentino/) },
  { id: 'pop-punk', nombre: 'Pop punk', alias: /\bpop punk\b/, tags: re(/pop punk|emo/) },
  { id: 'pop-latino', escenas: ['pop-latino'],  nombre: 'Pop latino', alias: /\bpop (latino|en espanol)\b|\blatin pop\b/, tags: re(/latin pop|pop latino|pop en espanol/), sin: re(/reggaeton|urbano latino/) },
  { id: 'kpop', escenas: ['kpop'],  nombre: 'K-pop', alias: /\bk ?pop\b|\bcorean[oa]s?\b/, tags: re(/k pop|korean/) },
  { id: 'jpop', nombre: 'J-pop', alias: /\bj ?pop\b|\bjapones(as|es)?\b/, tags: re(/j pop|japanese|anisong/) },
  { id: 'hiphop', escenas: ['hiphop-clasico', 'hiphop-actual'], escenasViejo: ['hiphop-clasico'],  nombre: 'Hip hop', alias: /\bhip ?hop\b|\brap\b|\braperos?\b/,
    tags: re(/hip hop|\brap\b|gangsta|g funk|boom bap|drill/), sin: re(/reggaeton|urbano latino|latin trap|trap latino|k pop/),
    viejo: [1985, 2002], nombreViejo: 'Hip hop old school' },
  { id: 'trap', nombre: 'Trap', alias: /\btrap\b/, tags: re(/\btrap\b|rage|drill/), sin: re(/reggaeton|urbano latino|latin trap|trap latino/) },
  { id: 'rnb', escenas: ['rnb'],  nombre: 'R&B', alias: /\brnb\b/, tags: re(/\br&b\b|\brnb\b|^r b$|new jack swing|neo soul|quiet storm/), viejo: [1986, 2005] },
  { id: 'soul', escenas: ['soul'],  nombre: 'Soul y funk', alias: /\bsoul\b|\bfunk\b|\bmotown\b/, tags: re(/\bsoul\b|\bfunk\b|motown/), sin: re(/neo soul/) },
  { id: 'metal', escenas: ['metal'],  nombre: 'Metal', alias: /\bmetal\b|\bmetaleros?\b/, tags: re(/metal/) },
  { id: 'grunge', nombre: 'Grunge', alias: /\bgrunge\b/, tags: re(/grunge/) },
  { id: 'punk', nombre: 'Punk', alias: /\bpunk\b/, tags: re(/\bpunk\b/), sin: re(/post punk/) },
  { id: 'indie', escenas: ['indie-pop', 'indie-rock'],  nombre: 'Indie', alias: /\bindie\b/, tags: re(/indie|dream pop|bedroom pop|chamber pop/), sin: re(URBANO) },
  { id: 'rock', escenas: ['rock-clasico', 'rock-alternativo', 'indie-rock', 'rock-espanol'], escenasViejo: ['rock-clasico'],  nombre: 'Rock', alias: /\brock\b|\brockeras?\b|\brockeros?\b/,
    tags: (g) => (/\brock\b|grunge|britpop|\bpunk\b|\baor\b/.test(g) && !/pop rock|soft rock|^pop$/.test(g)),
    sin: re(/dance pop|teen pop|k pop|reggaeton|hip hop|\brap\b/),
    viejo: [1967, 1989], nombreViejo: 'Rock clásico' },
  { id: 'disco', escenas: ['disco'],  nombre: 'Disco', alias: /\bdisco\b/, tags: re(/disco|hi nrg|boogie/) },
  { id: 'synth', escenas: ['synth'],  nombre: 'Synth pop y new wave', alias: /\bsynth ?pop\b|\bsynth\b|\bnew wave\b/, tags: re(/synth ?pop|new wave|new romantic/) },
  { id: 'house', nombre: 'House', alias: /\bhouse\b/, tags: re(/house/), sin: re(URBANO) },
  { id: 'techno', nombre: 'Techno', alias: /\btechno\b|\btecno\b/, tags: re(/techno/) },
  { id: 'trance', nombre: 'Trance', alias: /\btrance\b/, tags: re(/trance/) },
  { id: 'eurodance', nombre: 'Eurodance', alias: /\beurodance\b|\beuro dance\b/, tags: re(/eurodance|euro house|italo dance|europop/), sonido: (v) => v.electronica >= 0.3 },
  { id: 'electronica', escenas: ['electronica-actual', 'club-clasico'], escenasViejo: ['club-clasico'],  nombre: 'Electrónica', alias: /\belectronic[ao]s?\b|\bedm\b|\belectro\b|\bdubstep\b|\bdrum (and|n) bass\b/,
    tags: re(/electronic|\bedm\b|house|techno|trance|dubstep|drum and bass|jungle|\belectro\b|electro house|eurodance|big room|hardstyle|future bass|club/),
    sin: re(URBANO), sonido: (v) => v.electronica >= 0.35, viejo: [1988, 2007], nombreViejo: 'Electrónica clásica' },
  { id: 'anime', nombre: 'Anime', alias: /\banimes?\b|\banisong\b/, categoria: 'anime' },
  { id: 'videojuegos', nombre: 'Videojuegos', alias: /\bvideo ?juegos?\b|\bvideo ?games?\b|\bgaming\b|\bgamer\b|\bost\b|\bjuegos\b/, categoria: 'ost-videojuego' },
  { id: 'memes', nombre: 'Memes', alias: /\bmemes?\b/, categoria: 'meme' },
  { id: 'cumbia', nombre: 'Cumbia', alias: /\bcumbias?\b/, tags: re(/cumbia/) },
  { id: 'salsa', nombre: 'Salsa', alias: /\bsalsa\b/, tags: re(/salsa/) },
  { id: 'bachata', nombre: 'Bachata', alias: /\bbachatas?\b/, tags: re(/bachata/) },
  { id: 'merengue', nombre: 'Merengue', alias: /\bmerengues?\b/, tags: re(/merengue/) },
  { id: 'tropical', nombre: 'Música tropical', alias: /\btropical\b/, tags: re(/tropical|cumbia|salsa|merengue|bachata/), sin: re(/tropical house/) },
  { id: 'corridos', nombre: 'Regional mexicano', alias: /\bcorridos?\b|\bregional mexicano\b|\bmariachi\b|\brancheras?\b/, tags: re(/corrido|regional mexican|mariachi|norteno|ranchera/) },
  { id: 'reggae', nombre: 'Reggae', alias: /\breggae\b/, tags: re(/\breggae\b|dancehall|\bska\b/), sin: re(/reggaeton/) },
  { id: 'baladas', escenas: ['baladas'],  nombre: 'Baladas', alias: /\bbaladas?\b|\bromantic[ao]s?\b|\blentas\b/,
    tags: re(/ballad|balada|soft rock|adult contemporary|bolero|quiet storm/), sin: re(/metal|hard rock|punk/) },
  { id: 'jazz', escenas: ['jazz'],  nombre: 'Jazz', alias: /\bjazz\b/, tags: re(/jazz|bossa nova/) },
  { id: 'blues', nombre: 'Blues', alias: /\bblues\b/, tags: re(/blues/) },
  { id: 'country', escenas: ['country'],  nombre: 'Country y folk', alias: /\bcountry\b|\bfolk\b/, tags: re(/country|americana|bluegrass|\bfolk\b/), sin: re(/folk rock|k pop/) },
  { id: 'lofi', nombre: 'Lo-fi', alias: /\blo ?fi\b|\bchill ?hop\b/, tags: re(/lo fi|chillhop|chill hop/) },
  { id: 'soundtrack', nombre: 'Bandas sonoras', alias: /\bpeliculas?\b|\bsoundtracks?\b|\bbandas? sonoras?\b/, tags: re(/soundtrack|movie|film/) },
  { id: 'latino', nombre: 'Música latina', alias: /\blatin[oa]s?\b|\ben espanol\b|\bespanol\b/,
    tags: re(/latin|en espanol|tropical|reggaeton|urbano latino|salsa|cumbia|bachata|merengue|spanish/) },
  { id: 'pop', escenas: ['pop-clasico', 'pop-actual', 'synth'],  nombre: 'Pop', alias: /\bpop\b/, tags: (g) => /\bpop\b/.test(g) && !/k pop|j pop|latin|pop rap|pop punk/.test(g),
    sin: re(/reggaeton|urbano latino|hip hop|\brap\b|\btrap\b|k pop|korean|metal/), viejo: [1980, 1999] },
];

interface Animo {
  id: string;
  alias: RegExp;
  texto: string;
  vale: (v: Vibe) => boolean;
}
const ANIMOS: Animo[] = [
  { id: 'fiesta', alias: /\bfiestas?\b|\bfiester[ao]s?\b|\bcarretes?\b|\bparty\b|\bprevia\b/, texto: 'para la fiesta', vale: (v) => v.fiesta >= 0.5 },
  { id: 'triste', alias: /\btristes?\b|\bsad\b|\bllorar\b|\bdespecho\b|\bdepre\b/, texto: 'tristes', vale: (v) => v.triste >= 0.5 },
  { id: 'relajada', alias: /\bchill\b|\brelajad[ao]s?\b|\brelajarse\b|\brelax\b|\btranquil[ao]s?\b|\bcalma\b|\bestudiar\b|\bdormir\b/, texto: 'para relajarse', vale: (v) => v.relajada >= 0.5 },
  { id: 'bailar', alias: /\bbailar\b|\bbailables?\b|\bbailando\b/, texto: 'para bailar', vale: (v) => v.bailable >= 0.55 },
  { id: 'entrenar', alias: /\bentrenar\b|\bgym\b|\bgimnasio\b|\bworkout\b|\bejercicio\b|\bcorrer\b|\bentrenamiento\b/, texto: 'para entrenar', vale: (v) => v.relajada < 0.4 && v.triste < 0.4 && v.acustica < 0.5 && (v.agresiva >= 0.55 || (v.fiesta >= 0.6 && v.bailable >= 0.6)) },
  { id: 'feliz', alias: /\bfeli(z|ces)\b|\balegres?\b|\bhappy\b|\bbuena onda\b/, texto: 'alegres', vale: (v) => v.feliz >= 0.5 },
];

const EXITOS = /\b(hits?|exitos?|popular(es)?|famosas?|famosos?|conocidas?|conocidos?|mejores|mejor|greatest|best|top( \d+)?|clasicos?|clasicas?)\b/g;
const CLASICO = /\b(clasicos?|clasicas?)\b/;
const VIEJO = /\b(viejos?|viejas?|antiguos?|antiguas?|old ?school|old|de antes|vieja escuela|retro|del ayer)\b/g;
const NUEVO = /\b(nuevos?|nuevas?|actual(es)?|recientes?|new|de ahora|del momento|ultim[ao]s?)\b/g;
const RELLENO = new Set(
  'de del los las la el lo y e en para con songs song canciones cancion musica music mix lista playlist anos ano decada the of from temas tema mas a al era epoca tipo estilo genero generos puro pura solo onda s and un una que in'.split(' '),
);

export interface Consulta {
  titulo: string;
  descripcion: string;
  estilos: Estilo[];
  animos: Animo[];
  desde?: number;
  hasta?: number;
  /** Ordenar por lo más conocido (pidió "hits", "éxitos", "populares", "clásicos"). */
  exitos: boolean;
  /** Pidió la época antigua del estilo ("rock clásico", "reggaetón viejo"). */
  viejo: boolean;
}

/** Texto comparable: minúsculas, sin acentos, "r&b" = "rnb", "80's" = "80s". */
export const normalizarConsulta = (q: string) =>
  q
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['’´`]/g, '')
    .replace(/\br\s*(&|and|n|y)\s*b\b|\br b\b/g, ' rnb ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const decada = (d: number): [number, number] => [d, d + 9];
const PALABRAS_DECADA: [RegExp, number][] = [
  [/\bcincuentas?\b/g, 1950],
  [/\bsesentas?\b|\bsesenter[ao]s?\b/g, 1960],
  [/\bsetentas?\b|\bsetenter[ao]s?\b/g, 1970],
  [/\bochentas?\b|\bochenter[ao]s?\b/g, 1980],
  [/\bnoventas?\b|\bnoventer[ao]s?\b/g, 1990],
  [/\bdos ?mil\b/g, 2000],
];

/** ¿Esta búsqueda pide una lista? Devuelve qué lista, o null si es una búsqueda normal. */
export function interpretarBusqueda(q: string, anioActual = new Date().getFullYear()): Consulta | null {
  let s = ` ${normalizarConsulta(q)} `;
  if (s.trim().length < 2) return null;
  const quitar = (r: RegExp) => {
    let hubo = false;
    s = s.replace(r, () => {
      hubo = true;
      return ' ';
    });
    return hubo;
  };

  // Época
  let era: [number, number] | null = null;
  const rango = /\b(19[5-9]\d|20[0-3]\d)\s*(?:a|al|hasta|to)?\s+(19[5-9]\d|20[0-3]\d)\b/.exec(s);
  if (rango) {
    const [a, b] = [+rango[1], +rango[2]].sort((x, y) => x - y);
    era = [a, b];
    s = s.replace(rango[0], ' ');
  }
  if (!era) {
    const m = /\b(?:los |anos |decada (?:de )?(?:los )?)?(19[5-9]0|20[0-3]0) ?s\b|\b(?:los|anos|decada(?: de)?(?: los)?) (19[5-9]0|20[0-3]0)\b/.exec(s);
    if (m) {
      era = decada(+(m[1] ?? m[2]));
      s = s.replace(m[0], ' ');
    }
  }
  if (!era) {
    const m = /\b(?:los |anos )?([5-9]0|00|10|20) ?s\b|\b(?:los|anos|decada(?: de)?(?: los)?) ([5-9]0)\b/.exec(s);
    if (m) {
      const d = +(m[1] ?? m[2]);
      era = decada(d >= 50 ? 1900 + d : 2000 + d);
      s = s.replace(m[0], ' ');
    }
  }
  if (!era) for (const [r, d] of PALABRAS_DECADA) if (quitar(r)) era = decada(d);
  if (!era) {
    const m = /\b(19[5-9]\d|20[0-3]\d)\b/.exec(s);
    if (m && +m[1] <= anioActual) {
      era = [+m[1], +m[1]];
      s = s.replace(m[0], ' ');
    }
  }

  // Estilos y ánimos (los nombres largos se quitan primero, así "rock en español" no deja un "rock" suelto).
  const estilos: Estilo[] = [];
  for (const e of ESTILOS) if (quitar(new RegExp(e.alias.source, 'g'))) estilos.push(e);
  const animos: Animo[] = [];
  for (const a of ANIMOS) if (quitar(new RegExp(a.alias.source, 'g'))) animos.push(a);

  const clasico = CLASICO.test(s);
  const exitos = quitar(EXITOS);
  const viejo = quitar(VIEJO);
  const nuevo = quitar(NUEVO);

  // Todo lo que queda tiene que ser relleno: si sobra una palabra, es una búsqueda normal ("Daft Punk").
  if (s.split(' ').some((w) => w && !RELLENO.has(w))) return null;
  if (!estilos.length && !animos.length && !era && !exitos && !viejo && !nuevo) return null;

  // Rango final
  let desde = era?.[0];
  let hasta = era?.[1];
  let nombreEstilo = estilos.map((e) => e.nombre).join(' y ');
  const uno = estilos.length === 1 ? estilos[0] : null;
  const antiguo = (viejo || clasico) && !era;
  if (antiguo) {
    if (uno?.viejo) {
      [desde, hasta] = uno.viejo;
      nombreEstilo = uno.nombreViejo ?? `${uno.nombre} clásico`;
    } else hasta = 1999;
  } else if (nuevo && !era) {
    desde = anioActual - 3;
    if (nombreEstilo) nombreEstilo = `${nombreEstilo} actual`;
  }

  const textoEra = (() => {
    if (!era) return '';
    const [a, b] = era;
    if (a === b) return `de ${a}`;
    if (a % 10 === 0 && b === a + 9) return a < 2000 ? `de los ${a % 100}` : `de los ${a}`;
    return `de ${a} a ${b}`;
  })();
  const minuscula = (t: string) => (/^\p{Lu}\p{Ll}/u.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
  // "Éxitos" solo cuando lo pidió con esas palabras; "rock clásico" ya dice qué es.
  const pidioExitos = exitos && !(clasico && uno?.viejo && antiguo);
  let titulo: string;
  if (nombreEstilo) titulo = pidioExitos ? `Éxitos de ${minuscula(nombreEstilo)}` : nombreEstilo;
  else if (clasico || (antiguo && !exitos)) titulo = 'Clásicos';
  else if (exitos) titulo = 'Éxitos';
  else if (nuevo) titulo = 'Lo más nuevo';
  else if (era) titulo = 'Lo mejor';
  else titulo = animos[0]?.texto.startsWith('para') ? 'Música' : 'Canciones';
  titulo = [titulo, textoEra, animos.map((a) => a.texto).join(' y ')].filter(Boolean).join(' ');

  const rangoTxt = desde && hasta ? (desde === hasta ? `${desde}` : `${desde}–${hasta}`) : desde ? `desde ${desde}` : hasta ? `hasta ${hasta}` : '';
  const descripcion = [estilos.map((e) => e.nombre).join(', '), rangoTxt, animos.map((a) => a.texto).join(', ')].filter(Boolean).join(' · ');

  return { titulo, descripcion, estilos, animos, desde, hasta, exitos: exitos || clasico || antiguo, viejo: !!(antiguo && uno?.viejo) };
}

// ---------------- La lista ----------------

const tagNorm = (g: string) => g.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
const artistaPrincipal = (a: string) => tagNorm(a.split(/,|\s+(?:feat\.?|ft\.?|con|with|&|y|x)\s+/i)[0] ?? a);

interface Perfil {
  tags: Map<string, string[]>; // canción → etiquetas normalizadas
  artista: Map<string, string>; // canción → artista principal
  artistas: Map<string, { ids: string[]; anioHabitual?: number }>;
  /** estilo → artista → cuántas de sus canciones tienen una etiqueta de ese estilo (o la que lo descarta) */
  cuentas: Map<string, Map<string, number>>;
  escena: Map<string, string>; // canción → escena (las dudosas no tienen)
}
const perfiles = new WeakMap<Track[], Perfil>();
function perfilDe(tracks: Track[]): Perfil {
  let p = perfiles.get(tracks);
  if (p) return p;
  p = {
    tags: new Map(),
    artista: new Map(),
    artistas: new Map(),
    cuentas: new Map(),
    escena: new Map([...clasificarEscenas(tracks)].map(([id, e]) => [id, e.id])),
  };
  const anios = new Map<string, number[]>();
  for (const t of tracks) {
    p.tags.set(t.id, [...new Set(t.genres.map(tagNorm))]);
    const k = artistaPrincipal(t.artist);
    p.artista.set(t.id, k);
    const a = p.artistas.get(k) ?? { ids: [] };
    a.ids.push(t.id);
    p.artistas.set(k, a);
    if (t.year) anios.set(k, [...(anios.get(k) ?? []), t.year]);
  }
  for (const [k, a] of p.artistas) {
    const l = (anios.get(k) ?? []).sort((x, y) => x - y);
    if (l.length >= 5) a.anioHabitual = l[l.length >> 1];
  }
  perfiles.set(tracks, p);
  return p;
}
/** Qué parte de las canciones del artista tiene alguna etiqueta que cumple `f`. */
function parteArtista(p: Perfil, clave: string, artista: string, f: (g: string) => boolean) {
  let m = p.cuentas.get(clave);
  if (!m) {
    m = new Map();
    for (const [k, a] of p.artistas) m.set(k, a.ids.filter((id) => p.tags.get(id)!.some(f)).length);
    p.cuentas.set(clave, m);
  }
  return (m.get(artista) ?? 0) / (p.artistas.get(artista)?.ids.length || 1);
}

/** Año de la canción; una reedición o recopilatorio muy posterior vale la época habitual del artista. */
function anioDe(p: Perfil, t: Track) {
  if (t.exito?.anio) return t.exito.anio; // el año en que fue éxito es confiable
  const y = t.year;
  const h = p.artistas.get(p.artista.get(t.id)!)?.anioHabitual;
  return y && h && y - h > 15 ? h : y;
}

function cumpleEstilo(p: Perfil, e: Estilo, t: Track, viejo: boolean) {
  const mundo = mundoDe(t);
  if (e.categoria) return mundo.includes(e.categoria);
  if (mundo.length) return false;
  const escenas = (viejo && e.escenasViejo) || e.escenas;
  if (escenas) return escenas.includes(p.escena.get(t.id) ?? '');
  if (!e.tags) return false;
  const tags = p.tags.get(t.id)!;
  const artista = p.artista.get(t.id)!;
  if (e.sin && (tags.some(e.sin) || parteArtista(p, `${e.id}:sin`, artista, e.sin) >= 0.4)) return false;
  if (e.sonido && t.vibe && !e.sonido(t.vibe)) return false;
  if (tags.some(e.tags)) return true;
  // Sin etiquetas propias (o solo generales), vale lo que suele tocar su artista.
  return parteArtista(p, e.id, artista, e.tags) >= (tags.length ? 0.5 : 0.4);
}

const MIN_LISTA = 8;

/** Las canciones de la lista pedida, ordenadas para esta persona (vacía si hay muy pocas). */
export function listaDeBusqueda(m: Model, c: Consulta, n = 50): string[] {
  const p = perfilDe(m.input.tracks);
  const aff = [...m.baseAffinity.values()];
  const lo = aff.length ? Math.min(...aff) : 0;
  const hi = aff.length ? Math.max(...aff) : 0;
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const puntaje: [string, number][] = [];
  for (const t of m.input.tracks) {
    if (m.input.ratings[t.id] === -1 || isTestSilence(m, t.id)) continue;
    if (c.estilos.length ? !c.estilos.some((e) => cumpleEstilo(p, e, t, c.viejo)) : mundoDe(t).length) continue;
    if (c.desde || c.hasta) {
      const y = anioDe(p, t);
      if (!y || (c.desde && y < c.desde) || (c.hasta && y > c.hasta)) continue;
    }
    if (c.animos.length && (!t.vibe || !c.animos.every((a) => a.vale(t.vibe!)))) continue;
    const enHot100 = t.genres.some((g) => /billboard|hot 100/i.test(g));
    const exito = t.exito?.valor ?? 0;
    const pop = Math.max(t.pop ?? 0.25, m.input.billboard.has(t.id) ? 0.9 : 0, enHot100 ? 0.8 : 0, exito ? 0.6 + 0.4 * exito : 0);
    const raro = /megamix|medley|\bmix\b|karaoke|christmas|navidad|instrumental|remix|live|en vivo|extended|demo\b/i.test(`${t.title} ${t.album}`) ? 0.25 : 0;
    const tuyo = norm(m.baseAffinity.get(t.id) ?? 0);
    const base = c.exitos ? 0.25 * tuyo + 0.55 * pop + 0.15 * exito : 0.45 * tuyo + 0.45 * pop;
    puntaje.push([t.id, base + 0.06 * dailyNoise(t.id, m.input.now) - raro]);
  }
  if (puntaje.length < MIN_LISTA) return [];
  puntaje.sort((a, b) => b[1] - a[1]);
  return diverse(m, puntaje.map(([id]) => id), n, c.exitos ? 2 : 3);
}
