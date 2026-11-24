/**
 * Búsqueda tolerante: no hace falta escribir el nombre exacto.
 * - Ignora tildes, mayúsculas y signos ("satelite" → "Satélite").
 * - Las palabras pueden ir en cualquier orden ("ciudad luces" → "Luces de Ciudad").
 * - Basta el comienzo de una palabra ("medi" → "Medianoche").
 * - Perdona errores de escritura ("medianoxe", "arecifes", "lusez", "espreso" → "Espresso"),
 *   con distancia de edición (Levenshtein, contando también letras cambiadas de lugar).
 * - Ignora puntos y espacios dentro de siglas: "nwa" → "N.W.A.", "acdc" → "AC/DC".
 */

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Distancia de edición (con transposiciones: "lsua" ≈ "luas"), cortando pronto si supera `max`. */
// Tres filas que se reutilizan (antes se creaban arreglos nuevos en cada comparación: miles por búsqueda).
let filaA = new Int32Array(64);
let filaB = new Int32Array(64);
let filaC = new Int32Array(64);
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length + 1;
  if (filaA.length < n) {
    filaA = new Int32Array(n * 2);
    filaB = new Int32Array(n * 2);
    filaC = new Int32Array(n * 2);
  }
  let prev2 = filaA;
  let prev = filaB;
  let cur = filaC;
  for (let j = 0; j < n; j++) {
    prev[j] = j;
    prev2[j] = 0;
  }
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    const ai1 = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = 1; j < n; j++) {
      const bj = b.charCodeAt(j - 1);
      const cost = ai === bj ? 0 : 1;
      let v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (prev[j - 1] + cost < v) v = prev[j - 1] + cost;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && ai1 === bj && prev2[j - 2] + 1 < v) v = prev2[j - 2] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  return prev[n - 1];
}

/** Errores permitidos según el largo de lo que escribiste. */
function allowedTypos(len: number) {
  return len <= 3 ? 0 : len <= 6 ? 1 : 2;
}

/**
 * Cómo "suena" una palabra en español, para perdonar errores de ortografía:
 * "lusez" = "luces", "biaje" = "viaje", "kiero" = "quiero", "yuvia" = "lluvia", "ola" = "hola".
 */
export function phonetic(w: string): string {
  return w
    .replace(/ch/g, 'x')
    .replace(/h/g, '')
    .replace(/qu/g, 'k')
    .replace(/c([ei])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'b')
    .replace(/w/g, 'u')
    .replace(/ll/g, 'y')
    .replace(/g([ei])/g, 'j$1')
    .replace(/y$/, 'i')
    .replace(/(.)\1+/g, '$1'); // letras dobles: "arrecifes" = "arecifes"
}

/** Qué tan bien coincide una palabra buscada con una palabra del texto (0 = nada, 1 = perfecto). */
function wordScore(q: string, w: string): number {
  const exact = spellingScore(q, w);
  if (exact >= 0.9) return exact;
  // Si no coincide escrita, probamos cómo suena (con un pequeño castigo).
  // Solo con palabras de 3+ letras, para que "zzz" (que suena "s") no encuentre todo.
  const pq = phoneticMemo(q);
  if (q.length < 3 || pq.length < 3) return exact;
  return Math.max(exact, spellingScore(pq, phoneticMemo(w)) * 0.95);
}

function spellingScore(q: string, w: string): number {
  if (!q || !w) return 0;
  if (w === q) return 1;
  if (w.startsWith(q)) return 0.9;
  if (q.length >= 3 && w.includes(q)) return 0.7;
  const max = allowedTypos(q.length);
  if (max === 0) return 0;
  // Compara contra la palabra completa y contra su comienzo (para búsquedas a medio escribir con error).
  const full = editDistance(q, w, max);
  const prefix = w.length > q.length ? editDistance(q, w.slice(0, q.length), max) : max + 1;
  const d = Math.min(full, prefix);
  return d <= max ? 0.6 - d * 0.15 : 0;
}

export interface SearchField {
  text: string;
  weight: number; // el título pesa más que el álbum, por ejemplo
}

/**
 * Comparación "todo junto", sin espacios: así "nwa" encuentra "N.W.A." (que queda como "n w a"),
 * "acdc" encuentra "AC/DC" y "badbunny" encuentra "Bad Bunny".
 */
function compactScore(qCompact: string, fCompact: string): number {
  if (qCompact.length < 3 || !fCompact) return 0;
  if (fCompact === qCompact) return 1.2;
  if (fCompact.startsWith(qCompact)) return 0.95;
  // A la mitad de un nombre solo cuenta con búsquedas largas: si no, "nwa" encontraría "VanWarmer".
  if (qCompact.length >= 5 && fCompact.includes(qCompact)) return 0.75;
  const max = allowedTypos(qCompact.length);
  if (!max) return 0;
  const d = Math.min(
    editDistance(qCompact, fCompact, max),
    fCompact.length > qCompact.length ? editDistance(qCompact, fCompact.slice(0, qCompact.length), max) : max + 1,
  );
  return d <= max ? 0.6 - d * 0.15 : 0;
}

