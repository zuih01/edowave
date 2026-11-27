// Reglas para saber si una canción ya está en el servidor (las usan la subida y src/duplicados.js).
//
// Es la MISMA canción si es el mismo artista y el mismo título, aunque cambie el álbum o la duración.
//   - El artista se compara por sus integrantes, sin importar cómo se separen ni el orden:
//     "ZXKAI, slxughter" = "ZXKAI y slxughter" = "slxughter & ZXKAI". Una colaboración con otra persona es otro
//     artista ("Tame Impala" ≠ "Tame Impala, JENNIE").
//   - Quien va invitado en el título cuenta como artista, se escriba como se escriba: "Tame Impala – Dracula (con
//     JENNIE)" = "Tame Impala, JENNIE – Dracula (with JENNIE)" = "Tame Impala – Dracula feat. JENNIE". Pero sigue
//     siendo otra canción que "Tame Impala – Dracula" a secas (otros integrantes).
//   - El resto del título se compara entero: "Song (Remix)", "Song - Live" son otras versiones de "Song" y nunca se
//     tocan. Dos copias de la MISMA versión ("Song (Remix)" dos veces) sí son repetidas.
//   - También cuenta el mismo título con un número de copia al final ("Thriller1", "Thriller 2", "Thriller (1)")
//     o con una letra de diferencia (error de tipeo), siempre que dure casi lo mismo.
// Excepciones (dos canciones distintas con el mismo nombre):
//   - En el MISMO álbum, con duraciones distintas, si el título cambia en un signo ("In the Flesh?" / "In the Flesh")
//     o son pistas distintas.
//   - Títulos genéricos ("Intro", "Outro", "Interlude", "Skit"…): solo son la misma si duran casi lo mismo.

/** Minúsculas, sin tildes ni signos, espacios simples. */
export const normal = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Minúsculas y sin tildes, pero con los signos ("in the flesh?" ≠ "in the flesh"). */
const crudo = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** "(1)", "[2]": un número solo entre paréntesis es una copia, no otra versión. */
const COPIA_NUMERO = /\s*[([]\s*\d{1,2}\s*[)\]]\s*$/;
/** Número pegado o separado al final ("Thriller1", "Thriller 2", "Thriller_3"). */
const NUMERO_FINAL = /[\s_-]*\d{1,2}$/;
/** Separadores entre artistas: "A, B", "A & B", "A y B", "A x B", "A feat. B"… */
const SEPARA_ARTISTAS = /\s*(?:[,;/+&]|\s(?:y|e|and|x|con|with|feat\.?|ft\.?|featuring|vs\.?)\s)\s*/;
/** Títulos que muchos álbumes repiten sin ser la misma canción. */
const GENERICO = /^(intro|outro|interlude|interludio|skit|prelude|preludio|untitled|sin titulo|bonus track|hidden track|track \d+|pista \d+)$/;

/** Título sin la marca de copia del final. */
const sinCopia = (titulo) => String(titulo ?? '').replace(COPIA_NUMERO, '').trim();

/** Integrantes del artista, ordenados: "ZXKAI, slxughter" y "slxughter y ZXKAI" dan lo mismo. */
export function claveArtista(artista) {
  const partes = crudo(artista).split(SEPARA_ARTISTAS).map(normal).filter(Boolean);
  return [...new Set(partes)].sort().join(' + ');
}

