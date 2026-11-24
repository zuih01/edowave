// Año ORIGINAL de cada canción: el de su primera salida, no el del compilado o la reedición de donde vino el
// archivo ("Toni Basil – Hey Mickey" venía de una reedición de 2012 y es de 1982). Con el año bien, la radio
// respeta la época de verdad.
//
// Cómo: busca en MusicBrainz todas las grabaciones de esa canción (mismo artista y mismo título, sin
// "(Remastered 2009)" y similares) y se queda con la fecha de salida MÁS ANTIGUA. Solo baja el año (nunca lo sube)
// y no toca versiones distintas: remix, en vivo, acústica, "(Taylor's Version)"… (esas son de su propio año).
// Corre de a una (MusicBrainz permite 1 consulta por segundo) para toda la biblioteca y después, solas,
// para las que se suban.
import { db } from '../db.js';
import { mismoArtista, mismoTitulo, normalizar, separarArtistas, tituloParaBuscar } from './completar.js';
import { buscarGrabacionesAmplio, SinConexion } from './musicbrainz.js';

/** Paréntesis que NO cambian la canción (es la misma grabación, otra edición). */
const MISMA = /\b(remaster(ed)?|single|radio edit|edit|mono|stereo|album version|original mix|\d{2}"|7"|12"|extended|version \d{4}|\d{4} version|\d{4} mix|bonus track|deluxe)\b/i;
/** ¿Es otra versión (remix, en vivo, re-grabación)? Esas conservan su propio año. */
function otraVersion(titulo) {
  const partes = String(titulo).match(/[([][^)\]]*[)\]]|\s-\s.+$/g) ?? [];
  return partes.some((p) => !MISMA.test(p));
}

const anio = (fecha) => {
  const a = Number(String(fecha ?? '').slice(0, 4));
  return a > 1900 && a <= new Date().getFullYear() + 1 ? a : null;
};

/** El año más antiguo en que salió esta canción (o null si MusicBrainz no la tiene). */
export async function anioOriginalDe(artista, titulo) {
  if (otraVersion(titulo)) return null;
  const base = tituloParaBuscar(titulo);
  const principal = separarArtistas(artista)[0] ?? artista;
  let mejor = null;
  for (const quien of [...new Set([artista, principal])]) {
    const anios = [];
    const grabaciones = await buscarGrabacionesAmplio(base, quien);
    for (const g of grabaciones) {
      if ((g.score ?? 0) < 65) continue;
      if (!tituloCalza(g.title, base) || !mismoArtista(principal, g['artist-credit'])) continue;
      // Versiones distintas o mezclas de DJ no cuentan (pueden ser de otro año).
      if (otraVersion(g.title) || /\b(live|en vivo|remix|acoustic|ac[uú]stico|demo|instrumental|karaoke|cover)\b|dj\W?mix/i.test(g.disambiguation ?? '')) continue;
      const a = anio(g['first-release-date']);
      if (a) anios.push(a);
    }
    mejor = masAntiguoConfirmado(anios);
    if (mejor) break;
  }
  return mejor;
}

/**
 * El año más antiguo que esté RESPALDADO por al menos 2 grabaciones (ese año o el siguiente): MusicBrainz a veces
 * tiene una grabación con la fecha mal puesta ("Love Will Keep Us Alive" figura en 1976 y es de 1994). Si hay
 * una sola grabación, se usa esa.
 */
function masAntiguoConfirmado(anios) {
  if (anios.length <= 1) return anios[0] ?? null;
  const a = [...anios].sort((x, y) => x - y);
  return a.find((y) => a.filter((z) => z <= y + 1).length >= 2) ?? null;
}

/** El título es el mismo, o uno contiene al otro como palabras enteras ("Mickey" ↔ "Hey Mickey"). */
function tituloCalza(suyo, nuestro) {
  if (mismoTitulo(suyo, nuestro)) return true;
  const a = ` ${normalizar(tituloParaBuscar(suyo))} `;
  const b = ` ${normalizar(nuestro)} `;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  // El corto tiene que ser buena parte del largo: "Love" no calza con "Love Will Keep Us Alive".
  return corto.trim().length >= 4 && corto.trim().length >= 0.5 * largo.trim().length && largo.includes(corto);
}

let log = console;
let corriendo = false;

async function procesar() {
  if (corriendo) return;
  corriendo = true;
  try {
    for (;;) {
      const r = await db.query(`SELECT id, artista, titulo, anio FROM canciones WHERE anio_revisado IS NULL ORDER BY subida DESC LIMIT 1`);
      const c = r.rows[0];
      if (!c) break;
      let original = null;
      try {
        original = await anioOriginalDe(c.artista, c.titulo);
      } catch (e) {
        if (e instanceof SinConexion) {
          log.warn('año original: sin conexión con MusicBrainz, se reintenta en un rato');
          return;
        }
        log.warn({ cancion: c.id, err: e.message }, 'año original: error');
      }
      // Solo se corrige hacia atrás (el de un compilado siempre es posterior al original).
      const nuevo = original && (!c.anio || original < c.anio) ? original : c.anio;
      await db.query(`UPDATE canciones SET anio = $2, anio_revisado = now() WHERE id = $1`, [c.id, nuevo]);
      if (nuevo !== c.anio) log.info({ cancion: `${c.artista} – ${c.titulo}`, antes: c.anio, ahora: nuevo }, 'año original corregido');
    }
  } finally {
    corriendo = false;
  }
}

export function iniciarAnioOriginal(logger) {
  log = logger;
  setTimeout(() => void procesar(), 40_000);
  setInterval(() => void procesar(), 10 * 60_000).unref();
}

export const avisarAnioOriginal = () => void procesar();

// (para pruebas desde la terminal)
export const _normalizar = normalizar;
