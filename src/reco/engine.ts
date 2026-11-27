import type { AudioFeatures, PlayEvent } from '../db';
import { normalize } from '../library/fuzzy';
import type { Track } from '../types';
import { foldBpm } from './bpm';
import { clasificarEscenas, ESCENAS, type Escena } from './escenas';

const ESCENAS_POR_NOMBRE = new Map(ESCENAS.map((e) => [e.nombre, e]));

/**
 * El algoritmo de recomendación. Todo se calcula en el teléfono con tu propia biblioteca.
 *
 * 1) AFINIDAD: cuánto te gusta cada canción, según
 *    - escuchas completas (+), saltadas (−), y si fueron hace poco
 *    - "me gusta" (+ fuerte) y "no me gusta" (− muy fuerte, pero no desaparece)
 *    - cuánto te gusta su artista y sus géneros (una canción nueva de un artista que amas sube)
 *    - la hora: si a esta hora sueles escuchar a ese artista
 *    - si está en el Billboard Hot 100 de esta semana
 * 2) ÁNIMO: con el análisis de audio (energía, ritmo, pulso, brillo) y los géneros.
 * 3) SIMILITUD entre canciones (para la radio): artista, álbum, géneros, sonido parecido
 *    y lo que sueles escuchar una después de otra.
 */

export type MoodId = 'trending' | 'activate' | 'relax' | 'feelgood' | 'romance' | 'sad' | 'party' | 'workout' | 'focus' | 'sleep';

export const MOODS: { id: MoodId; label: string }[] = [
  { id: 'trending', label: 'Tendencia' }, // siempre la primera: lo que está en el Billboard Hot 100 esta semana
  { id: 'activate', label: 'Actívate' },
  { id: 'relax', label: 'Relajación' },
  { id: 'feelgood', label: 'Para sentirte bien' },
  { id: 'romance', label: 'Romance' },
  { id: 'sad', label: 'Triste' },
  { id: 'party', label: 'Fiesta' },
  { id: 'workout', label: 'Entrenamiento' },
  { id: 'focus', label: 'Concentración' },
  { id: 'sleep', label: 'Sueño' },
];

export interface RecoInput {
  tracks: Track[];
  plays: PlayEvent[];
  ratings: Record<string, 1 | -1>;
  features: Map<string, AudioFeatures>;
  /** trackId → puesto en el Hot 100 de esta semana */
  billboard: Map<string, number>;
  now: number;
  /** Canciones que suelen gustarles a las mismas personas: id → (id → parecido 0–1). No dice quiénes. */
  vecinos?: Map<string, Map<string, number>>;
  /**
   * YouTube Music (sin sesión, igual para todos): canción → (canción del servidor → 0–1) según su radio y su
   * "Relacionado". Dice qué va con qué; desde dónde parte cada cuenta lo decide este motor.
   */
  ytm?: Map<string, Map<string, number>>;
  /** Canciones que la cuenta buscó y tocó hace poco (la más nueva primero). */
  buscadas?: string[];
  /** Cómo resultó lo que ya se te recomendó: sirve para ajustar la exploración a tu cuenta. */
  resultados?: ResultadoReco[];
}

export interface ResultadoReco {
  trackId: string;
  motivo: string;
  exito: boolean;
}

/** Una canción recomendada y por qué se eligió (para medir si acertó). */
export interface ItemReco {
  id: string;
  motivo: 'parecido' | 'colab' | 'explora' | 'conocida';
}

export interface TrackStats {
  plays: number;
  completes: number;
  skips: number;
  recentCompletes: number;
  lastPlayed: number;
}

export interface Model {
  input: RecoInput;
  byId: Map<string, Track>;
  stats: Map<string, TrackStats>;
  /** Afinidad sin el castigo de "lo acabas de escuchar" (para Redescubre). */
  baseAffinity: Map<string, number>;
  /** Afinidad lista para ordenar recomendaciones ahora mismo. */
  affinity: Map<string, number>;
  /** Rasgos de sonido normalizados 0–1 respecto a tu biblioteca. */
  sound: Map<string, SoundVec>;
  mood: Record<MoodId, Map<string, number>>;
  /** Cuántas veces escuchaste B justo después de A. clave `${A}>${B}` */
  transitions: Map<string, number>;
  /** Cuántas veces SALTASTE B justo después de A (la radio lo recuerda de una vez para otra). clave `${A}>${B}` */
  saltosTras: Map<string, number>;
}

interface SoundVec {
  energy: number;
  activity: number;
  beat: number;
  brightness: number;
  dynamics: number;
  fast: number; // tempo rápido (0–1)
  dance: number; // tempo bailable, cerca de 118–128 BPM (0–1)
}

const DAY = 86_400_000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------- Géneros ----------------

const GENRE_GROUPS: Record<string, string[]> = {
  energetic: ['rock', 'metal', 'punk', 'edm', 'electronic', 'electro', 'hip hop', 'hip-hop', 'rap', 'trap', 'reggaeton', 'drum and bass', 'dubstep', 'hard', 'grunge'],
  workout: ['edm', 'hip hop', 'hip-hop', 'rap', 'trap', 'metal', 'rock', 'reggaeton', 'dance', 'electro', 'house', 'drum and bass', 'dubstep'],
  party: ['dance', 'pop', 'latin', 'reggaeton', 'house', 'disco', 'funk', 'hip hop', 'hip-hop', 'electropop', 'k-pop', 'dancehall', 'cumbia', 'salsa', 'merengue', 'bachata'],
  calm: ['acoustic', 'ambient', 'chill', 'jazz', 'soul', 'r&b', 'rnb', 'folk', 'lofi', 'lo-fi', 'bossa', 'ballad', 'singer-songwriter', 'downtempo', 'trip hop', 'classical'],
  focus: ['ambient', 'classical', 'instrumental', 'lofi', 'lo-fi', 'jazz', 'piano', 'soundtrack', 'post-rock', 'downtempo', 'chillout', 'new age'],
  happy: ['pop', 'funk', 'disco', 'soul', 'motown', 'k-pop', 'dance-pop', 'electropop', 'reggae', 'latin', 'new jack swing'],
  romance: ['r&b', 'rnb', 'soul', 'neo-soul', 'quiet storm', 'slow jam', 'ballad', 'bolero', 'bachata', 'soft rock', 'adult contemporary', 'smooth', 'love'],
  sad: ['sad', 'emo', 'blues', 'ballad', 'singer-songwriter', 'slowcore', 'melanchol', 'dream pop', 'shoegaze', 'downtempo', 'trip hop'],
  sleep: ['ambient', 'new age', 'piano', 'lullaby', 'classical', 'downtempo', 'acoustic', 'meditation', 'chillout', 'lo-fi', 'lofi'],
};

/** Palabras del título que delatan el tema de la canción (en inglés y español). */
const TITLE_WORDS: Record<'romance' | 'sad', RegExp> = {
  romance: /(?<!\p{L})(love|lover|kiss|heart|baby|darling|honey|amor|beso|besos|corazón|corazon|cariño|enamora|te quiero|mi vida|smile)(?!\p{L})/iu,
  sad: /(?<!\p{L})(cry|crying|tears|alone|lonely|goodbye|sad|miss|missing|lost|broken|sorry|hurt|without you|llorar|lágrimas|triste|soledad|adiós|adios|sin ti|dolor|olvidar|perdí)(?!\p{L})/iu,
};
const titleScore = (t: Track, k: 'romance' | 'sad') => (TITLE_WORDS[k].test(t.title) ? 1 : 0);

function genreScore(t: Track, group: keyof typeof GENRE_GROUPS) {
  const words = GENRE_GROUPS[group];
  const g = t.genres.map((x) => x.toLowerCase());
  return g.some((x) => words.some((w) => x.includes(w))) ? 1 : 0;
}

// ---------------- Modelo ----------------

function percentile(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number) => {
    if (sorted.length < 2) return 0.5;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / (sorted.length - 1);
  };
}

