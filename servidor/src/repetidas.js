// Reglas para saber si una canción ya está en el servidor (las usan la subida y src/duplicados.js).
//
// Es la MISMA canción si es el mismo artista y el mismo título, aunque cambie el álbum o la duración.
//   - El artista se compara por sus integrantes, sin importar cómo se separen ni el orden:
//     "ZXKAI, slxughter" = "ZXKAI y slxughter" = "slxughter & ZXKAI". Una colaboración con otra persona es otro
//     artista ("Tame Impala" ≠ "Tame Impala, JENNIE").
//   - El título se compara entero, con lo que tenga entre paréntesis: "Dracula (con JENNIE)", "Song (Remix)",
//     "Song - Live", "Song feat. X" son otras versiones de "Dracula" o "Song" y nunca se tocan. Dos copias de la
//     MISMA versión ("Song (Remix)" dos veces) sí son repetidas.
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

/** Clave "artista|título" para comparar (null si falta alguno de los dos). */
export function claveRepetida(artista, titulo) {
  const a = claveArtista(artista);
  const t = normal(sinCopia(titulo));
  return a && t ? `${a}|${t}` : null;
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