/**
 * Puntaje de un elemento para una búsqueda. 0 = no coincide.
 * Todas las palabras buscadas deben aparecer en algún campo (o la búsqueda entera, junta, en un campo).
 */
/** Los textos de la biblioteca se preparan una sola vez (en el servidor se busca en miles en cada letra). */
const preparados = new Map<string, { words: string[]; norm: string; compact: string }>();
function preparar(text: string) {
  let p = preparados.get(text);
  if (!p) {
    const norm = normalize(text);
    p = { words: tokenize(text), norm, compact: norm.replace(/ /g, '') };
    if (preparados.size > 50_000) preparados.clear();
    preparados.set(text, p);
  }
  return p;
}

/**
 * Recuerdo de la búsqueda en curso: en miles de canciones se repiten las mismas palabras (el artista, el
 * álbum), así que cada comparación palabra-buscada × palabra-del-texto se calcula una sola vez por búsqueda.
 */
let memoQuery = '';
// palabra buscada → (palabra del texto → puntaje). El puntaje de dos palabras no cambia nunca, así que se guarda
// entre búsquedas: al escribir "carpenters rainy", "carpenters" ya viene calculada de la letra anterior.
let memoPalabra = new Map<string, Map<string, number>>();
let memoCompacto = new Map<string, number>();
function recordar(query: string) {
  if (query === memoQuery) return;
  memoQuery = query;
  if (memoPalabra.size > 60) memoPalabra = new Map();
  memoCompacto = new Map();
}
function wordScoreMemo(m: Map<string, number>, q: string, w: string) {
  let s = m.get(w);
  if (s === undefined) m.set(w, (s = wordScore(q, w)));
  return s;
}
function memoDe(q: string) {
  let m = memoPalabra.get(q);
  if (!m) memoPalabra.set(q, (m = new Map()));
  return m;
}

/** El sonido de cada palabra de la biblioteca se calcula una vez (son siempre las mismas). */
const sonidos = new Map<string, string>();
function phoneticMemo(w: string) {
  let p = sonidos.get(w);
  if (p === undefined) {
    if (sonidos.size > 200_000) sonidos.clear();
    sonidos.set(w, (p = phonetic(w)));
  }
  return p;
}
function compactScoreMemo(q: string, f: string) {
  let s = memoCompacto.get(f);
  if (s === undefined) memoCompacto.set(f, (s = compactScore(q, f)));
  return s;
}

export function fuzzyScore(query: string, fields: SearchField[]): number {
  const qWords = tokenize(query);
  if (!qWords.length) return 0;
  recordar(qWords.join(' '));
  const fWords = fields.map((f) => {
    const p = preparar(f.text);
    return { words: p.words, norm: p.norm, compact: p.compact, weight: f.weight };
  });

  const qCompact = qWords.join('');
  let compact = 0;
  for (const f of fWords) compact = Math.max(compact, compactScoreMemo(qCompact, f.compact) * f.weight);

  let total = 0;
  for (const q of qWords) {
    let best = 0;
    const m = memoDe(q);
    for (const f of fWords) {
      for (const w of f.words) {
        const s = wordScoreMemo(m, q, w) * f.weight;
        if (s > best) best = s;
      }
    }
    if (best === 0) {
      total = -1;
      break;
    }
    total += best;
  }
  let score = total < 0 ? 0 : total / qWords.length;
  score = Math.max(score, compact);
  if (score === 0) return 0;

  // Bonus si la frase completa coincide tal cual con el comienzo de un campo.
  const qNorm = qWords.join(' ');
  for (const f of fWords) {
    if (f.norm === qNorm) score += 0.5 * f.weight;
    else if (f.norm.startsWith(qNorm)) score += 0.3 * f.weight;
  }
  return score;
}

/**
 * Índice de una lista (como el de un libro, o el de Google): cada palabra distinta → en qué elementos aparece.
 * Así una búsqueda revisa las ~30 000 palabras distintas una vez, en vez de las palabras de cada canción, y
 * después solo puntúa los elementos que pueden coincidir.
 */
export interface IndiceBusqueda {
  palabras: Map<string, number[]>;
  compactos: Map<string, number[]>;
  /** Las mismas claves en orden alfabético: lo que empieza con "carpe" queda todo junto (búsqueda binaria). */
  palabrasOrden: string[];
  compactosOrden: string[];
}