/** Ruido estable por día: los empates cambian de un día a otro, pero no cada vez que abres la app. */
export function dailyNoise(id: string, now: number) {
  const day = Math.floor(now / DAY);
  let h = 2166136261 ^ day;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function buildModel(input: RecoInput): Model {
  const { tracks, plays, ratings, features, billboard, now } = input;
  const byId = new Map(tracks.map((t) => [t.id, t]));

  // --- Estadísticas de escucha ---
  const stats = new Map<string, TrackStats>();
  const transitions = new Map<string, number>();
  const saltosTras = new Map<string, number>();
  const hourHist = new Map<string, number[]>(); // artista → escuchas por hora del día
  const nowHour = new Date(now).getHours();
  for (const p of plays) {
    const s = stats.get(p.trackId) ?? { plays: 0, completes: 0, skips: 0, recentCompletes: 0, lastPlayed: 0 };
    // Una escucha completa vale según lo que dura: terminar una intro de 10 s no dice tanto como una canción entera.
    const w = Math.min(1, (p.duration || 0) / 60);
    s.plays += Math.max(w, p.skipped ? 1 : 0);
    if (p.completed) s.completes += w;
    if (p.skipped) s.skips++;
    if (p.completed && now - p.startedAt < 30 * DAY) s.recentCompletes += w;
    s.lastPlayed = Math.max(s.lastPlayed, p.startedAt);
    stats.set(p.trackId, s);
    if (p.prevTrackId && !p.skipped) {
      const k = `${p.prevTrackId}>${p.trackId}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
    if (p.prevTrackId && p.skipped) {
      const k = `${p.prevTrackId}>${p.trackId}`;
      saltosTras.set(k, (saltosTras.get(k) ?? 0) + 1);
    }
    const t = byId.get(p.trackId);
    if (t && !p.skipped) {
      const h = hourHist.get(t.artist) ?? new Array(24).fill(0);
      h[new Date(p.startedAt).getHours()]++;
      hourHist.set(t.artist, h);
    }
  }

  // --- Afinidad propia de cada canción ---
  const own = new Map<string, number>();
  for (const t of tracks) {
    const s = stats.get(t.id);
    let a = 0;
    if (s) {
      a += 0.8 * Math.log1p(s.completes) + 0.4 * Math.log1p(s.recentCompletes) - 0.7 * Math.log1p(s.skips);
      if (s.plays) a += 0.6 * (s.completes / s.plays - 0.5);
    }
    if (ratings[t.id] === 1) a += 2.5;
    if (ratings[t.id] === -1) a -= 5; // casi nunca se recomienda, pero no desaparece
    own.set(t.id, a);
  }

  // --- Afinidad de artista y género (promedio "prudente": con pocas canciones pesa menos) ---
  const groupAff = (keyOf: (t: Track) => string[]) => {
    const sum = new Map<string, number>();
    const n = new Map<string, number>();
    for (const t of tracks) {
      const a = own.get(t.id) ?? 0;
      if (!a) continue;
      for (const k of keyOf(t)) {
        sum.set(k, (sum.get(k) ?? 0) + a);
        n.set(k, (n.get(k) ?? 0) + 1);
      }
    }
    const out = new Map<string, number>();
    for (const [k, v] of sum) out.set(k, v / ((n.get(k) ?? 0) + 2));
    return out;
  };
  const artistAff = groupAff((t) => [normalize(t.artist)]);
  const genreAff = groupAff((t) => t.genres.map((g) => g.toLowerCase()));

  const baseAffinity = new Map<string, number>();
  const affinity = new Map<string, number>();
  for (const t of tracks) {
    let a = own.get(t.id) ?? 0;
    a += 0.6 * (artistAff.get(normalize(t.artist)) ?? 0);
    const gs = t.genres.map((g) => genreAff.get(g.toLowerCase()) ?? 0);
    if (gs.length) a += 0.3 * Math.max(...gs);
    // Hora del día: ¿a esta hora sueles escuchar a este artista? (±2 h)
    const h = hourHist.get(t.artist);
    if (h) {
      const total = h.reduce((x, y) => x + y, 0);
      let near = 0;
      for (let d = -2; d <= 2; d++) near += h[(nowHour + d + 24) % 24];
      if (total >= 3) a += 0.5 * (near / total - 5 / 24);
    }
    const rank = billboard.get(t.id);
    if (rank) a += 0.6 * (1 - (rank - 1) / 100);
    // Las nunca escuchadas tienen un pequeño empujón para que aparezcan de vez en cuando.
    if (!stats.get(t.id)) a += 0.2;
    a += 0.25 * dailyNoise(t.id, now);
    baseAffinity.set(t.id, a);
    // Si la acabas de escuchar, baja un poco para que los accesos directos no se repitan siempre.
    const last = stats.get(t.id)?.lastPlayed ?? 0;
    affinity.set(t.id, a - (now - last < 3 * 3600_000 ? 1.2 : 0));
  }

  // --- Sonido normalizado respecto a tu biblioteca ---
  const usable = tracks.map((t) => features.get(t.id)).filter((f): f is AudioFeatures => !!f && !f.silent && !f.failed);
  const pE = percentile(usable.map((f) => f.energy));
  const pA = percentile(usable.map((f) => f.activity));
  const pB = percentile(usable.map((f) => f.beat));
  const pZ = percentile(usable.map((f) => f.brightness));
  const pD = percentile(usable.map((f) => f.dynamics));
  const sound = new Map<string, SoundVec>();
  for (const t of tracks) {
    const f = features.get(t.id);
    if (!f || f.silent || f.failed) continue;
    const bpm = foldBpm(f.bpm);
    sound.set(t.id, {
      energy: pE(f.energy),
      activity: pA(f.activity),
      beat: pB(f.beat),
      brightness: pZ(f.brightness),
      dynamics: pD(f.dynamics),
      fast: clamp01((bpm - 95) / 70),
      dance: clamp01(1 - Math.abs(bpm - 123) / 28),
    });
  }

  // --- Ánimo ---
  const mood = {} as Record<MoodId, Map<string, number>>;
  for (const m of MOODS) mood[m.id] = new Map();
  for (const t of tracks) {
    const v = sound.get(t.id);
    // Sin análisis todavía: valores neutros, decide sobre todo el género.
    const E = v?.energy ?? 0.5;
    const A = v?.activity ?? 0.5;
    const B = v?.beat ?? 0.5;
    const Z = v?.brightness ?? 0.5;
    const D = v?.dynamics ?? 0.5;
    const F = v?.fast ?? 0.5;
    const DN = v?.dance ?? 0.5;
    const liked = ratings[t.id] === 1 ? 1 : 0;
    mood.activate.set(t.id, 0.35 * E + 0.3 * A + 0.15 * F + 0.1 * B + 0.1 * Z + 0.2 * genreScore(t, 'energetic'));
    mood.workout.set(t.id, 0.3 * E + 0.3 * A + 0.2 * F + 0.2 * B + 0.2 * genreScore(t, 'workout'));
    mood.party.set(t.id, 0.3 * DN + 0.25 * B + 0.2 * E + 0.15 * A + 0.1 * Z + 0.25 * genreScore(t, 'party'));
    mood.relax.set(t.id, 0.35 * (1 - E) + 0.3 * (1 - A) + 0.15 * (1 - B) + 0.1 * (1 - Z) + 0.1 * (1 - F) + 0.25 * genreScore(t, 'calm'));
    mood.focus.set(t.id, 0.3 * (1 - A) + 0.25 * (1 - E) + 0.2 * (1 - D) + 0.1 * (1 - Z) + 0.15 * (1 - B) + 0.35 * genreScore(t, 'focus'));
    // Tendencia: solo las que están en el Hot 100 de esta semana (la #1 vale más).
    const rank = billboard.get(t.id);
    if (rank) mood.trending.set(t.id, 1 - (rank - 1) / 100);
    mood.feelgood.set(t.id, 0.25 * E + 0.2 * Z + 0.25 * DN + 0.1 * A + 0.15 * liked + 0.25 * genreScore(t, 'happy'));
    // Romance: tempo tranquilo a medio, energía media, géneros de amor (R&B, soul, baladas) y títulos de amor.
    const mid = 1 - Math.abs(E - 0.45) * 2;
    mood.romance.set(t.id, 0.2 * (1 - F) + 0.15 * mid + 0.1 * (1 - A) + 0.35 * genreScore(t, 'romance') + 0.25 * titleScore(t, 'romance') + 0.1 * liked);
    // Triste: suave, lenta, poco brillante, sin pulso marcado; géneros melancólicos y títulos tristes.
    mood.sad.set(t.id, 0.2 * (1 - E) + 0.15 * (1 - Z) + 0.15 * (1 - F) + 0.1 * (1 - B) + 0.1 * (1 - DN) + 0.3 * genreScore(t, 'sad') + 0.3 * titleScore(t, 'sad') - 0.15 * genreScore(t, 'party'));
    // Sueño: lo más calmado de todo (muy poca energía, actividad y pulso), sin canciones de fiesta.
    mood.sleep.set(t.id, 0.3 * (1 - E) + 0.25 * (1 - A) + 0.2 * (1 - B) + 0.1 * (1 - Z) + 0.15 * (1 - F) + 0.3 * genreScore(t, 'sleep') - 0.3 * genreScore(t, 'energetic'));
    // Con la vibe escuchada (Essentia), cada ánimo se apoya también en ella: sabe de verdad si es triste o de fiesta.
    const vb = t.vibe;
    if (vb) {
      const mezclar = (k: MoodId, x: number) => mood[k].set(t.id, 0.5 * (mood[k].get(t.id) ?? 0) + 0.7 * x);
      mezclar('activate', 0.4 * vb.agresiva + 0.3 * vb.bailable + 0.3 * vb.fiesta);
      mezclar('workout', 0.4 * vb.agresiva + 0.3 * vb.bailable + 0.3 * vb.fiesta);
      mezclar('party', 0.5 * vb.fiesta + 0.5 * vb.bailable);
      mezclar('relax', vb.relajada * (1 - vb.agresiva));
      mezclar('focus', 0.5 * vb.instrumental + 0.5 * vb.relajada);
      mezclar('feelgood', 0.7 * vb.feliz + 0.3 * vb.bailable);
      mezclar('sad', vb.triste * (1 - 0.5 * vb.fiesta));
      mezclar('sleep', vb.relajada * (1 - vb.bailable) * (1 - vb.agresiva));
    }
  }

  return { input, byId, stats, baseAffinity, affinity, sound, mood, transitions, saltosTras };
}

// ---------------- Listas ----------------

/** Silencio (archivos de prueba) o demasiado corta para recomendarla (intros, skits). */
export const isTestSilence = (m: Model, id: string) => m.input.features.get(id)?.silent === true || (m.byId.get(id)?.duration ?? 0) < 20;

// ---------------- Categorías especiales (meme, anime, OST de videojuego) ----------------

const catsDe = (t: Track | undefined) => t?.categorias ?? [];
/** El "mundo" de una canción para la radio y las recomendaciones: su categoría confirmada o la probable. */
export const mundoDe = (t: Track | undefined) => (t?.categorias?.length ? t.categorias : (t?.contexto ?? []));
/**
 * Categorías que ya son "tuyas": las de canciones que escuchaste de verdad o te gustaron. Una canción de una
 * categoría que no escuchas nunca aparece como descubrimiento ni en los mixes (al que no escucha memes no le
 * llegan memes); si ya escuchas anime, el anime sí puede aparecer.
 */
const catsCache = new WeakMap<Model, Set<string>>();
function categoriasTuyas(m: Model) {
  let s = catsCache.get(m);
  if (!s) {
    s = new Set<string>();
    for (const id of heardIds(m)) for (const c of mundoDe(m.byId.get(id))) s.add(c);
    catsCache.set(m, s);
  }
  return s;
}
/** ¿Esta canción puede aparecer como recomendación para este usuario? (sin categoría, o de una que ya escucha) */
const categoriaPermitida = (m: Model, t: Track) => mundoDe(t).every((c) => categoriasTuyas(m).has(c));

/** Ordena evitando que un mismo artista acapare la lista (máximo `perArtist` por artista). */
export function diverse(m: Model, ids: string[], n: number, perArtist = 2) {
  const count = new Map<string, number>();
  const out: string[] = [];
  const spill: string[] = [];
  for (const id of ids) {
    const t = m.byId.get(id);
    if (!t) continue;
    const k = normalize(t.artist);
    const c = count.get(k) ?? 0;
    if (c >= perArtist) {
      spill.push(id);
      continue;
    }
    count.set(k, c + 1);
    out.push(id);
    if (out.length >= n) return out;
  }
  // Si la biblioteca es chica, se completa con lo que quedó.
  return [...out, ...spill].slice(0, n);
}

/**
 * Lo que es "tuyo": canciones que escuchaste de verdad (al menos media canción terminada) o con "me gusta",
 * sin las marcadas "no me gusta". Con esto se arma el feed y el aleatorio, no con todo el servidor.
 */
export function heardIds(m: Model): string[] {
  const out: string[] = [];
  for (const t of m.input.tracks) {
    if (m.input.ratings[t.id] === -1 || isTestSilence(m, t.id)) continue;
    const s = m.stats.get(t.id);
    if (m.input.ratings[t.id] === 1 || (s && s.completes >= 0.5)) out.push(t.id);
  }
  return out;
}

/** Con menos de esto, el usuario todavía es "nuevo": el feed es el Billboard y no hay "Tus álbumes/artistas". */
export const MIN_HEARD = 5;

/** Canciones del Hot 100 de esta semana que están en el servidor, en el orden del chart. */
export function billboardIds(m: Model): string[] {
  return [...m.input.billboard.entries()]
    .filter(([id]) => m.byId.has(id) && m.input.ratings[id] !== -1 && !isTestSilence(m, id))
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}

/**
 * Descubrimientos: canciones que NUNCA escuchaste, de tu estilo y parecidas a lo que más escuchas. Una canción
 * recién subida al servidor solo aparece si se parece a lo tuyo (ser nueva no le da ningún puesto).
 */
function discoveries(m: Model, mine: string[], n: number, exclude: Set<string>) {
  if (n <= 0 || !mine.length) return [];
  const seeds = mine.slice(0, 12).map((id) => m.byId.get(id)!);
  const colab = colabDe(m);
  const yt = ytmTuyo(m);
  const scored: [string, number][] = [];
  for (const t of m.input.tracks) {
    if (exclude.has(t.id) || m.stats.has(t.id) || m.input.ratings[t.id] !== undefined || isTestSilence(m, t.id)) continue;
    if (!categoriaPermitida(m, t)) continue;
    const fit = styleFit(m, t);
    const y = yt.get(t.id) ?? 0;
    // Otro estilo: no es para ti, salvo que YouTube Music la ponga muy cerca de lo que escuchas ahora.
    if (fit !== null && fit < 0.5 && y < 0.5) continue;
    let sim = 0;
    for (const s of seeds) sim = Math.max(sim, similarity(m, s, t));
    scored.push([
      t.id,
      sim + 0.3 * (fit ?? 0) + 0.45 * (colab.get(t.id) ?? 0) + 0.6 * y + 0.12 * (t.exito?.valor ?? 0) + 0.15 * dailyNoise(t.id, m.input.now),
    ]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return diverse(m, scored.slice(0, 40).map(([id]) => id), n, 1);
}

/**
 * Accesos directos (el feed principal):
 *  - Usuario nuevo (casi sin escuchas): lo que lleve escuchado + el Billboard Hot 100. Nada más.
 *  - Con historial: casi todo es música que TÚ escuchas (ordenada por lo que más te gusta ahora) y solo 2 o 3
 *    son descubrimientos parecidos que no has oído, repartidos entre las tuyas.
 */
export function shortcuts(m: Model, n: number) {
  const byAff = (ids: string[]) => [...ids].sort((a, b) => (m.affinity.get(b) ?? 0) - (m.affinity.get(a) ?? 0));
  const mine = byAff(heardIds(m));
  const chart = billboardIds(m);
  if (mine.length < MIN_HEARD) {
    const seen = new Set(mine);
    // Cuenta nueva: con lo poco que lleva, YouTube Music ya sabe qué va con eso (antes de rellenar con el Billboard).
    const yt = [...ytmTuyo(m).entries()]
      .filter(([id]) => !seen.has(id) && m.input.ratings[id] !== -1 && !isTestSilence(m, id) && categoriaPermitida(m, m.byId.get(id)!))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const conYt = [...mine, ...diverse(m, yt, Math.min(8, n - mine.length), 1)];
    const vistas = new Set(conYt);
    return [...conYt, ...diverse(m, chart.filter((id) => !vistas.has(id)), n - conYt.length, 2)].slice(0, n);
  }
  // Con datos de YouTube Music, un descubrimiento más.
  const k = (mine.length >= 15 ? 3 : 2) + (ytmTuyo(m).size ? 1 : 0);
  const own = diverse(m, mine, n - k, 3);
  const used = new Set(own);
  const nuevas = discoveries(m, mine, k, used);
  // Si todavía no hay suficientes tuyas, se completa con el Billboard (no con canciones al azar del servidor).
  const relleno = own.length + nuevas.length < n ? chart.filter((id) => !used.has(id) && !nuevas.includes(id)) : [];
  const out = [...own];
  // Los descubrimientos van repartidos (puestos 4, 11, 19 y 24), no todos juntos al final.
  [3, 10, 18, 23].slice(0, nuevas.length).forEach((pos, i) => out.splice(Math.min(pos, out.length), 0, nuevas[i]));
  return [...out, ...relleno].slice(0, n);
}

/** Aleatorio del feed: tu música (escuchada, "me gusta" y `extra` = tus playlists). Usuario nuevo: el Billboard. */
export function shufflePool(m: Model, extra: string[] = []) {
  const set = new Set([...heardIds(m), ...extra.filter((id) => m.byId.has(id) && m.input.ratings[id] !== -1)]);
  return set.size >= MIN_HEARD ? [...set] : [...new Set([...set, ...billboardIds(m)])];
}

/** Mix de un ánimo: encaja con el ánimo y además te gusta. */
export function moodMix(m: Model, mood: MoodId, n: number) {
  if (mood === 'trending') {
    // En el orden del chart (#1 primero), sin las que marcaste "no me gusta".
    const ids = [...m.mood.trending.entries()]
      .filter(([id]) => m.input.ratings[id] !== -1 && !isTestSilence(m, id))
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    return diverse(m, ids, n, 3);
  }
  const aff = [...m.affinity.values()];
  const lo = Math.min(...aff);
  const hi = Math.max(...aff);
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  // Tu estilo primero: "Romance" para quien escucha reggaetón es reggaetón romántico; una balada de otro
  // estilo solo entra si no alcanza con lo tuyo. (Sin historial todavía: se ordena solo por el ánimo.)
  const fam = tasteShares(m);
  const style = (id: string) => styleFit(m, m.byId.get(id)!);
  const ids = [...m.mood[mood].entries()]
    .filter(([id]) => m.input.ratings[id] !== -1 && !isTestSilence(m, id) && categoriaPermitida(m, m.byId.get(id)!))
    .map(([id, v]) => {
      const s = style(id);
      if (s === null) return [id, 0.65 * v + 0.35 * norm(m.affinity.get(id) ?? 0) - (fam ? 0.15 : 0)] as const;
      // Fuera de tu estilo (parecido < 0,25): baja al final de la lista.
      return [id, 0.45 * v + 0.3 * s + 0.25 * norm(m.affinity.get(id) ?? 0) - (s < 0.25 ? 0.35 : 0)] as const;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  return diverse(m, ids, n, 3);
}

/**
 * Tus estilos: qué parte de lo que escuchas es de cada familia (rock, baladas, reggaetón…), según TODO tu
 * historial (canciones terminadas y "me gusta"). null si todavía no hay historial.
 *
 * Cada usuario puede tener varios estilos: alguien que escucha 70 % rock y 30 % baladas tiene los dos.
 */
const tasteCache = new WeakMap<Model, number[] | null>();
function tasteShares(m: Model) {
  if (!tasteCache.has(m)) {
    let acc: number[] | null = null;
    for (const t of m.input.tracks) {
      const s = m.stats.get(t.id);
      const w = (s?.completes ?? 0) + (m.input.ratings[t.id] === 1 ? 2 : 0);
      if (w <= 0) continue;
      const f = familiesOf(m, t);
      if (!f) continue;
      const sum = f.reduce((a, b) => a + b, 0) || 1;
      acc ??= f.map(() => 0);
      f.forEach((x, i) => (acc![i] += (w * x) / sum));
    }
    const total = acc?.reduce((a, b) => a + b, 0) ?? 0;
    tasteCache.set(m, acc && total > 0 ? acc.map((x) => x / total) : null);
  }
  return tasteCache.get(m)!;
}

/** Un estilo que es al menos el 15 % de lo que escuchas cuenta como "tuyo". */
const OWN_SHARE = 0.15;

/**
 * Qué tan de "tus estilos" es una canción (0–1). Una balada es 1 para quien escucha baladas aunque sean la
 * minoría de lo suyo, y 0 para quien nunca escucha baladas. null = no se sabe (sin historial o sin géneros).
 */
function styleFit(m: Model, t: Track): number | null {
  const shares = tasteShares(m);
  if (!shares) return null;
  const f = familiesOf(m, t);
  if (!f) return null;
  const sum = f.reduce((a, b) => a + b, 0) || 1;
  let fit = 0;
  f.forEach((x, i) => (fit += (x / sum) * Math.min(1, shares[i] / OWN_SHARE)));
  return fit;
}

/**
 * Puntaje personal de un grupo de canciones (un álbum o un artista) para "Tus álbumes" y "Tus artistas":
 * primero lo que escuchas de verdad, después lo que encaja con tus gustos (artista, género). Así, con la
 * biblioteca compartida del servidor, no aparece primero un álbum solo por empezar con "A".
 */
export function groupScore(m: Model, trackIds: string[]) {
  let best = -Infinity;
  let listened = 0;
  let disliked = 0;
  for (const id of trackIds) {
    best = Math.max(best, m.baseAffinity.get(id) ?? 0);
    const s = m.stats.get(id);
    if (s) listened += s.completes + 0.3 * (s.plays - s.skips);
    if (m.input.ratings[id] === -1) disliked++;
  }
  if (!trackIds.length) return -Infinity;
  const t = m.byId.get(trackIds[0]);
  const fit = (t && styleFit(m, t)) ?? 0;
  return best + 0.6 * Math.log1p(Math.max(0, listened)) + 0.4 * fit - (disliked === trackIds.length ? 2 : 0);
}

/** Redescubre: canciones que te gustaban (completas varias veces o con "me gusta") y no suenan hace 3 semanas. */
export function rediscover(m: Model, n: number) {
  const ids = [...m.stats.entries()]
    .filter(([id, s]) => (s.completes >= 2 || m.input.ratings[id] === 1) && m.input.ratings[id] !== -1 && !isTestSilence(m, id) && m.input.now - s.lastPlayed > 21 * DAY)
    .sort((a, b) => (m.baseAffinity.get(b[0]) ?? 0) - (m.baseAffinity.get(a[0]) ?? 0))
    .map(([id]) => id);
  return diverse(m, ids, n);
}

// ---------------- "Para ti": mixes según lo que escuchas ----------------

/** Un mix tal como lo define el admin en el panel (tabla `mixes`). */
export interface DefMix {
  id: string;
  titulo: string;
  portada?: string | null;
  tamano: number;
  anioDesde?: number | null;
  anioHasta?: number | null;
  /** Al menos uno de estos géneros (vacío = cualquiera). */
  generos: string[];
  /** Ninguno de estos géneros. */
  sinGeneros: string[];
  /** Solo canciones de esta categoría ('anime'…); sin categoría: las de meme/anime/OST no entran. */
  categoria?: string | null;
  /** Canciones agregadas a mano (ids de la app), en orden: van primero. */
  fijas: string[];
  /** Después de las fijas, en este orden (ej. las de la playlist Anime Now que ya están subidas). */
  externas?: string[];
}

export interface MixParaTi {
  id: string;
  titulo: string;
  portada?: string | null;
  /** Qué parte de lo que escuchas es de este mix (0–1): ordena la sección. */
  tuyo: number;
  ids: string[];
}

const MIX_MIN = 12; // con menos canciones, el mix no se muestra todavía

/** ¿El género `g` es `termino`? Palabra completa: "pop" calza con "pop" y "dance pop", no con "popular". */
const generoEs = (g: string, termino: string) => {
  const t = termino.trim().toLowerCase();
  if (!t) return false;
  const i = g.indexOf(t);
  if (i < 0) return false;
  const antes = i === 0 || !/[a-z0-9áéíóúñ]/.test(g[i - 1]);
  const despues = i + t.length === g.length || !/[a-z0-9áéíóúñ]/.test(g[i + t.length]);
  return antes && despues;
};

/** ¿La canción cumple las reglas automáticas del mix? (un mix sin reglas solo lleva sus canciones fijas) */
function entraEnMix(d: DefMix, t: Track) {
  const hayReglas = !!(d.anioDesde || d.anioHasta || d.generos.length || d.sinGeneros.length || d.categoria);
  if (!hayReglas) return false;
  const cats = catsDe(t);
  if (d.categoria ? !cats.includes(d.categoria) : cats.length) return false;
  if (d.anioDesde || d.anioHasta) {
    if (!t.year) return false;
    if (d.anioDesde && t.year < d.anioDesde) return false;
    if (d.anioHasta && t.year > d.anioHasta) return false;
  }
  const g = t.genres.map((x) => x.toLowerCase());
  if (d.generos.length && !g.some((x) => d.generos.some((y) => generoEs(x, y)))) return false;
  if (d.sinGeneros.length && g.some((x) => d.sinGeneros.some((y) => generoEs(x, y)))) return false;
  return true;
}

/**
 * Los mixes "Para ti", ordenados por lo que más escuchas (si escuchas muchos 2000, Essential 2000's va primero;
 * sin historial, en el orden del panel). Cada uno: primero sus canciones fijas (en su orden), después las
 * externas, y lo demás según las reglas: lo que más va contigo y lo más conocido, con algo nuevo cada día.
 */
export function mixesParaTi(m: Model, defs: DefMix[], semilla = String(Math.floor(m.input.now / DAY))): MixParaTi[] {
  const norm = normAfinidad(m);
  const { pesos, total } = pesosDeEscucha(m);
  const propias = defs.map((d) => new Set([...d.fijas, ...(d.externas ?? [])]));
  // Cuánto de lo que escuchas (terminadas, me gusta, menos los saltos) cae en cada mix, para ordenarlos.
  const escuchado = new Map<string, number>();
  for (const [id, p] of pesos) {
    const t = m.byId.get(id)!;
    defs.forEach((d, i) => {
      if (propias[i].has(id) || entraEnMix(d, t)) escuchado.set(d.id, (escuchado.get(d.id) ?? 0) + p);
    });
  }
  const out: (MixParaTi & { orden: number })[] = [];
  defs.forEach((d, orden) => {
    const azar = azarDe(`${semilla}:${d.id}`);
    const n = Math.max(1, Math.min(500, d.tamano || 50));
    const primero = [...new Set([...d.fijas, ...(d.externas ?? [])])].filter((id) => m.byId.has(id) && m.input.ratings[id] !== -1);
    const ya = new Set(primero);
    const scored: [string, number][] = [];
    for (const t of m.input.tracks) {
      if (ya.has(t.id) || m.input.ratings[t.id] === -1 || isTestSilence(m, t.id) || !entraEnMix(d, t)) continue;
      // "Essential": manda lo conocido, con suficiente azar del día para que no sean siempre las mismas 50.
      scored.push([t.id, 0.45 * norm(m.baseAffinity.get(t.id) ?? 0) + 0.5 * popDe(m, t) + 0.04 * (t.exito?.valor ?? 0) + 0.3 * azar() - raroDe(t)]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const largo = Math.max(n, primero.length);
    const resto = barajarSuave(diverse(m, scored.map(([id]) => id), largo, 2), azar);
    const ids = [...primero, ...resto].slice(0, largo);
    if (ids.length < Math.min(MIX_MIN, n)) return;
    out.push({ id: d.id, titulo: d.titulo, portada: d.portada ?? null, tuyo: total ? (escuchado.get(d.id) ?? 0) / total : 0, ids, orden });
  });
  return out.sort((a, b) => b.tuyo - a.tuyo || a.orden - b.orden).map(({ orden: _o, ...x }) => x);
}

// ---------------- "Para ti": qué tarjetas y en qué orden ----------------

/** Afinidad llevada a 0–1 (para mezclarla con popularidad y azar). */
function normAfinidad(m: Model) {
  const aff = [...m.baseAffinity.values()];
  const lo = aff.length ? Math.min(...aff) : 0;
  const hi = aff.length ? Math.max(...aff) : 0;
  return (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
}
/** Qué tan conocida es: popularidad en el servidor, el Billboard de esta semana o haber estado en el Hot 100. */
function popDe(m: Model, t: Track) {
  const enHot100 = t.genres.some((g) => /billboard|hot 100/i.test(g));
  return Math.max(t.pop ?? 0.25, m.input.billboard.has(t.id) ? 0.9 : 0, enHot100 ? 0.8 : 0);
}
/** Megamixes, karaoke y rarezas quedan abajo. */
const raroDe = (t: Track) => (/megamix|medley|\bmix\b|karaoke|christmas|navidad|instrumental/i.test(`${t.title} ${t.album}`) ? 0.3 : 0);
/** Cambia el orden sin perder del todo el de antes: lo de arriba tiende a seguir arriba. */
function barajarSuave(ids: string[], azar: () => number) {
  return ids.map((id, i): [string, number] => [id, i / Math.max(1, ids.length) + 0.6 * azar()]).sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

/**
 * Cuánto pesa cada canción en lo que escuchas: las terminadas (más si fueron este mes) y los "me gusta" suman;
 * los saltos restan. Las de "no me gusta" no cuentan. Sirve para saber qué estilos son de verdad tuyos.
 */
const pesoCache = new WeakMap<Model, { pesos: Map<string, number>; total: number }>();
function pesosDeEscucha(m: Model) {
  let x = pesoCache.get(m);
  if (!x) {
    const pesos = new Map<string, number>();
    let total = 0;
    for (const id of new Set([...m.stats.keys(), ...Object.keys(m.input.ratings)])) {
      if (m.input.ratings[id] === -1 || !m.byId.has(id) || isTestSilence(m, id)) continue;
      const s = m.stats.get(id);
      const p = Math.max(0, (s?.completes ?? 0) + 0.5 * (s?.recentCompletes ?? 0) - 0.4 * (s?.skips ?? 0)) + (m.input.ratings[id] === 1 ? 2 : 0);
      if (p <= 0) continue;
      pesos.set(id, p);
      total += p;
    }
    pesoCache.set(m, (x = { pesos, total }));
  }
  return x;
}

/** Cuánto de lo que escuchas cae en cada escena (y cuántas canciones distintas). */
function pesosPorEscena(m: Model) {
  const escenas = escenasDe(m);
  const out = new Map<string, { peso: number; n: number }>();
  for (const [id, p] of pesosDeEscucha(m).pesos) {
    const e = escenas.get(id);
    if (!e) continue;
    const x = out.get(e.id) ?? { peso: 0, n: 0 };
    x.peso += p;
    x.n++;
    out.set(e.id, x);
  }
  return out;
}

/**
 * Estilos para las tarjetas "Para ti" de cada persona: grupos de escenas (las mismas de los Mix diario y de las
 * listas del buscador). El reggaetón ya tiene Mix Reggaeton y el anime Anime Now, así que no se repiten aquí.
 */
interface Estilo {
  id: string;
  escenas: string[];
  titulos: string[];
}
const ESTILOS: Estilo[] = [
  { id: 'rock', escenas: ['rock-clasico', 'rock-alternativo', 'indie-rock', 'rock-espanol'], titulos: ['Mix Rock', 'Rock para ti', 'Puro rock'] },
  { id: 'metal', escenas: ['metal'], titulos: ['Mix Metal', 'Metal para ti', 'Puro metal'] },
  { id: 'hiphop', escenas: ['hiphop-clasico', 'hiphop-actual'], titulos: ['Mix Hip hop', 'Rap y hip hop', 'Hip hop para ti'] },
  { id: 'rnb', escenas: ['rnb', 'soul'], titulos: ['Mix R&B', 'R&B para ti', 'R&B y soul'] },
  { id: 'electronica', escenas: ['electronica-actual', 'club-clasico'], titulos: ['Mix Electrónica', 'Electrónica para ti', 'Pura electrónica'] },
  { id: 'pop', escenas: ['pop-actual', 'pop-clasico'], titulos: ['Mix Pop', 'Pop para ti', 'Puro pop'] },
  { id: 'kpop', escenas: ['kpop'], titulos: ['Mix K-pop', 'K-pop para ti', 'Puro K-pop'] },
  { id: 'indie', escenas: ['indie-pop'], titulos: ['Mix Indie', 'Indie para ti', 'Indie y dream pop'] },
  { id: 'retro', escenas: ['synth', 'disco'], titulos: ['Mix Synth y disco', 'Ochenteros para ti', 'Disco y new wave'] },
  { id: 'latino', escenas: ['pop-latino'], titulos: ['Mix Pop latino', 'Pop latino para ti', 'Latino para ti'] },
  { id: 'baladas', escenas: ['baladas'], titulos: ['Mix Baladas', 'Baladas para ti', 'Baladas y soft rock'] },
  { id: 'country', escenas: ['country'], titulos: ['Mix Country', 'Country y folk para ti', 'Country para ti'] },
  { id: 'jazz', escenas: ['jazz'], titulos: ['Mix Jazz', 'Jazz y chill para ti', 'Jazz para ti'] },
];
const ESTILO_MIN = 0.07; // parte de lo que escuchas para tener la tarjeta del estilo
const ESTILO_MIN_CANCIONES = 5;
const MAX_ESTILOS = 4;
const MIX_FIJO_MIN = 0.03; // con menos de esto, un mix del panel (Essential, Reggaeton…) no te aparece

/**
 * El mix de un estilo: canciones de sus escenas, repartidas según cuánto escuchas cada una (si solo escuchas hip
 * hop actual, casi todo es de ahí). Mezcla lo tuyo con lo conocido y lo parecido; cambia cada día.
 */
function mixDeEstilo(m: Model, est: Estilo, porEscena: Map<string, { peso: number; n: number }>, excluir: Set<string>, n: number, azar: () => number) {
  const escenas = escenasDe(m);
  const norm = normAfinidad(m);
  const pesos = est.escenas.map((e) => porEscena.get(e)?.peso ?? 0);
  const suma = pesos.reduce((a, b) => a + b, 0) || 1;
  const cupos = est.escenas.map((_, i) => Math.round(n * (0.85 * (pesos[i] / suma) + 0.15 / est.escenas.length)));
  const cand = new Map<string, [string, number][]>(est.escenas.map((e) => [e, []]));
  for (const t of m.input.tracks) {
    const e = escenas.get(t.id)?.id;
    const l = e && cand.get(e);
    if (!l || excluir.has(t.id) || m.input.ratings[t.id] === -1 || isTestSilence(m, t.id) || !categoriaPermitida(m, t)) continue;
    l.push([t.id, 0.45 * norm(m.baseAffinity.get(t.id) ?? 0) + 0.35 * popDe(m, t) + 0.1 * (t.exito?.valor ?? 0) + 0.35 * azar() - raroDe(t)]);
  }
  const elegidas: string[] = [];
  const sobrantes: [string, number][] = [];
  est.escenas.forEach((e, i) => {
    const orden = cand.get(e)!.sort((a, b) => b[1] - a[1]);
    const ids = conLimiteArtista(m, orden.map(([id]) => id), cupos[i], 2);
    elegidas.push(...ids);
    const ya = new Set(ids);
    sobrantes.push(...orden.filter(([id]) => !ya.has(id)));
  });
  if (elegidas.length < n) {
    const ya = new Set(elegidas);
    elegidas.push(...conLimiteArtista(m, sobrantes.sort((a, b) => b[1] - a[1]).map(([id]) => id), n, 2).filter((id) => !ya.has(id)).slice(0, n - elegidas.length));
  }
  // Orden variado cada día; lo más tuyo y conocido tiende a quedar arriba.
  const ids = barajarSuave(elegidas, azar).slice(0, n);
  return ids.length >= MIX_MIN ? ids : null;
}

/** Una lista personal ya armada (Descubrimiento semanal o un Mix diario), tal como se guardó. */
export interface ListaPersonal {
  id: string;
  titulo: string;
  ids: string[];
  tipo: 'semanal' | 'diario';
}
export interface TarjetaParaTi extends MixParaTi {
  tipo: 'mix' | 'estilo' | 'semanal' | 'diario';
}

/**
 * Todo "Para ti", en orden: lo que más escuchas primero.
 *  - Los mixes del panel (Essential, Reggaeton, Anime Now) solo salen si de verdad escuchas eso.
 *  - Tarjetas de estilo (Rock, Metal, Hip hop, R&B…) según tu historial; no repiten un Mix diario.
 *  - Descubrimiento semanal va segundo; los Mix diario, según cuánto escuchas su escena.
 *  - El orden se mueve un poco cada día entre las que están parejas, y el contenido cambia cada día.
 * Sin historial suficiente: los mixes del panel, como antes. `semilla` = cuenta + día.
 */
export function paraTi(m: Model, defs: DefMix[], personales: ListaPersonal[], semilla: string): TarjetaParaTi[] {
  const mixes = mixesParaTi(m, defs, semilla);
  if (heardIds(m).length < MIN_PARA_LISTAS) {
    return [...mixes.map((x): TarjetaParaTi => ({ ...x, tipo: 'mix' })), ...personales.map((p): TarjetaParaTi => ({ ...p, tuyo: 0 }))];
  }
  const { total } = pesosDeEscucha(m);
  const porEscena = pesosPorEscena(m);
  const parte = (e: string) => (total ? (porEscena.get(e)?.peso ?? 0) / total : 0);
  const tarjetas: TarjetaParaTi[] = mixes.filter((x) => x.tuyo >= MIX_FIJO_MIN).map((x) => ({ ...x, tipo: 'mix' }));

  // Mix diario: cuánto escuchas su escena.
  const escenaDeDiario = (titulo: string) => ESCENAS_POR_NOMBRE.get(titulo.replace(/^Mix diario:\s*/, ''))?.id;
  const diarios = personales.filter((p) => p.tipo === 'diario');
  const escenasDiarias = new Set(diarios.map((p) => escenaDeDiario(p.titulo)).filter((x): x is string => !!x));
  for (const p of diarios) {
    const e = escenaDeDiario(p.titulo);
    tarjetas.push({ ...p, tuyo: e ? parte(e) : 0 });
  }

  // Estilos: los que de verdad escuchas y que un Mix diario no cubre ya casi entero.
  const enDiarios = new Set(diarios.flatMap((p) => p.ids));
  const azarDia = azarDe(semilla);
  const estilos = ESTILOS.map((est) => {
    const peso = est.escenas.reduce((a, e) => a + (porEscena.get(e)?.peso ?? 0), 0);
    const n = est.escenas.reduce((a, e) => a + (porEscena.get(e)?.n ?? 0), 0);
    const cubierto = est.escenas.reduce((a, e) => a + (escenasDiarias.has(e) ? (porEscena.get(e)?.peso ?? 0) : 0), 0);
    return { est, tuyo: total ? peso / total : 0, n, cubierto: peso ? cubierto / peso : 0, peso };
  })
    .filter((x) => x.tuyo >= ESTILO_MIN && x.n >= ESTILO_MIN_CANCIONES && x.cubierto < 0.75)
    .sort((a, b) => b.tuyo - a.tuyo)
    .slice(0, MAX_ESTILOS);
  for (const { est, tuyo, peso } of estilos) {
    const azar = azarDe(`${semilla}:${est.id}`);
    const ids = mixDeEstilo(m, est, porEscena, enDiarios, 50, azar);
    if (!ids) continue;
    // Si casi todo es de una escena (solo hip hop actual, solo rock clásico), la tarjeta se llama como ella.
    const dominante = est.escenas.length > 1 ? est.escenas.find((e) => (porEscena.get(e)?.peso ?? 0) >= 0.75 * peso) : undefined;
    const nombre = dominante ? ESCENAS.find((e) => e.id === dominante)!.nombre : null;
    const opciones = nombre ? [`Mix ${nombre}`, `${nombre} para ti`, `Puro ${nombre.toLowerCase()}`] : est.titulos;
    tarjetas.push({ id: `estilo-${est.id}`, titulo: opciones[Math.floor(azar() * opciones.length)], tuyo, ids, tipo: 'estilo' });
  }

  // Orden: lo que más escuchas, con un poco de vaivén diario entre las parejas.
  const orden = tarjetas
    .map((t): [TarjetaParaTi, number] => [t, t.tuyo * (0.8 + 0.4 * azarDia())])
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  const semanal = personales.find((p) => p.tipo === 'semanal');
  if (semanal) orden.splice(Math.min(1, orden.length), 0, { ...semanal, tuyo: 0 });
  return orden;
}

// ---------------- Similitud y radio ----------------

/**
 * Familias de género: las etiquetas de MusicBrainz son muy específicas ("gangsta rap", "east coast hip hop",
 * "g-funk"), así que se agrupan en familias para saber que dos canciones son del mismo estilo aunque
 * no compartan la etiqueta exacta.
 */
const FAMILIES: Record<string, string[]> = {
  hiphop: ['hip hop', 'hip-hop', 'rap', 'trap', 'g-funk', 'gangsta', 'boom bap', 'drill', 'grime', 'golden age'],
  rnb: ['r&b', 'rnb', 'soul', 'motown', 'new jack swing', 'quiet storm', 'funk'],
  pop: ['pop', 'teen', 'bubblegum'],
  kpop: ['k-pop', 'kpop', 'j-pop', 'korean', 'c-pop', 'mandopop'],
  rock: ['rock', 'alternative', 'indie', 'grunge', 'punk', 'new wave', 'post-punk', 'psychedel', 'shoegaze'],
  // El metal va aparte del rock: después de Tame Impala no debe sonar heavy metal.
  metal: ['metal', 'hardcore', 'thrash', 'grindcore', 'djent', 'screamo'],
  soft: ['soft rock', 'adult contemporary', 'ballad', 'singer-songwriter', 'yacht', 'easy listening'],
  electronic: ['electronic', 'edm', 'house', 'techno', 'eurodance', 'dance', 'garage', 'trance', 'disco', 'electro', 'hi-nrg', 'italo'],
  latin: ['latin', 'reggaeton', 'cumbia', 'salsa', 'bachata', 'merengue', 'en español', 'mpb', 'bossa', 'axé'],
  country: ['country', 'americana', 'bluegrass', 'folk'],
  jazz: ['jazz', 'downtempo', 'lounge', 'trip hop', 'chill', 'ambient'],
  // Regional mexicano (corridos tumbados, banda, norteño…): Apple lo etiqueta "Música Mexicana". Ver MEXICANO.
  mexicano: [],
  // Phonk (drift phonk y "brazilian phonk", que en Brasil es funk automotivo / mandelão). Casi nunca trae
  // género: se reconoce también por el título y el artista (ver `phonkPorNombre`).
  phonk: ['phonk', 'funk carioca', 'baile funk', 'funk mandel', 'mandelão', 'automotivo', 'brazilian funk', 'montagem'],
  // ---- Géneros nacidos en internet: cada uno con su espacio (ver ESCENAS_INTERNET). ----
  // Pop exagerado y acelerado (100 gecs, SOPHIE, ElyOtto) y sus ramas de SoundCloud/Discord.
  hyperpop: ['hyperpop', 'digicore', 'glitchcore', 'pc music', 'bubblegum bass', 'dariacore', 'scenecore', 'hexd'],
  // Canciones aceleradas y más agudas (nightcore) o lentas y más graves (daycore).
  nightcore: ['nightcore', 'daycore'],
  // Sonido de consolas y computadores viejos (Crystal Castles, Anamanaguchi).
  chiptune: ['chiptune', '8-bit', '8bit', 'bitpop', 'chipwave', 'chip music'],
  // Muestras de los 80 y 90 ralentizadas o recortadas, y su rama bailable (future funk: Yung Bae).
  vaporwave: ['vaporwave', 'future funk', 'mallsoft', 'slushwave', 'plunderphonics', 'signalwave', 'hardvapour', 'seapunk'],
  // Sintetizadores de los 80 hechos hoy (The Midnight, Kavinsky, Perturbator).
  synthwave: ['synthwave', 'retrowave', 'outrun', 'darksynth', 'chillwave', 'dreamwave'],
  // Breaks de jungle cortados a toda velocidad (a veces con anime: "atmospheric breakcore").
  breakcore: ['breakcore', 'digital hardcore', 'speedcore', "drill 'n' bass", 'drill and bass'],
  // Drum and bass y jungle (de los 90, pero la base del breakcore).
  dnb: ['drum and bass', "drum'n'bass", 'drum & bass', 'drum n bass', 'dnb', 'jungle', 'liquid funk', 'neurofunk'],
  witchhouse: ['witch house'],
  // Rap nacido en SoundCloud: cloud rap (Yung Lean), rage (Playboi Carti, Nettspend), plugg, emo rap.
  rapinternet: ['cloud rap', 'rage', 'pluggnb', 'plugg', 'sigilkore', 'soundcloud rap', 'emo rap', 'jerk'],
  // Lofi para estudiar (Lofi Girl, chillhop). Casi nunca trae género: se reconoce por el artista (ver `lofiPorNombre`).
  lofi: ['lofi', 'lofi hip hop', 'lo-fi hip hop', 'lofi beats', 'chillhop', 'jazzhop', 'jazz hop'],
  // "lo-fi" (con guion) es como MusicBrainz llama al bedroom pop (Clairo, Mac DeMarco, Cuco), no jazz.
  bedroom: ['bedroom pop', 'lo-fi', 'lo-fi indie'],
};
const FAMILY_KEYS = Object.keys(FAMILIES);
const ASIATICO = /k-pop|kpop|j-pop|c-pop|mandopop|korean/;
// "banda" sola es banda sinaloense, pero no "banda sonora".
const MEXICANO = /m[uú]sica mexicana|regional mexican|\bmexican|corrido|norte[nñ]|sierre[nñ]|mariachi|ranchera|tejano|grupero|\bbanda\b(?! sonora)/;
const escapar = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Palabra entera: "rage" no es "garage", ni "jungle" de "jungle pop"… sí (es lo mismo). */
const palabraEntera = (ws: string[]) => new RegExp(`(?:^|[^\\p{L}])(?:${ws.map(escapar).join('|')})(?:$|[^\\p{L}])`, 'u');
const PHONK = new RegExp(FAMILIES.phonk.join('|'));
/** Familias de internet: se reconocen por palabra entera y sus etiquetas no cuentan para otras familias. */
const ESCENAS_INTERNET = ['hyperpop', 'nightcore', 'chiptune', 'vaporwave', 'synthwave', 'breakcore', 'dnb', 'witchhouse', 'rapinternet', 'lofi', 'bedroom'];
const RE_INTERNET = new Map(ESCENAS_INTERNET.map((f) => [f, palabraEntera(FAMILIES[f])]));
const deInternet = (g: string) => [...RE_INTERNET.values()].some((re) => re.test(g));
/** ¿La etiqueta `g` es de la familia `f`? ("k-pop" no cuenta como pop a secas; "pop metal"/"metal" no como rock.) */
function enFamilia(f: string, g: string) {
  if (f === 'mexicano') return MEXICANO.test(g);
  // "lofi hip hop" es lofi, no "lo-fi" (bedroom pop).
  if (f === 'bedroom' && RE_INTERNET.get('lofi')!.test(g)) return false;
  const reInternet = RE_INTERNET.get(f);
  if (reInternet) return reInternet.test(g);
  // "funk carioca" no es el funk de James Brown, ni "phonk house" es house; "future funk" es vaporwave,
  // "cloud rap" es rap de internet y "digital hardcore" no es metal.
  if (f !== 'phonk' && PHONK.test(g)) return false;
  if (deInternet(g)) return false;
  if (f === 'pop' && ASIATICO.test(g)) return false;
  if (f === 'rock' && /metal/.test(g)) return false;
  return FAMILIES[f].some((w) => g.includes(w));
}

/** Integrantes de un texto de artista ("DJ FKU, Mc Dido", "ZXKAI y slxughter"). */
const integrantes = (artista: string) =>
  artista
    .split(/\s*(?:,|;|&|\/|\bfeat\.?|\bft\.?|\bx\b|\by\b|\be\b|\band\b|\bwith\b|\bcon\b)\s*/i)
    .map((x) => normalize(x))
    .filter((x) => x.length > 1);

/**
 * ¿El título o el artista delatan phonk? Lo usual: "MONTAGEM …", "MTG - …", "… PHONK", "NO BATIDÃO", "FUNK …"
 * en mayúsculas (no "Uptown Funk"), productores "-MANE" (ICEDMANE, Scythermane) y versiones "Slowed" con un MC
 * brasileño.
 */
function phonkPorNombre(t: Track) {
  const titulo = t.title;
  if (/\b(?:phonk|montagem|mtg|automotivo|batid[aã]o|mandel[aã]o)\b/i.test(titulo)) return true;
  if (t.year && t.year < 2018) return false;
  // El título sin la versión ("MATADORA - Slowed", "TITAN! (Ultra Slowed)"), en mayúsculas como en el phonk.
  const version = /\s*(?:-\s*|[([])(?:ultra |super )?(?:slowed|sped up|slown down)[^)\]]*[)\]]?\s*$/i;
  const base = titulo.replace(version, '');
  const mayusculas = /\p{Lu}/u.test(base) && base === base.toUpperCase();
  if (mayusculas && /\bFUNK\b/.test(base)) return true;
  const miembros = integrantes(t.artist);
  const mc = miembros.some((a) => /^mc\b|\bmc$/.test(a));
  // Productores "-MANE" (ICEDMANE, Scythermane): solo con título en mayúsculas o versión slowed, porque
  // Sleepermane hace lofi.
  const slowed = version.test(titulo);
  if ((mayusculas || slowed) && miembros.some((a) => a.length >= 6 && /mane$/.test(a.replace(/\s/g, '')))) return true;
  // Versión slowed de un tema en mayúsculas o con un MC brasileño ("MATADORA - Slowed", "VEM NO PIQUE").
  // (No "ALWAYS BEEN YOU - Sped Up" de Chris Grey, que es pop.)
  const otroEstilo = t.genres.some((g) => /pop|r&b|rnb|soul|rock|country|jazz/i.test(g));
  if (slowed && (mayusculas || mc) && !otroEstilo) return true;
  return false;
}
/**
 * ¿Lofi para estudiar? Lofi Girl y sus sellos casi nunca traen género (o solo "Electronic"): se nota en el
 * artista o el álbum ("Sleepermane y Lofi Girl", "lofi hip hop radio").
 */
function lofiPorNombre(t: Track) {
  if (integrantes(t.artist).some((a) => /^(?:lofi girl|chillhop music|chillhop|college music|lofi records|dreamhop|steezyasfuck)$/.test(a))) return true;
  return /\blofi\b|\bchillhop\b|lo-fi (?:hip hop|beats)|study beats/i.test(`${t.artist} ${t.album}`);
}
/** Phonk por sí misma (géneros, título o artista), sin mirar a otras canciones. */
const esPhonkPropio = (t: Track) => phonkPorNombre(t) || t.genres.some((g) => PHONK.test(g.toLowerCase()));

interface FamilyCache {
  byArtist: Map<string, string[]>;
  /** Integrantes que ya hicieron phonk en el catálogo (DJ Asul por "MATADORA" → también "VAI VAI TRAIR"). */
  phonkeros: Set<string>;
  vec: Map<string, number[] | null>;
}
const familyCache = new WeakMap<Model, FamilyCache>();

/** Vector de familias de una canción (si no tiene géneros, usa los de su artista en tu biblioteca). */
function familiesOf(m: Model, t: Track): number[] | null {
  let c = familyCache.get(m);
  if (!c) {
    // Géneros por artista: une los de todas sus canciones (para las que no trajeron géneros).
    const byArtist = new Map<string, string[]>();
    // Quien tiene al menos la mitad de sus canciones en phonk (Lofi Girl aparece con Sleepermane una vez: no).
    const cuenta = new Map<string, [number, number]>();
    for (const x of m.input.tracks) {
      const ph = esPhonkPropio(x) ? 1 : 0;
      for (const a of integrantes(x.artist)) {
        const [p, n] = cuenta.get(a) ?? [0, 0];
        cuenta.set(a, [p + ph, n + 1]);
      }
    }
    const phonkeros = new Set([...cuenta].filter(([, [p, n]]) => p > 0 && 2 * p >= n).map(([a]) => a));
    for (const x of m.input.tracks) {
      if (!x.genres.length) continue;
      const k = normalize(x.artist);
      byArtist.set(k, [...(byArtist.get(k) ?? []), ...x.genres]);
    }
    c = { byArtist, phonkeros, vec: new Map() };
    familyCache.set(m, c);
  }
  const hit = c.vec.get(t.id);
  if (hit !== undefined) return hit;
  const tags = (t.genres.length ? t.genres : (c.byArtist.get(normalize(t.artist)) ?? [])).map((g) => g.toLowerCase());
  let v: number[] | null = null;
  if (tags.length) {
    v = FAMILY_KEYS.map((f) => tags.filter((g) => enFamilia(f, g)).length);
    if (v.every((x) => x === 0)) v = null;
  }
  // Phonk sin género: por su título o artista, o porque alguien de la canción hace sobre todo phonk (DJ Asul:
  // "MATADORA - Slowed" → también "VAI VAI TRAIR"). Lo segundo solo si la canción no trae géneros propios, o
  // solo uno genérico de tienda ("Dance", "Electronic": ACELERADA de MXZI).
  const generica = t.genres.every((g) => /^(?:electronic|electronica|dance|edm|latin|brazilian|hip-hop\/rap)$/i.test(g.trim()));
  const solo = (familia: string) => FAMILY_KEYS.map((f) => (f === familia ? 1 : 0));
  if (phonkPorNombre(t) || (generica && integrantes(t.artist).some((a) => c.phonkeros.has(a)))) v = solo('phonk');
  else if (generica && lofiPorNombre(t)) v = solo('lofi');
  c.vec.set(t.id, v);
  return v;
}

/** Familias que se llevan bien entre sí aunque no sean la misma (si hay que salir del estilo, mejor a una de estas). */
const PARIENTES: [string, string][] = [
  ['pop', 'kpop'], ['pop', 'rnb'], ['pop', 'electronic'], ['pop', 'latin'], ['pop', 'soft'],
  ['rock', 'soft'], ['rock', 'metal'], ['hiphop', 'rnb'], ['electronic', 'kpop'], ['jazz', 'soft'], ['country', 'soft'],
  ['phonk', 'hiphop'], ['phonk', 'electronic'], ['phonk', 'rapinternet'],
  ['hyperpop', 'pop'], ['hyperpop', 'electronic'], ['hyperpop', 'nightcore'], ['hyperpop', 'chiptune'], ['hyperpop', 'rapinternet'],
  ['hyperpop', 'breakcore'], ['hyperpop', 'vaporwave'], ['vaporwave', 'chiptune'], ['nightcore', 'chiptune'], ['nightcore', 'electronic'], ['nightcore', 'kpop'], ['chiptune', 'electronic'],
  ['vaporwave', 'electronic'], ['vaporwave', 'rnb'], ['synthwave', 'electronic'], ['breakcore', 'electronic'],
  ['witchhouse', 'electronic'], ['dnb', 'electronic'], ['lofi', 'hiphop'], ['bedroom', 'rock'], ['bedroom', 'pop'],
];
/**
 * Tan cercanas que en la radio se mezclan sin problema: el corrido tumbado es casi urbano latino, el cloud rap
 * es rap, el lofi viene del jazz, el future funk y el synthwave miran a los 80, el breakcore sale del jungle.
 */
const CERCANAS: [string, string][] = [
  ['mexicano', 'latin'], ['rapinternet', 'hiphop'], ['lofi', 'jazz'], ['vaporwave', 'synthwave'], ['breakcore', 'dnb'],
];
const familiaTop = (v: number[]) => FAMILY_KEYS[v.indexOf(Math.max(...v))];
const enPares = (pares: [string, string][], a: number[], b: number[]) => {
  const x = familiaTop(a);
  const y = familiaTop(b);
  return pares.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
};
function emparentadas(a: number[], b: number[]) {
  return enPares(PARIENTES, a, b) || enPares(CERCANAS, a, b);
}
const cercanas = (a: number[], b: number[]) => enPares(CERCANAS, a, b);

// ---------------- Idioma (para que la radio no salte de K-pop en inglés a reggaetón en español) ----------------

type Idioma = 'es' | 'en' | 'ko' | 'ja' | 'pt' | 'it' | 'fr';
const PALABRAS: Record<Exclude<Idioma, 'ko' | 'ja'>, string[]> = {
  es: ['el', 'la', 'los', 'las', 'que', 'mi', 'tu', 'amor', 'corazon', 'quiero', 'con', 'por', 'para', 'una', 'yo', 'mas', 'como', 'noche', 'vida', 'baila', 'mami', 'bebe', 'contigo', 'sin', 'todo', 'nada', 'eres', 'estoy', 'dime', 'cuando', 'donde', 'perreo', 'despecha', 'otra', 'vez', 'loca', 'ojos', 'besos', 'beso',
    // También en portugués o italiano: cuentan para los dos.
    'te', 'nunca', 'mia'],
  en: ['the', 'you', 'love', 'my', 'it', 'in', 'of', 'on', 'your', 'baby', 'dont', 'girl', 'night', 'heart', 'all', 'we', 'to', 'is', 'and', 'oh', 'up', 'way', 'what', 'just', 'like', 'with', 'be', 'this', 'that', 'its', 'me', 'im', 'go', 'out', 'down', 'boy', 'feel', 'want', 'get', 'got', 'never', 'got', 'touch', 'game', 'girls', 'about',
    'hey', 'i', 'dance', 'tonight', 'gonna', 'wanna', 'come', 'little', 'time', 'good', 'let', 'can', 'shake', 'world', 'christmas',
    'sunshine', 'forever', 'everybody', 'somebody', 'nothing', 'tell', 'take', 'make', 'when', 'who', 'where', 'why', 'more', 'only',
    'happy', 'party', 'kiss', 'crazy', 'dream', 'dreams', 'remember', 'life', 'stay', 'stop', 'run', 'walk', 'talk', 'back', 'again'],
  // Sin "do", "da", "um", "ao": salen en inglés ("Do Not Disturb", "Sorry 4 Da Wait") y en nombres.
  pt: ['voce', 'nao', 'coracao', 'eu', 'saudade', 'amo', 'meu', 'minha', 'pra', 'tudo', 'beijo', 'ela', 'ele', 'dos', 'das', 'uma',
    'sem', 'mais', 'seu', 'sua', 'muito', 'agora', 'nunca', 'aos', 'tem', 'vai', 'vou', 'esse', 'essa', 'isso', 'aqui', 'onde', 'quando', 'gente',
    // También en español: cuentan para los dos, así deciden las palabras que son solo de uno.
    'que', 'por', 'para', 'amor', 'vida', 'como', 'todo', 'nada', 'te'],
  it: ['che', 'sei', 'amore', 'mio', 'della', 'per', 'ti', 'non', 'sono', 'tutto', 'notte', 'cuore', 'bella', 'ciao', 'questo',
    'di', 'il', 'mia', 'tra', 'gli', 'nel', 'mai', 'sempre', 'ancora', 'io', 'storia', 'assenza', 'vita', 'volta', 'senza', 'perche'],
  fr: ['je', 'les', 'mon', 'toi', 'pas', 'moi', 'qui', 'est', 'cest', 'mais', 'tout', 'jamais', 'avec', 'dans', 'aime', 'pour'],
};
const GENERO_IDIOMA: [RegExp, Idioma][] = [
  [/k-pop|kpop|korean|k-r&b|k-hip/, 'ko'],
  [/j-pop|jpop|j-rock|japanese|anime|city pop/, 'ja'],
  [/latin|reggaeton|reggaet|bachata|salsa|cumbia|merengue|flamenco|ranchera|corrido|en espanol|en español|regional mexican|m[uú]sica mexicana|norte[nñ]o|urbano|trap latino|dembow|\bbanda\b(?! sonora)/, 'es'],
  [/mpb|sertanejo|bossa|samba|funk carioca|baile funk|mandel|axe|pagode|brazil/, 'pt'],
  [/italian|canzone|italo pop/, 'it'],
  [/chanson|french|variete francaise/, 'fr'],
  [/^english$/, 'en'],
];

/** Puntos de idioma de un texto (títulos, álbumes). */
function puntosIdioma(texto: string, out: Map<Idioma, number>) {
  const suma = (l: Idioma, n: number) => out.set(l, (out.get(l) ?? 0) + n);
  if (/[가-힯ᄀ-ᇿ]/.test(texto)) suma('ko', 4);
  if (/[぀-ヿ]/.test(texto)) suma('ja', 4);
  if (/[ñ¿¡]/i.test(texto)) suma('es', 2);
  if (/[ãõç]/i.test(texto)) suma('pt', 2);
  if (/[êô]/i.test(texto)) suma('pt', 1);
  // Sin los invitados que agrega la app ("(con Rayvon)") y cada palabra una vez ("La La La La" no es español).
  const limpio = texto.replace(/[([](?:con|feat\.?|ft\.?|with)\s[^)\]]*[)\]]/gi, ' ');
  if (/spanish version|versi[oó]n en espa[nñ]ol|en espa[nñ]ol/i.test(limpio)) suma('es', 4);
  const palabras = new Set(normalize(limpio).split(' '));
  for (const [l, lista] of Object.entries(PALABRAS) as [Idioma, string[]][]) {
    for (const w of palabras) if (lista.includes(w)) suma(l, 1);
  }
}

/** Puntos de idioma por géneros. "latin" junto a un género brasileño es música brasileña, no en español. */
function puntosGenero(generos: string[], out: Map<Idioma, number>, brasileno = false) {
  const ls = new Set<Idioma>();
  for (const g of generos) for (const [re, l] of GENERO_IDIOMA) if (re.test(g.toLowerCase())) ls.add(l);
  if (brasileno || ls.has('pt')) ls.delete('es');
  for (const l of ls) out.set(l, (out.get(l) ?? 0) + 2);
}

const idiomaCache = new WeakMap<Model, Map<string, Idioma | null>>();
/**
 * Idioma de un artista (se decide con TODAS sus canciones: títulos, álbumes y géneros). null = no se sabe
 * (pocas pistas o empate): en ese caso no se usa para filtrar.
 */
function idiomaDe(m: Model, t: Track): Idioma | null {
  let c = idiomaCache.get(m);
  if (!c) {
    c = new Map();
    const porArtista = new Map<string, Track[]>();
    for (const x of m.input.tracks) {
      const k = normalize(x.artist);
      porArtista.set(k, [...(porArtista.get(k) ?? []), x]);
    }
    for (const [k, lista] of porArtista) {
      const pts = new Map<Idioma, number>();
      // Si alguna de sus canciones dice "brazilian"/"mpb"…, el "latin" de las otras tampoco es español.
      const brasileno = lista.some((x) => x.genres.some((g) => GENERO_IDIOMA.some(([re, l]) => l === 'pt' && re.test(g.toLowerCase()))));
      for (const x of lista) {
        puntosIdioma(`${x.title} ${x.album}`, pts);
        puntosGenero(x.genres, pts, brasileno);
      }
      const orden = [...pts.entries()].sort((a, b) => b[1] - a[1]);
      const [primero, segundo] = orden;
      // Hace falta una pista clara: al menos 3 puntos y bastante más que el segundo idioma.
      c.set(k, primero && primero[1] >= 3 && (!segundo || primero[1] >= segundo[1] * 1.6) ? primero[0] : null);
    }
    idiomaCache.set(m, c);
  }
  const k = `t:${t.id}`;
  if (c.has(k)) return c.get(k) ?? null;
  // El título de la canción (sin el álbum): si dice claro su idioma, manda ("I'm Never Gonna Change" de José
  // Feliciano, que canta en los dos).
  const pts = new Map<Idioma, number>();
  puntosIdioma(t.title, pts);
  const [a, b] = [...pts.entries()].sort((x, y) => y[1] - x[1]);
  const claro = a && a[1] >= 2 && (!b || a[1] >= 2 * b[1]) ? a[0] : null;
  // Si no, el del artista; en una colaboración ("Daddy Yankee y Cardi B"), el del artista principal.
  const principal = normalize(t.artist.split(/\s+(?:y|&|and|feat\.?|ft\.?|con|x|with)\s+|,|\//i)[0] ?? '');
  let idioma = claro ?? c.get(normalize(t.artist)) ?? (principal ? c.get(principal) : null) ?? null;
  if (!idioma) {
    // Artista con pocas canciones (Toni Basil): título, álbum y géneros de esta canción, sin empate.
    const p2 = new Map<Idioma, number>();
    puntosIdioma(`${t.title} ${t.album}`, p2);
    puntosGenero(t.genres, p2);
    const [x, y] = [...p2.entries()].sort((u, v) => v[1] - u[1]);
    idioma = x && (!y || x[1] > y[1]) ? x[0] : null;
  }
  c.set(k, idioma);
  return idioma;
}

function cosine(a: number[], b: number[]) {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/**
 * Qué tan parecidas son dos canciones. Lo que más pesa: el estilo (familia de género) y el sonido
 * (energía, pulso, ritmo). Estilos claramente distintos (hip hop vs. soft rock) restan.
 */
/**
 * Qué tan distinta es la vibe de dos canciones (0 = igual, ~0,5 = opuesta), o null si alguna no tiene vibe.
 * Pesan más el ánimo (alegre/triste/relajada/agresiva/fiesta) y si es bailable que acústica/electrónica.
 */
const PESOS_VIBE: [keyof import('../types').Vibe, number][] = [
  ['feliz', 1.3],
  ['triste', 1.3],
  ['relajada', 1.2],
  ['agresiva', 1.1],
  ['fiesta', 1.2],
  ['bailable', 1.1],
  ['acustica', 0.8],
  ['electronica', 0.7],
  ['instrumental', 0.5],
];
const SUMA_VIBE = PESOS_VIBE.reduce((a, [, w]) => a + w, 0);
export function distanciaVibe(a: Track, b: Track): number | null {
  if (!a.vibe || !b.vibe) return null;
  let d = 0;
  for (const [k, w] of PESOS_VIBE) d += w * Math.abs(a.vibe[k] - b.vibe[k]);
  return d / SUMA_VIBE;
}

/** Etiquetas de Last.fm en común, ponderadas (0 = ninguna, 1 = las mismas). */
export function tagsEnComun(a: Track, b: Track) {
  if (!a.tags?.length || !b.tags?.length) return 0;
  const pa = new Map(a.tags.map((t) => [t.n, t.c]));
  let comun = 0;
  let total = 0;
  for (const t of b.tags) {
    total += t.c;
    const x = pa.get(t.n);
    if (x !== undefined) comun += Math.min(x, t.c);
  }
  for (const t of a.tags) total += t.c;
  return total ? (2 * comun) / total : 0;
}

/** Año de la canción; si no se conoce, el año en que fue éxito de fin de año. */
const epocaDe = (t: Track) => t.year ?? t.exito?.anio;

export function similarity(m: Model, a: Track, b: Track) {
  let s = 0;
  // Mismo artista suma poco: la radio es del ESTILO, no del artista (si no, termina en un álbum entero).
  if (normalize(a.artist) === normalize(b.artist)) s += 0.12;
  const fa = familiesOf(m, a);
  const fb = familiesOf(m, b);
  if (fa && fb) {
    const c = cosine(fa, fb);
    s += 0.5 * c;
    if (c < 0.15) s -= 0.3; // estilos que no tienen nada que ver
  }
  const va = m.sound.get(a.id);
  const vb = m.sound.get(b.id);
  if (va && vb) {
    const d =
      (1.5 * Math.abs(va.energy - vb.energy) +
        1.2 * Math.abs(va.beat - vb.beat) +
        Math.abs(va.activity - vb.activity) +
        0.6 * Math.abs(va.brightness - vb.brightness) +
        0.8 * Math.abs(va.fast - vb.fast)) /
      5.1;
    s += 0.4 * (1 - d) - 0.15; // sonido muy distinto también resta
  }
  // Vibe (escuchando el audio: alegre, triste, relajada, de fiesta…): dos canciones con distinto ánimo no
  // combinan aunque sean del mismo artista y año. Pesa tanto como el género.
  const dv = distanciaVibe(a, b);
  if (dv !== null) s += 0.5 * (1 - 2.2 * dv);
  // Etiquetas de Last.fm en común ("chill", "sad", "synthpop"…).
  s += 0.3 * tagsEnComun(a, b);
  const co = (m.transitions.get(`${a.id}>${b.id}`) ?? 0) + (m.transitions.get(`${b.id}>${a.id}`) ?? 0);
  s += 0.25 * Math.min(1, co / 3);
  // Les gustan a las mismas personas (de la cuenta y de otras).
  s += 0.3 * (m.input.vecinos?.get(a.id)?.get(b.id) ?? 0);
  // YouTube Music las pone juntas (su radio o "Relacionado").
  s += 0.35 * ytmEntre(m, a.id, b.id);
  // La época pesa: quien escucha Rick Astley sigue con los 80.
  const anioA = epocaDe(a);
  const anioB = epocaDe(b);
  if (anioA && anioB) {
    const gap = Math.abs(anioA - anioB);
    if (gap <= 4) s += 0.14;
    else if (gap <= 8) s += 0.06;
    else if (gap > 20) s -= 0.1;
  }
  return s;
}

/**
 * Radio: siguientes `n` canciones parecidas a las últimas que sonaron (la última pesa más),
 * que además te gusten. Evita repetir lo que ya está en la cola y elige con algo de azar entre las mejores.
 */
/** El Automix pone aquí un pequeño premio para las canciones que se pueden mezclar con la anterior. */
export const radioHooks: { bonus?: (prevId: string, id: string) => number } = {};

export function radio(m: Model, seedIds: string[], exclude: Set<string>, n: number) {
  const sesion = sesionDe(m);
  // Lo que acabas de saltar no sirve de ejemplo para elegir la siguiente.
  const vigentes = seedIds.filter((id) => !sesion.saltadas.has(id));
  const seeds = (vigentes.length ? vigentes : seedIds)
    .slice(-3)
    .reverse()
    .map((id, i) => ({ t: m.byId.get(id), w: [1, 0.6, 0.35][i] }))
    .filter((x): x is { t: Track; w: number } => !!x.t);
  if (!seeds.length) return shortcuts(m, n).filter((id) => !exclude.has(id));
  // Ancla: la canción con que empezó la radio (la primera que se recibe). Todo lo que se elija tiene que seguir
  // pareciéndose a ELLA, no solo a la anterior: así la radio no se va alejando de a poco hasta otro estilo.
  const ancla = m.byId.get(seedIds[0]) ?? seeds[0].t;
  const famAncla = familiesOf(m, ancla);
  const nicho = !!famAncla && [...ESCENAS_INTERNET, 'phonk'].includes(familiaTop(famAncla));
  const idiomaAncla = idiomaDe(m, ancla);
  // Categorías especiales: lo que sonó (ancla y semillas) define el "mundo" de la radio. Una canción de meme,
  // anime u OST de videojuego solo entra si la radio ya está en esa categoría; y si la radio es de anime, lo
  // que no es anime queda para cuando no quede nada más.
  const catsRadio = new Set([ancla, ...seeds.map((s) => s.t)].flatMap(mundoDe));
  const otroMundo = (t: Track) => mundoDe(t).some((c) => !catsRadio.has(c));
  /**
   * Qué tan fuera de lugar queda `t` en esta radio (0 = encaja). Estilo distinto o década distinta restan
   * tanto que solo entran si no queda nada mejor (una excepción rara, no la norma).
   */
  const fueraDeLugar = (t: Track) => {
    let p = 0;
    const f = familiesOf(m, t);
    if (famAncla) {
      // Sin género conocido: no se sabe. Si la radio es de un estilo de internet o phonk (pocas canciones), lo
      // desconocido casi siempre es otra cosa: mejor un estilo pariente (hyperpop → electrónica) que Pitbull.
      if (!f) p += normalize(t.artist) === normalize(ancla.artist) ? 0 : nicho ? 0.6 : 0.35;
      else {
        const c = cosine(famAncla, f);
        // Otro estilo (pop → metal: 0,9; pop → k-pop: 0,45; corridos → reggaetón: 0,2, entra igual).
        if (c < 0.2) p += cercanas(famAncla, f) ? 0.2 : emparentadas(famAncla, f) ? 0.45 : 0.9;
        else if (c < 0.5) p += 0.3;
      }
    }
    const anioAncla = epocaDe(ancla);
    const anioT = epocaDe(t);
    if (anioAncla && anioT) {
      const gap = Math.abs(anioAncla - anioT);
      if (gap > 15) p += 0.8; // otra época (2008 → 1982)
      else if (gap > 8) p += 0.35;
      else if (gap > 5) p += 0.1;
    } else if (anioAncla && !anioT) p += 0.15;
    // Otro idioma (K-pop en inglés → reggaetón en español): casi nunca. El K-pop mezcla coreano e inglés, así
    // que entre esos dos resta menos.
    const idioma = idiomaDe(m, t);
    if (idiomaAncla && idioma && idioma !== idiomaAncla) {
      const par = (x: Idioma, y: Idioma) => (idiomaAncla === x && idioma === y) || (idiomaAncla === y && idioma === x);
      // Pesa más que todo lo demás junto (época, estilo, vibe): una canción en otro idioma solo entra si no
      // queda ninguna otra. Español y portugués se mezclan (funk, sertanejo, reggaetón con brasileños): restan poco,
      // y el estilo decide.
      p += par('ko', 'en') || par('es', 'pt') ? 0.25 : 2.5;
    } else if (idiomaAncla && !idioma && normalize(t.artist) !== normalize(ancla.artist)) {
      // No se sabe en qué idioma está: puede entrar, pero después de las que seguro calzan.
      p += 0.45;
    }
    // Otra vibe que la canción con que empezó (empezó tranquila y melancólica → no una de fiesta): casi nunca.
    const dv = distanciaVibe(ancla, t);
    if (dv !== null) {
      if (dv > 0.34) p += 0.7;
      else if (dv > 0.24) p += 0.3;
    }
    return p;
  };
  const aff = [...m.baseAffinity.values()];
  const lo = Math.min(...aff);
  const hi = Math.max(...aff);
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const wsum = seeds.reduce((x, s) => x + s.w, 0);

  const scored: [string, number][] = [];
  const fuera = new Map<string, number>();
  const confianzaYt = confianzaEnYoutube(m);
  for (const t of m.input.tracks) {
    if (exclude.has(t.id) || isTestSilence(m, t.id) || otroMundo(t)) continue;
    let sim = 0;
    for (const s of seeds) sim += s.w * similarity(m, s.t, t);
    // Manda el parecido a lo último que sonó y, casi igual, a la canción con que empezó: así la cadena no se
    // va desviando paso a paso. Lo que te gusta solo desempata.
    // YouTube Music: lo que pone en la radio de la canción con que empezó (y de la última) manda. Si la pone ahí,
    // casi no importa que sea de otro estilo o época según nuestras etiquetas.
    const yA = confianzaYt * ytmEntre(m, ancla.id, t.id);
    const yL = confianzaYt * ytmEntre(m, seeds[0].t.id, t.id);
    let p = fueraDeLugar(t) * (1 - 0.75 * Math.max(yA, yL));
    if (catsRadio.size && !mundoDe(t).some((c) => catsRadio.has(c))) p += 1.2; // radio de anime → algo que no es anime: al final
    fuera.set(t.id, p);
    let score = 0.45 * (sim / wsum) + 0.4 * similarity(m, ancla, t) + 0.25 * norm(m.baseAffinity.get(t.id) ?? 0) - p;
    score += 0.9 * yA + 0.4 * yL;
    // Lo que aprendió de TI, aunque YouTube Music la ponga arriba: lo que te gusta sube y lo que saltas baja, y se
    // recuerda de una radio a otra (no solo en esta sesión).
    if (m.input.ratings[t.id] === 1) score += 0.15;
    const st = m.stats.get(t.id);
    if (st && st.skips >= 2 && st.skips > st.completes) score -= 0.3; // la que casi siempre saltas
    const saltada = (m.saltosTras.get(`${ancla.id}>${t.id}`) ?? 0) + (m.saltosTras.get(`${seeds[0].t.id}>${t.id}`) ?? 0);
    if (saltada) score -= Math.min(0.8, 0.4 * saltada); // ya la saltaste en una radio parecida
    // Popularidad en el servidor: las que la gente escucha completas suben; las que saltan, bajan un poco.
    if (t.pop !== undefined) score += 0.2 * (t.pop - 0.5);
    // Éxito histórico: solo un pequeño empujón, no reemplaza el parecido.
    score += 0.08 * (t.exito?.valor ?? 0);
    if (m.input.ratings[t.id] === -1) score -= 1.5;
    if (radioHooks.bonus) score += radioHooks.bonus(seedIds[seedIds.length - 1], t.id);
    // Lo que sonó hace muy poco, mejor después.
    const last = m.stats.get(t.id)?.lastPlayed ?? 0;
    if (m.input.now - last < 2 * 3600_000) score -= 0.3;
    scored.push([t.id, score]);
  }
  scored.sort((a, b) => b[1] - a[1]);

  // Gusto de hoy: entre las mejores, sube lo parecido a lo que terminaste en esta sesión y baja lo parecido a
  // lo que saltaste. Solo se mira la parte alta de la lista para que la radio siga siendo rápida.
  if (sesion.buenas.length || sesion.malas.length) {
    const cabeza = scored.slice(0, 300).map(([id, s]): [string, number] => {
      const t = m.byId.get(id)!;
      let extra = 0;
      for (const b of sesion.buenas) extra += (0.2 * similarity(m, b, t)) / sesion.buenas.length;
      for (const b of sesion.malas) extra -= (0.3 * similarity(m, b, t)) / sesion.malas.length;
      if ((sesion.artistasSaltados.get(normalize(t.artist)) ?? 0) >= 2) extra -= 0.4;
      return [id, s + extra];
    });
    cabeza.sort((a, b) => b[1] - a[1]);
    scored.splice(0, cabeza.length, ...cabeza);
  }

  // Variedad: el mismo artista no vuelve en 4 canciones y el mismo álbum no vuelve en 10.
  const artistOf = (id: string) => normalize(m.byId.get(id)?.artist ?? '');
  const albumOf = (id: string) => {
    const t = m.byId.get(id);
    return t && t.album && t.album !== 'Álbum desconocido' ? `${normalize(t.albumArtist)}|${normalize(t.album)}` : null;
  };
  const allowed = (id: string, hist: string[], artistas: number, albumes: number) => {
    const a = artistOf(id);
    const al = albumOf(id);
    return !(artistas && hist.slice(-artistas).some((x) => artistOf(x) === a)) && !(albumes && al && hist.slice(-albumes).some((x) => albumOf(x) === al));
  };
  // Orden de preferencia al elegir cada canción:
  //   1) del estilo y la época, con toda la variedad;
  //   2) del estilo y la época, repitiendo artista antes (es mejor repetir un artista que cambiar de estilo);
  //   3) solo si ya no queda nada del estilo: lo demás (la excepción rara).
  const encaja = (id: string) => (fuera.get(id) ?? 0) < 0.3;
  const NIVELES: [boolean, number, number][] = [
    [true, 4, 10],
    [true, 2, 6],
    [true, 1, 3],
    [true, 0, 0],
    [false, 4, 10],
    [false, 0, 0],
  ];
  const out: string[] = [];
  let lastArtist = normalize(seeds[0].t.artist);
  while (out.length < n) {
    const hist = [...seedIds, ...out];
    let pool: [string, number][] = [];
    for (const [estilo, a, al] of NIVELES) {
      pool = scored.filter(([id]) => !out.includes(id) && (!estilo || encaja(id)) && allowed(id, hist, a, al)).slice(0, 15);
      if (pool.length) break;
    }
    if (!pool.length) break;
    // Elige con azar entre las mejores (las mejores tienen más probabilidad); cuantas más veces sonó un artista
    // en las últimas 6, menos probable.
    const recent = hist.slice(-6).map(artistOf);
    const weights = pool.map(([id, s]) => {
      const a = artistOf(id);
      const times = recent.filter((r) => r === a).length;
      return Math.exp(s / 0.12) * (a === lastArtist ? 0.25 : 1) * Math.pow(0.45, times);
    });
    let r = Math.random() * weights.reduce((x, y) => x + y, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= weights[i]) > 0) i++;
    const id = pool[i][0];
    out.push(id);
    lastArtist = artistOf(id);
  }
  return out;
}

/**
 * Radio de una canción (como YT Music al tocar una canción): `n` canciones que siguen el estilo, cada una
 * elegida mirando las últimas que van sonando, así la lista se mueve poco a poco y sin saltos raros.
 */
export function radioChain(m: Model, seedId: string, n: number) {
  const chain = [seedId];
  const exclude = new Set(chain);
  for (let i = 0; i < n; i++) {
    const [id] = radio(m, chain, exclude, 1);
    if (!id) break;
    chain.push(id);
    exclude.add(id);
  }
  return chain.slice(1);
}

// ---------------- Gustos parecidos ----------------

const colabCache = new WeakMap<Model, Map<string, number>>();
/** Qué tanto apuntan tus canciones favoritas a cada otra canción, según quienes escuchan lo mismo (0–1). */
function colabDe(m: Model) {
  let c = colabCache.get(m);
  if (c) return c;
  c = new Map<string, number>();
  const vecinos = m.input.vecinos;
  if (vecinos?.size) {
    const favoritas = heardIds(m)
      .sort((a, b) => (m.baseAffinity.get(b) ?? 0) - (m.baseAffinity.get(a) ?? 0))
      .slice(0, 50);
    for (const id of favoritas) for (const [v, s] of vecinos.get(id) ?? []) c.set(v, (c.get(v) ?? 0) + s);
    let max = 0;
    for (const v of c.values()) max = Math.max(max, v);
    if (max > 0) for (const [k, v] of c) c.set(k, v / max);
  }
  colabCache.set(m, c);
  return c;
}

// ---------------- YouTube Music ----------------

/** Qué tan juntas pone YouTube Music a dos canciones (0–1), en cualquier sentido. */
function ytmEntre(m: Model, a: string, b: string) {
  const y = m.input.ytm;
  if (!y?.size) return 0;
  return Math.max(y.get(a)?.get(b) ?? 0, y.get(b)?.get(a) ?? 0);
}

/**
 * Cuánto confía TU cuenta en YouTube Music (0,75–1,2), aprendido de cómo reaccionas en la radio: si terminas más
 * las que propuso YouTube Music que las del algoritmo propio, pesa más; si las saltas más, pesa menos. Nunca baja
 * de 0,75: YouTube Music sigue mandando para que la radio sea coherente.
 */
export function confianzaEnYoutube(m: Model) {
  let aY = 0;
  let eY = 0;
  let aE = 0;
  let eE = 0;
  for (const r of m.input.resultados ?? []) {
    if (r.motivo === 'youtube') r.exito ? aY++ : eY++;
    else if (r.motivo === 'radio') r.exito ? aE++ : eE++;
  }
  // YouTube Music parte con la misma tasa que tu radio de siempre (confianza 1) y se mueve solo con lo que hagas
  // con sus canciones; con pocas reacciones casi no se mueve.
  const tasaE = (aE + 3) / (aE + eE + 4);
  const tasaY = (aY + 6 * tasaE) / (aY + eY + 6);
  return Math.max(0.75, Math.min(1.2, 1 + 1.5 * (tasaY - tasaE)));
}

/** De dónde salió una canción de la radio, para aprender: "youtube" si YouTube Music la pone cerca de la semilla. */
export function motivoRadio(m: Model, semilla: string, id: string) {
  return ytmEntre(m, semilla, id) >= 0.3 ? 'youtube' : 'radio';
}

const ytmCache = new WeakMap<Model, Map<string, number>>();
/**
 * Lo que YouTube Music recomienda a partir de lo TUYO DE AHORA (0–1): lo último que escuchaste entero, lo que
 * buscaste y tocaste, y tus favoritas de siempre (pesan menos). Así lo nuevo que te gusta cambia el feed pronto.
 */
function ytmTuyo(m: Model) {
  let c = ytmCache.get(m);
  if (c) return c;
  c = new Map<string, number>();
  const y = m.input.ytm;
  if (y?.size) {
    const tuyas = heardIds(m);
    const semillas = new Map<string, number>();
    const poner = (id: string, w: number) => semillas.set(id, Math.max(semillas.get(id) ?? 0, w));
    [...tuyas]
      .sort((a, b) => (m.stats.get(b)?.lastPlayed ?? 0) - (m.stats.get(a)?.lastPlayed ?? 0))
      .slice(0, 25)
      .forEach((id, i) => poner(id, 1 - (0.5 * i) / 25));
    (m.input.buscadas ?? []).filter((id) => m.byId.has(id) && m.input.ratings[id] !== -1).forEach((id, i) => poner(id, 0.9 - 0.04 * i));
    [...tuyas]
      .sort((a, b) => (m.baseAffinity.get(b) ?? 0) - (m.baseAffinity.get(a) ?? 0))
      .slice(0, 25)
      .forEach((id) => poner(id, 0.45));
    for (const [s, w] of semillas) for (const [v, x] of y.get(s) ?? []) c.set(v, (c.get(v) ?? 0) + w * x);
    let max = 0;
    for (const v of c.values()) max = Math.max(max, v);
    if (max > 0) for (const [k, v] of c) c.set(k, v / max);
  }
  ytmCache.set(m, c);
  return c;
}

// ---------------- La sesión de ahora ----------------

interface Sesion {
  buenas: Track[];
  malas: Track[];
  saltadas: Set<string>;
  artistasSaltados: Map<string, number>;
}
const HUECO_SESION = 30 * 60_000;
const sesionCache = new WeakMap<Model, Sesion>();

/** Lo que pasó en tu sesión actual: termina cuando hubo más de 30 minutos sin escuchar nada. */
function sesionDe(m: Model): Sesion {
  let s = sesionCache.get(m);
  if (s) return s;
  s = { buenas: [], malas: [], saltadas: new Set(), artistasSaltados: new Map() };
  const plays = m.input.plays;
  let siguiente = m.input.now;
  for (let i = plays.length - 1, vistos = 0; i >= 0 && vistos < 15; i--, vistos++) {
    const p = plays[i];
    if (siguiente - (p.startedAt + (p.listened || 0) * 1000) > HUECO_SESION) break;
    siguiente = p.startedAt;
    const t = m.byId.get(p.trackId);
    if (!t) continue;
    if (p.skipped) {
      s.saltadas.add(t.id);
      const k = normalize(t.artist);
      s.artistasSaltados.set(k, (s.artistasSaltados.get(k) ?? 0) + 1);
      if (s.malas.length < 3) s.malas.push(t);
    } else if (p.completed && s.buenas.length < 3) s.buenas.push(t);
  }
  sesionCache.set(m, s);
  return s;
}

// ---------------- Exploración y listas personales ----------------

/** Azar repetible: con la misma semilla sale siempre lo mismo. */
function azarDe(semilla: string) {
  let h = 2166136261;
  for (let i = 0; i < semilla.length; i++) h = Math.imul(h ^ semilla.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una apuesta según aciertos y errores: con pocos datos varía mucho (explora); con muchos, se afirma. */
function apuesta(azar: () => number, aciertos: number, errores: number) {
  const a = 1 + Math.min(40, aciertos);
  const b = 1 + Math.min(40, errores);
  const xs = Array.from({ length: a + b - 1 }, azar).sort((x, y) => x - y);
  return xs[a - 1];
}

const familiaPrincipal = (v: number[]) => FAMILY_KEYS[v.indexOf(Math.max(...v))];

/** Por cada familia de género, cuánto conviene apostar por ella contigo según cómo te fue antes. */
function apuestasPorFamilia(m: Model, azar: () => number) {
  const cuenta = new Map<string, [number, number]>();
  for (const r of m.input.resultados ?? []) {
    const t = m.byId.get(r.trackId);
    const f = t && familiesOf(m, t);
    if (!f) continue;
    const k = familiaPrincipal(f);
    const c = cuenta.get(k) ?? [0, 0];
    c[r.exito ? 0 : 1]++;
    cuenta.set(k, c);
  }
  return new Map(FAMILY_KEYS.map((k) => [k, apuesta(azar, cuenta.get(k)?.[0] ?? 0, cuenta.get(k)?.[1] ?? 0)]));
}

const MIN_PARA_LISTAS = 15;
const porAfinidad = (m: Model, ids: string[]) => [...ids].sort((a, b) => (m.baseAffinity.get(b) ?? 0) - (m.baseAffinity.get(a) ?? 0));

/** Intercala `extra` cada cierta distancia dentro de `base`, sin pasar de `n`. */
function intercalar<T>(base: T[], extra: T[], n: number) {
  const out = [...base];
  const paso = extra.length ? Math.max(2, Math.floor(n / extra.length)) : 1;
  extra.forEach((x, i) => out.splice(Math.min(paso * i + paso - 1, out.length), 0, x));
  return out.slice(0, n);
}

/**
 * Descubrimiento semanal: canciones que nunca escuchaste. La mayoría calza con tus estilos y una parte explora
 * estilos cercanos. Esa parte crece o se achica según cómo reaccionas a lo que se te propone.
 * null = todavía hay poco historial para armarla.
 */
export function descubrimientoSemanal(m: Model, n: number, semilla: string, evitar: Set<string> = new Set()): ItemReco[] | null {
  const mias = porAfinidad(m, heardIds(m));
  if (mias.length < MIN_PARA_LISTAS) return null;
  const azar = azarDe(semilla);
  const seeds = mias.slice(0, 12).map((id) => m.byId.get(id)!);
  const colab = colabDe(m);
  const familias = apuestasPorFamilia(m, azar);
  const gusto = tasteShares(m);
  let aciertos = 0;
  let errores = 0;
  for (const r of m.input.resultados ?? []) if (r.motivo === 'explora') r.exito ? aciertos++ : errores++;
  const parte = clamp01(Math.max(0.1, Math.min(0.35, apuesta(azar, aciertos, errores + 2))));
  const cuantas = Math.round(n * parte);

  const propias: [string, number][] = [];
  const lejanas: [string, number][] = [];
  for (const t of m.input.tracks) {
    if (m.stats.has(t.id) || m.input.ratings[t.id] !== undefined || isTestSilence(m, t.id) || !categoriaPermitida(m, t)) continue;
    let sim = 0;
    for (const s of seeds) sim = Math.max(sim, similarity(m, s, t));
    const fit = styleFit(m, t);
    const c = colab.get(t.id) ?? 0;
    const f = familiesOf(m, t);
    const fam = f ? (familias.get(familiaPrincipal(f)) ?? 0.5) - 0.5 : 0;
    const exito = t.exito?.valor ?? 0;
    // Lo de la semana pasada que no escuchaste no vuelve enseguida: cada lunes, canciones nuevas.
    const repetida = evitar.has(t.id) ? 0.6 : 0;
    if (fit === null || fit >= 0.5) propias.push([t.id, sim + 0.3 * (fit ?? 0) + 0.5 * c + 0.12 * exito + 0.2 * fam + 0.2 * azar() - repetida]);
    else if (sim >= 0.1 && f && gusto && (c >= 0.2 || emparentadas(gusto, f))) lejanas.push([t.id, sim + 0.3 * Math.max(t.pop ?? 0.25, exito) + 0.3 * fam + 0.25 * azar() - repetida]);
  }
  const orden = (l: [string, number][]) => variedadDeAnios(m, l.sort((a, b) => b[1] - a[1]).slice(0, 300).map(([id]) => id), n, 0.4);
  const explora = diverse(m, orden(lejanas), cuantas, 1);
  const base = diverse(m, orden(propias), n - explora.length, 1);
  const motivoDe = (id: string): ItemReco['motivo'] => (explora.includes(id) ? 'explora' : (colab.get(id) ?? 0) >= 0.2 ? 'colab' : 'parecido');
  return intercalar(base, explora, n).map((id) => ({ id, motivo: motivoDe(id) }));
}

/** Que ninguna década pase de `max` de la lista: las que sobran van al final (por si no alcanza). */
function variedadDeAnios(m: Model, ids: string[], n: number, max: number) {
  const tope = Math.max(2, Math.ceil(n * max));
  const cuenta = new Map<number, number>();
  const out: string[] = [];
  const despues: string[] = [];
  for (const id of ids) {
    const y = m.byId.get(id)?.year;
    if (!y) {
      out.push(id);
      continue;
    }
    const d = Math.floor(y / 10);
    const c = cuenta.get(d) ?? 0;
    if (c >= tope) despues.push(id);
    else {
      cuenta.set(d, c + 1);
      out.push(id);
    }
  }
  return [...out, ...despues];
}

const escenasCache = new WeakMap<Track[], Map<string, Escena>>();
/** Las escenas dependen solo del catálogo: se calculan una vez, no por cada cuenta. */
function escenasDe(m: Model) {
  let e = escenasCache.get(m.input.tracks);
  if (!e) escenasCache.set(m.input.tracks, (e = clasificarEscenas(m.input.tracks)));
  return e;
}

/** Como `diverse`, pero sin rellenar: si no hay suficientes artistas, la lista queda más corta. */
function conLimiteArtista(m: Model, ids: string[], n: number, porArtista: number) {
  const cuenta = new Map<string, number>();
  const out: string[] = [];
  for (const id of ids) {
    const k = normalize(m.byId.get(id)?.artist ?? '');
    const c = cuenta.get(k) ?? 0;
    if (c >= porArtista) continue;
    cuenta.set(k, c + 1);
    out.push(id);
    if (out.length >= n) break;
  }
  return out;
}

const MIN_DIARIO = 12;

/**
 * Mixes diarios: uno por cada escena que más escuchas (hasta 3). Una escena es estilo + época + sonido (ver
 * escenas.ts), así Electrónica actual no se mezcla con disco de los 70. Llevan canciones tuyas y casi la mitad
 * nuevas de esa misma escena, distintas cada día; si no alcanza, la lista queda corta o no aparece. null = poco historial todavía.
 */
export function mixesDiarios(m: Model, n: number, semilla: string, evitar: Set<string> = new Set()): { titulo: string; items: ItemReco[] }[] | null {
  const mias = heardIds(m);
  if (mias.length < MIN_PARA_LISTAS) return null;
  const azar = azarDe(semilla);
  const colab = colabDe(m);
  const escenas = escenasDe(m);
  const tuyas = new Map<string, { e: Escena; peso: number; ids: string[] }>();
  let total = 0;
  for (const id of mias) {
    const e = escenas.get(id);
    if (!e) continue;
    const peso = (m.stats.get(id)?.completes ?? 0) + (m.input.ratings[id] === 1 ? 2 : 0);
    const x = tuyas.get(e.id) ?? { e, peso: 0, ids: [] };
    x.peso += peso;
    x.ids.push(id);
    tuyas.set(e.id, x);
    total += peso;
  }
  const principales = [...tuyas.values()].filter((x) => x.ids.length >= 4 && x.peso / total >= 0.1).sort((a, b) => b.peso - a.peso);
  const out: { titulo: string; items: ItemReco[] }[] = [];
  for (const { e, ids: suyas } of principales) {
    if (out.length >= 3) break;
    const orden = suyas
      .map((id): [string, number] => [id, (m.baseAffinity.get(id) ?? 0) + 0.8 * azar() - (evitar.has(id) ? 0.8 : 0)])
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const conocidas = conLimiteArtista(m, orden, Math.ceil(n * 0.55), 3);
    const seeds = conocidas.slice(0, 5).map((id) => m.byId.get(id)!);
    const nuevas: [string, number][] = [];
    for (const t of m.input.tracks) {
      if (escenas.get(t.id)?.id !== e.id || m.stats.has(t.id) || m.input.ratings[t.id] !== undefined || isTestSilence(m, t.id)) continue;
      let sim = 0;
      for (const s of seeds) sim = Math.max(sim, similarity(m, s, t));
      // Las nuevas de ayer no se repiten hoy (salvo que no haya más).
      nuevas.push([t.id, sim + 0.5 * (colab.get(t.id) ?? 0) + 0.1 * (t.exito?.valor ?? 0) + 0.25 * azar() - (evitar.has(t.id) ? 1 : 0)]);
    }
    const ids = conLimiteArtista(m, nuevas.sort((a, b) => b[1] - a[1]).map(([id]) => id), n - conocidas.length, 2);
    if (conocidas.length + ids.length < MIN_DIARIO) continue;
    const items = intercalar<ItemReco>(
      conocidas.map((id) => ({ id, motivo: 'conocida' })),
      ids.map((id) => ({ id, motivo: (colab.get(id) ?? 0) >= 0.2 ? 'colab' : 'parecido' })),
      n,
    );
    out.push({ titulo: `Mix diario: ${e.nombre}`, items });
  }
  return out;
}

// ---------------- Perfil de gustos (para ordenar la búsqueda) ----------------

export interface Taste {
  families: number[] | null;
  year: number | null;
  yearSpread: number;
  affinity: (id: string) => number; // 0–1
}

/**
 * Tu perfil: los estilos y la época de lo que más escuchas y te gusta. Sirve para desempatar
 * búsquedas: si buscas "Dynamite" y escuchas k-pop, primero BTS; si escuchas los 80, Jermaine Jackson.
 */
export function buildTaste(m: Model): Taste {
  const aff = [...m.baseAffinity.entries()];
  const vals = aff.map(([, v]) => v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  // Las 25 que más te gustan (que hayas escuchado de verdad o marcado "me gusta").
  const top = aff
    .filter(([id]) => (m.stats.get(id)?.completes ?? 0) > 0 || m.input.ratings[id] === 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25);
  let fam: number[] | null = null;
  const years: { y: number; w: number }[] = [];
  for (const [id, v] of top) {
    const t = m.byId.get(id);
    if (!t) continue;
    const w = 0.3 + norm(v);
    const f = familiesOf(m, t);
    if (f) {
      const len = Math.sqrt(f.reduce((a, b) => a + b * b, 0)) || 1;
      fam ??= f.map(() => 0);
      f.forEach((x, i) => (fam![i] += (w * x) / len));
    }
    if (t.year) years.push({ y: t.year, w });
  }
  const wsum = years.reduce((a, b) => a + b.w, 0);
  const year = wsum ? years.reduce((a, b) => a + b.y * b.w, 0) / wsum : null;
  const spread = year !== null && wsum ? Math.sqrt(years.reduce((a, b) => a + b.w * (b.y - year) ** 2, 0) / wsum) : 15;
  return { families: fam, year, yearSpread: Math.max(6, spread), affinity: (id) => norm(m.baseAffinity.get(id) ?? lo) };
}

/** Qué tanto encaja una canción con tu perfil (0–1): estilo, época y cuánto te gusta. */
export function tasteScore(m: Model, taste: Taste, t: Track): number {
  let s = 0;
  const f = familiesOf(m, t);
  if (f && taste.families) s += 0.45 * cosine(f, taste.families);
  if (t.year && taste.year !== null) s += 0.3 * Math.exp(-(((t.year - taste.year) / taste.yearSpread) ** 2) / 2);
  s += 0.25 * taste.affinity(t.id);
  return s;
}