/** Invitados en el título: "(con X)", "(with X)", "[feat. X]", "(ft. X y Z)". */
const INVITADOS = /\s*[([]\s*(?:con|with|feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]/gi;
/** Invitados sueltos al final: "Song feat. X", "Song ft. X". */
const INVITADOS_FINAL = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i;

/**
 * Clave "artista|título" para comparar (null si falta alguno de los dos). Los invitados del título pasan al
 * artista: "Tame Impala – Dracula (con JENNIE)" y "Tame Impala, JENNIE – Dracula (with JENNIE)" dan la misma.
 */
export function claveRepetida(artista, titulo) {
  const invitados = [];
  const limpio = sinCopia(titulo)
    .replace(INVITADOS, (_, x) => {
      invitados.push(x);
      return ' ';
    })
    .replace(INVITADOS_FINAL, (_, x) => {
      invitados.push(x);
      return '';
    });
  const a = claveArtista([artista, ...invitados].join(', '));
  const t = normal(limpio);
  return a && t ? `${a}|${t}` : null;
}

/**
 * Índice en memoria de todo el catálogo por clave, para revisar repetidas sin leer la base en cada subida.
 * Se arma una vez y se actualiza al subir; si algo cambia por otro lado (editar, borrar), se descarta con
 * `olvidarIndice()` y se rearma en la próxima consulta.
 */
let indice = null;
let armado = 0;
/** Además de olvidarlo a mano, se rearma solo cada 10 minutos (por cambios que lleguen por otro lado). */
const VIDA_INDICE = 10 * 60_000;
export function olvidarIndice() {
  indice = null;
}
export async function indiceRepetidas(cargar) {
  if (indice && Date.now() - armado < VIDA_INDICE) return indice;
  const filas = await cargar();
  const nuevo = { porClave: new Map(), porBase: new Map(), artistas: new Set() };
  for (const c of filas) agregarAlIndice(c, nuevo);
  indice = nuevo;
  armado = Date.now();
  return indice;
}
export function agregarAlIndice(c, i = indice) {
  if (!i) return;
  const k = claveRepetida(c.artista, c.titulo);
  if (k) {
    const l = i.porClave.get(k);
    if (l) l.push(c);
    else i.porClave.set(k, [c]);
  }
  const b = tituloBase(c.titulo);
  if (b) {
    i.porBase ??= new Map();
    const l = i.porBase.get(b);
    if (l) l.push(c);
    else i.porBase.set(b, [c]);
  }
  for (const a of claveArtista(c.artista).split(' + ')) if (a) i.artistas.add(a);
}

/** Palabras que hacen de una canción otra versión (nunca se junta una de estas con la original). */
const VERSION = /\b(remix|rmx|mix|live|en vivo|directo|unplugged|acoustic|acustic[ao]|instrumental|karaoke|a ?capp?ella|sped up|super slowed|slowed|nightcore|cover|demo|extended|reverb|8d|mashup|bootleg|vip|edit|version|ver|credits|end title|chinese|japanese|english|spanish|korean|espanol|portugues)\b/;
/** Lo que no cambia la grabación: remasterizada, mono, "Radio Edit", "Single Version", "Album Version"… */
const RELLENO =
  /\b(\d{4} )?remaster(ed|izad[ao])?( \d{4})?\b|\bmono\b|\bstereo\b|\b(single|album|radio|original|short|explicit) (version|edit|mix|v)\b|\bexplicit( ver(sion)?)?\b|\b(official )?(audio|video|music video|lyric video|lyrics? video|lyrics?|visualizer|visualiser|animated music video|mv|m v)\b/g;
/**
 * Lo que dice el título fuera del nombre: paréntesis, corchetes y lo que va después de " - ", sin invitados
 * ("con X", "feat. X"), sin "From …" (de qué película es) y sin relleno. "Song (Rough Mix)" → "rough mix";
 * "Song (Remastered 2009)" → "". Dos casi iguales tienen que decir lo mismo aquí.
 */
export function extrasTitulo(t) {
  const s = sinCopia(t);
  const partes = [...s.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const tras = s.replace(/\s*[([][^)\]]*[)\]]/g, ' ').match(/\s+-\s+(.*)$/);
  if (tras) partes.push(...tras[1].split(/\s+-\s+/));
  return partes
    .filter((p) => !/^\s*(con|with|feat\.?|ft\.?|featuring|from)\b/i.test(p))
    .map((p) => normal(p).replace(RELLENO, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .sort()
    .join(' | ');
}
/** Título sin paréntesis, corchetes ni lo que va después de " - " ("Song (feat. X) - Radio Edit" → "song"). */
export const tituloBase = (t) =>
  normal(
    sinCopia(t)
      .replace(/\s*[([][^)\]]*[)\]]/g, ' ')
      .replace(/\s+-\s+.*$/, '')
      .replace(INVITADOS_FINAL, ''),
  );
/** Tipo de versión según TODO el título (también lo de paréntesis y después de " - "); '' si es la original. */
export const tipoVersion = (t) =>
  normal(t)
    .replace(RELLENO, ' ')
    .match(VERSION)?.[1]
    ?.replace('rmx', 'remix')
    .replace('en vivo', 'live')
    .replace(/^acustic[ao]$/, 'acoustic')
    .replace(/^ver$/, 'version') ?? '';
/**
 * Integrantes (artista + invitados del título), cada uno con sus nombres posibles: "BTS (방탄소년단)" vale como
 * "bts (방탄소년단)", "bts" y "방탄소년단"; "정국 (Jung Kook)" como "정국" y "jung kook".
 */
const integrantes = (artista, titulo) => {
  const invitados = [];
  sinCopia(titulo)
    .replace(INVITADOS, (_, x) => invitados.push(x))
    .replace(INVITADOS_FINAL, (_, x) => invitados.push(x));
  return crudo([artista, ...invitados].join(', '))
    .split(SEPARA_ARTISTAS)
    .map((p) => {
      const fuera = p.replace(/\s*[([][^)\]]*[)\]]/g, ' ');
      const dentro = [...p.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
      return [...new Set([p, fuera, ...dentro].map(normal).filter((x) => x.length >= 2))];
    })
    .filter((v) => v.length);
};
/** Mismo integrante: algún nombre igual, o uno dentro del otro con palabras completas ("pharrell" / "pharrell williams"). */
const mismoNombre = (x, y) => x === y || (Math.min(x.length, y.length) >= 4 && (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `)));
const mismoIntegrante = (xs, ys) => xs.some((x) => ys.some((y) => mismoNombre(x, y)));
/**
 * ¿Son los mismos integrantes? Cada uno de un lado tiene su par en el otro. Así "Dua Lipa" ≠ "Dua Lipa con DaBaby"
 * (otra grabación) y "Roupa Nova" ≠ "Gal Costa con Roupa Nova", pero "Tyler, The Creator con Pharrell" =
 * "Tyler, The Creator, Pharrell Williams".
 */
const compartenArtista = (a, b) => a.length > 0 && b.length > 0 && a.every((x) => b.some((y) => mismoIntegrante(x, y))) && b.every((y) => a.some((x) => mismoIntegrante(x, y)));
/** Diferencia de duración máxima para juntar dos canciones que solo se parecen (no tienen la misma clave). */
export const MARGEN_PARECIDA = 3;

/**
 * Casi idénticas: mismo título base, mismo tipo de versión, un artista en común y duración a ±3 s.
 * Atrapa "Tyler, The Creator – IFHY (feat. Pharrell)" = "Tyler, The Creator – IFHY (con Pharrell Williams)" o
 * "Song - Radio Edit" = "Song (Single Version)", sin juntar un remix, una en vivo o una canción distinta.
 */
export function casiIgual(a, b) {
  if (!a.duracion || !b.duracion || Math.abs(Number(a.duracion) - Number(b.duracion)) > MARGEN_PARECIDA) return false;
  if (!tituloBase(a.titulo) || tituloBase(a.titulo) !== tituloBase(b.titulo)) return false;
  if (tipoVersion(a.titulo) !== tipoVersion(b.titulo)) return false;
  const ea = partesExtras(a.titulo);
  const eb = partesExtras(b.titulo);
  // "(Spider-Man: Into the Spider-Verse)" = "(From "Spider-Man: Into the Spider-Verse")": de qué película es no cambia nada.
  const desde = new Set([...ea.desde, ...eb.desde]);
  const quedan = (e) => e.partes.filter((p) => !desde.has(p)).sort().join(' | ');
  if (quedan(ea) !== quedan(eb)) return false;
  // El remezclador puede venir como artista ("Alan Walker, Marshmello – … - Marshmello Remix"): no cuenta como invitado.
  const textoExtras = ` ${[...ea.partes, ...eb.partes].join(' ')} `;
  const sinRemezclador = (l) => l.filter((nombres) => !nombres.some((n) => n.length >= 3 && textoExtras.includes(` ${n} `)));
  const ia = integrantes(a.artista, a.titulo);
  const ib = integrantes(b.artista, b.titulo);
  if (compartenArtista(ia, ib) || compartenArtista(sinRemezclador(ia), sinRemezclador(ib))) return true;
  // Las dos ya son colaboraciones y una solo nombra a más gente (productor, toda la banda): es la misma grabación.
  // "Dua Lipa" vs "Dua Lipa con DaBaby" NO entra: una de las dos es solista (otra versión, como Dracula / Dracula con JENNIE).
  const contenida = (chica, grande) => chica.every((x) => grande.some((y) => mismoIntegrante(x, y)));
  return ia.length >= 2 && ib.length >= 2 && (contenida(ia, ib) || contenida(ib, ia));
}

/**
 * Lo de los paréntesis y después de " - ", partido: `partes` (sin invitados ni relleno, y sin lo que es solo una
 * traducción en otro alfabeto, como "(연애의 조건)") y `desde` (lo que dice "From …", sin la palabra "From").
 */
function partesExtras(t) {
  const s = sinCopia(t);
  const crudas = [...s.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]);
  const tras = s.replace(/\s*[([][^)\]]*[)\]]/g, ' ').match(/\s+-\s+(.*)$/);
  if (tras) crudas.push(...tras[1].split(/\s+-\s+/));
  const partes = [];
  const desde = [];
  for (const p of crudas) {
    if (/^\s*(con|with|feat\.?|ft\.?|featuring)\b/i.test(p)) continue;
    const n = normal(p.replace(/^\s*from\s+/i, '')).replace(RELLENO, ' ').replace(/\s+/g, ' ').trim();
    if (!n || !/[a-z0-9]/.test(n)) continue; // vacío o solo otro alfabeto (traducción)
    (/^\s*from\b/i.test(p) ? desde : partes).push(n);
  }
  return { partes, desde };
}

/**
 * La canción del índice que es esta (misma clave y `mismaCancion`, o una copia "Thriller1"/tipeo del mismo artista),
 * o null.
 */
export function buscarRepetida(i, nueva) {
  const clave = claveRepetida(nueva.artista, nueva.titulo);
  if (!clave) return null;
  const iguales = (i.porClave.get(clave) ?? []).find((c) => mismaCancion(nueva, c));
  if (iguales) return iguales;
  const art = clave.split('|')[0];
  for (const [k, l] of i.porClave) {
    if (!k.startsWith(art + '|')) continue;
    if (esCopia(clave, k, nueva.duracion, l[0].duracion) || esCopia(k, clave, l[0].duracion, nueva.duracion)) return l[0];
  }
  // Casi idénticas (otro nombre para la misma grabación): ver casiIgual.
  return (i.porBase?.get(tituloBase(nueva.titulo)) ?? []).find((c) => casiIgual(nueva, c)) ?? null;
}

/**
 * Las dos lecturas posibles de un nombre de archivo sin etiquetas, partido por " - ":
 *   derecho: "Artista - Título - Versión"  → artista = primera parte, título = el resto
 *   al revés: "Título - Versión - Artista" → artista = última parte, título = el resto
 */
export function lecturasNombre(partes) {
  return {
    derecho: { artista: partes[0], titulo: partes.slice(1).join(' - ') },
    alReves: { artista: partes.at(-1), titulo: partes.slice(0, -1).join(' - ') },
  };
}

/**
 * ¿El nombre viene al revés ("Título - Artista")? Usa el catálogo (`artistas`: los conocidos):
 *   - si al revés calza con una canción que ya está (y derecho no), o
 *   - si el artista de la lectura al revés es conocido y el de la derecha no.
 * Devuelve true (al revés), false (derecho) o null (no se puede saber por el nombre).
 */
export function nombreAlReves(i, partes, duracion) {
  if (partes.length < 2) return false;
  const { derecho, alReves } = lecturasNombre(partes);
  const conocido = (x) => claveArtista(x).split(' + ').some((p) => p && i.artistas.has(p));
  if (i.porClave) {
    const r = buscarRepetida(i, { ...alReves, duracion });
    const d = buscarRepetida(i, { ...derecho, duracion });
    if (r && !d) return true;
    if (d && !r) return false;
  }
  const ka = conocido(alReves.artista);
  const kd = conocido(derecho.artista);
  if (ka && !kd) return true;
  if (kd && !ka) return false;
  return null;
}

/**
 * Costumbre de cada persona al nombrar archivos, según sus últimas subidas que sí se pudieron decidir: quien sube un
 * lote "Título - Artista" lo hace con todo el lote. Si 8 de cada 10 (y al menos 5) venían al revés, las dudosas de
 * esa persona también se dan vuelta. Se olvida a las 6 horas.
 */
const costumbres = new Map(); // persona → { alReves, derecho, hasta }
export function anotarCostumbre(persona, alReves) {
  if (persona == null) return;
  const c = costumbres.get(persona);
  const vigente = c && c.hasta > Date.now() ? c : { alReves: 0, derecho: 0 };
  vigente[alReves ? 'alReves' : 'derecho']++;
  vigente.hasta = Date.now() + 6 * 3600_000;
  costumbres.set(persona, vigente);
}
export function costumbreAlReves(persona) {
  const c = costumbres.get(persona);
  if (!c || c.hasta < Date.now()) return false;
  const n = c.alReves + c.derecho;
  return n >= 5 && c.alReves / n >= 0.8;
}

/** Orientación final de una subida sin etiquetas: { artista, titulo, invertido }. */
export function orientarNombre(i, partes, duracion, persona = null) {
  const { derecho, alReves } = lecturasNombre(partes);
  let r = nombreAlReves(i, partes, duracion);
  if (r !== null) anotarCostumbre(persona, r);
  else r = costumbreAlReves(persona);
  return r ? { ...alReves, invertido: true } : { ...derecho, invertido: false };
}

const dura = (c) => Number(c.duracion) || 0;

/**
 * Dos canciones con la misma clave: ¿son de verdad la misma? Casi siempre sí (otro álbum u otra duración da igual),
 * salvo las excepciones de arriba.
 */
export function mismaCancion(a, b) {
  const diferencia = Math.abs(dura(a) - dura(b));
  if (GENERICO.test(normal(sinCopia(a.titulo))) && diferencia > 3) return false;
  const albumA = normal(a.album);
  if (albumA && albumA === normal(b.album) && diferencia > 10) {
    if (crudo(sinCopia(a.titulo)) !== crudo(sinCopia(b.titulo))) return false; // "In the Flesh?" / "In the Flesh"
    if (a.pista && b.pista && Number(a.pista) !== Number(b.pista)) return false; // otra pista del mismo álbum
  }
  return true;
}

/** Distancia de edición (cuántas letras cambian), cortando pronto si pasa de `max`. */
function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      min = Math.min(min, cur[j]);
    }
    if (min > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * ¿La canción con clave `k` (y duración `dk`) es una copia de la de clave `otra` (duración `dO`)?
 * Mismo artista (ya viene en la clave) y: el título con un número al final, o con una letra de diferencia;
 * en los dos casos, la duración tiene que ser casi la misma (así "Love Song 2" de verdad no se confunde).
 * Dos títulos que terminan en números distintos ("Part 1" / "Part 2") nunca son copias.
 */
export function esCopia(k, otra, dk, dO) {
  const [a1, t1] = k.split('|');
  const [a2, t2] = otra.split('|');
  if (a1 !== a2 || !t1 || !t2) return false;
  if (!(Math.abs((Number(dk) || 0) - (Number(dO) || 0)) <= 3)) return false;
  const n1 = t1.match(/\d+$/)?.[0];
  const n2 = t2.match(/\d+$/)?.[0];
  if (n1 && n2 && n1 !== n2) return false;
  const base = t1.replace(NUMERO_FINAL, '').trim();
  if (base && base !== t1 && base === t2) return true; // "thriller1" → "thriller"
  return t1.length >= 5 && t2.length >= 5 && distancia(t1, t2, 1) <= 1; // "thriler" ↔ "thriller"
}