function anotar(m: Map<string, number[]>, k: string, i: number) {
  const l = m.get(k);
  if (!l) m.set(k, [i]);
  else if (l[l.length - 1] !== i) l.push(i);
}

export function crearIndice(campos: SearchField[][]): IndiceBusqueda {
  const palabras = new Map<string, number[]>();
  const compactos = new Map<string, number[]>();
  campos.forEach((fs, i) => {
    for (const f of fs) {
      const p = preparar(f.text);
      for (const w of p.words) anotar(palabras, w, i);
      if (p.compact) anotar(compactos, p.compact, i);
    }
  });
  const ordenar = (m: Map<string, number[]>) => [...m.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { palabras, compactos, palabrasOrden: ordenar(palabras), compactosOrden: ordenar(compactos) };
}

/** Cada clave que empieza con `pre`, sacada del arreglo ordenado sin recorrerlo entero. */
function* conPrefijo(orden: string[], pre: string) {
  let lo = 0;
  let hi = orden.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (orden[mid] < pre) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < orden.length && orden[i].startsWith(pre); i++) yield orden[i];
}

/**
 * Los elementos que `exactMatch` acepta (ni uno más, ni uno menos), en orden: cada palabra buscada es el
 * comienzo de alguna palabra del elemento, o la búsqueda junta es el comienzo de un campo. Sin errores de
 * tipeo, así que no calcula distancias: es lo que hace instantáneo al buscador mientras escribes.
 */
export function candidatosExactos(ind: IndiceBusqueda, query: string): number[] {
  const qWords = tokenize(query);
  if (!qWords.length) return [];
  let todas: Set<number> | null = null;
  for (const q of [...new Set(qWords)].sort((a, b) => b.length - a.length)) {
    const con = new Set<number>();
    for (const w of conPrefijo(ind.palabrasOrden, q)) {
      for (const i of ind.palabras.get(w)!) if (!todas || todas.has(i)) con.add(i);
    }
    todas = con;
    if (!todas.size) break;
  }
  const out = todas ?? new Set<number>();
  const qCompact = qWords.join('');
  if (qCompact.length >= 3) for (const c of conPrefijo(ind.compactosOrden, qCompact)) for (const i of ind.compactos.get(c)!) out.add(i);
  return [...out].sort((a, b) => a - b);
}

/**
 * Los elementos que `fuzzyScore` puntuaría con más de 0 (ni uno más, ni uno menos), en orden. Sigue la misma
 * regla: cada palabra buscada coincide con alguna palabra del elemento, o la búsqueda junta coincide con un campo.
 */
export function candidatos(ind: IndiceBusqueda, query: string): number[] {
  const qWords = tokenize(query);
  if (!qWords.length) return [];
  recordar(qWords.join(' '));
  let todas: Set<number> | null = null;
  // Las palabras más largas primero: suelen coincidir con menos elementos y achican antes la intersección.
  for (const q of [...new Set(qWords)].sort((a, b) => b.length - a.length)) {
    const m = memoDe(q);
    const con = new Set<number>();
    for (const [w, ids] of ind.palabras) {
      if (wordScoreMemo(m, q, w) <= 0) continue;
      if (todas) {
        for (const i of ids) if (todas.has(i)) con.add(i);
      } else for (const i of ids) con.add(i);
    }
    todas = con;
    if (!todas.size) break;
  }
  const out = todas ?? new Set<number>();
  const qCompact = qWords.join('');
  if (qCompact.length >= 3) for (const [c, ids] of ind.compactos) if (compactScoreMemo(qCompact, c) > 0) for (const i of ids) out.add(i);
  return [...out].sort((a, b) => a - b);
}

/** Filtra y ordena una lista por relevancia. */
export function fuzzySearch<T>(query: string, items: T[], fields: (item: T) => SearchField[], limit = 50): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, fields(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}

/**
 * ¿Coincide SIN adivinar? Cada palabra buscada tiene que estar tal cual (o ser el comienzo de una palabra) en
 * algún campo: "abba" coincide con "ABBA" y "abb" con "ABBA", pero no con "Gabba" ni con "Alba".
 * También vale todo junto: "acdc" con "AC/DC". Se usa para que, si hay resultados exactos, no se mezclen con
 * parecidos; los parecidos (errores de tipeo) solo aparecen cuando no hay ninguno exacto.
 */
export function exactMatch(query: string, fields: SearchField[]): boolean {
  const qWords = tokenize(query);
  if (!qWords.length) return false;
  const fs = fields.map((f) => preparar(f.text));
  const qCompact = qWords.join('');
  if (qCompact.length >= 3 && fs.some((f) => f.compact.startsWith(qCompact))) return true;
  return qWords.every((q) => fs.some((f) => f.words.some((w) => w.startsWith(q))));
}
