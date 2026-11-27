// Emparejar una canción de afuera (Spotify) con una del catálogo del servidor.
//
// Es la misma si:
//   - algún artista coincide (el de Spotify está dentro del artista del catálogo, o al revés: así
//     "Daft Punk" calza con "Daft Punk & Pharrell" y "Tyler, The Creator" con "Tyler, The Creator");
//   - y el título coincide: igual, o igual sin lo de paréntesis / después de " - " ("Lady (Hear Me Tonight)",
//     "Song - Remastered 2011", "Lady Marmalade - Single Edit" = "Lady Marmalade (con Lil' Kim…)"). En ese
//     segundo caso las dos tienen que ser del mismo tipo (un remix, en vivo, acústica o instrumental no calza con
//     la original) y la duración parecida: hasta 1 minuto de diferencia. Más que eso es otra versión (una
//     extendida de 7 minutos no es el single de 4).
// Si hay varias, gana la de duración más parecida.

import { normal } from './repetidas.js';

/** Palabras que hacen de una canción otra versión. */
// "super slowed" va antes que "slowed": son versiones distintas (otra velocidad).
const VERSION = /\b(remix|mix|live|en vivo|directo|acoustic|acustic[ao]|instrumental|karaoke|sped up|super slowed|slowed|nightcore|cover|version|edit|rework|bootleg|mashup|demo)\b/;
/**
 * Lo que Spotify agrega y no cambia la canción: remasterizada, mono, "Single Edit", "Radio Edit", "Album Version",
 * "Original Version"… Un edit con nombre ("halo edit", "VIP edit") sí es otra versión.
 * "(Single Version)" y "(Extended Version)" también los pone el bot cuando ya hay una canción con el mismo nombre y
 * otra duración: ahí decide la duración (la más parecida a la de Spotify).
 */
const RELLENO = /\b(remaster(ed)?|remasterizad[ao]|\d{4} remaster(ed)?|mono|stereo|(single|album|radio|original|short|clean|explicit|extended) (version|edit|mix)|explicit|clean)\b/g;
/** Diferencia máxima de duración, en segundos, cuando el título solo calza sin los extras. */
const MARGEN_BASE = 60;

const sinExtras = (t) =>
  String(t ?? '')
    .replace(/\s*[([][^)\]]*[)\]]/g, ' ') // (feat. …), [Remastered], (From "…")
    .replace(/\s+-\s+.*$/, '') // "Canción - Remastered 2011"
    .trim();

/** Tipo de versión ("remix", "live"…) que dice el título, sin lo que es solo relleno; '' si es la original. */
const tipoVersion = (t) => {
  const n = normal(t).replace(RELLENO, ' ');
  const m = n.match(VERSION);
  return m ? m[1].replace(/^(en vivo|directo)$/, 'live').replace(/^acustic[ao]$/, 'acoustic') : '';
};

/** Artistas del catálogo en pedazos (además del nombre entero), para comparar. */
const piezas = (a) =>
  String(a ?? '')
    .split(/,|&|;|\/|\+|\b(?:feat|ft|featuring|con|with|vs)\b\.?|\sx\s/i)
    .map(normal)
    .filter((p) => p.length >= 2);

/** ¿El texto `chico` está entero (palabras completas) dentro de `grande`? */
const contiene = (grande, chico) => !!chico && (` ${grande} `).includes(` ${chico} `);

function artistaCalza(artistasFuera, artistaCatalogo) {
  const entero = normal(artistaCatalogo);
  const partes = piezas(artistaCatalogo);
  const todosFuera = normal(artistasFuera.join(' '));
  for (const af of artistasFuera) {
    const n = normal(af);
    if (n.length < 2) continue;
    if (contiene(entero, n)) return true;
    if (partes.some((p) => p === n)) return true;
  }
  // El artista del catálogo entero dentro de la lista de Spotify ("Tyler, The Creator" partido en dos).
  return entero.length >= 3 && contiene(todosFuera, entero);
}

/**
 * Prepara el catálogo para buscar rápido: índice por título normalizado y por título sin extras.
 * @param {{id:string, titulo:string, artista:string, duracion:number}[]} catalogo
 */
export function indiceCatalogo(catalogo) {
  const porTitulo = new Map();
  const porBase = new Map();
  const porCompacto = new Map();
  const porArtista = new Map();
  const poner = (m, k, c) => {
    if (!k) return;
    const l = m.get(k);
    if (l) l.push(c);
    else m.set(k, [c]);
  };
  for (const c of catalogo) {
    const x = { ...c, _version: tipoVersion(c.titulo), _compacto: compacto(c.titulo) };
    poner(porTitulo, normal(c.titulo), x);
    poner(porBase, normal(sinExtras(c.titulo)), x);
    poner(porCompacto, x._compacto, x);
    for (const a of new Set([normal(c.artista), ...piezas(c.artista)])) poner(porArtista, a, x);
  }
  return { porTitulo, porBase, porCompacto, porArtista };
}

/**
 * Título sin extras, pegado y sin la "g" final de -ing: "Rain Drops Keep Falling on My Head" y
 * "Raindrops Keep Fallin' On My Head" dan lo mismo ("raindropskeepfallinonmyhead").
 */
function compacto(t) {
  return normal(sinExtras(t))
    .replace(/(\p{L})ing\b/gu, '$1in')
    .replace(/\s+/g, '');
}

/** Distancia de edición (letras que cambian), cortando si pasa de `tope`. */
function distancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      menor = Math.min(menor, fila[j]);
    }
    if (menor > tope) return tope + 1;
    previa = fila;
  }
  return previa[b.length];
}
/** Diferencia de duración máxima cuando el título solo se parece (un error de tipeo): más estricta. */
const MARGEN_PARECIDO = 15;

/**
 * La canción del catálogo que es esta de afuera, o null.
 * @param {{titulo:string, artistas:string[], duracion:number|null}} fuera
 * @param {ReturnType<typeof indiceCatalogo>} indice
 */
export function emparejar(fuera, indice) {
  const durar = (c) => (fuera.duracion && c.duracion ? Math.abs(c.duracion - fuera.duracion) : 0);
  const mejor = (l) => (l.length ? l.reduce((a, b) => (durar(b) < durar(a) ? b : a)) : null);
  // 1) Mismo título exacto (normalizado) y un artista en común.
  const exactas = (indice.porTitulo.get(normal(fuera.titulo)) ?? []).filter((c) => artistaCalza(fuera.artistas, c.artista));
  // Un título igual con duración muy distinta (otra canción con el mismo nombre) no vale.
  const buenas = exactas.filter((c) => !fuera.duracion || !c.duracion || durar(c) <= 60);
  if (buenas.length) return mejor(buenas);
  // 2) Mismo título sin extras, mismo tipo de versión y duración parecida.
  const base = normal(sinExtras(fuera.titulo));
  if (!base) return null;
  const v = tipoVersion(fuera.titulo);
  const parecidas = (indice.porBase.get(base) ?? []).filter(
    (c) => c._version === v && artistaCalza(fuera.artistas, c.artista) && (!fuera.duracion || !c.duracion || durar(c) <= MARGEN_BASE),
  );
  if (parecidas.length) return mejor(parecidas);
  // 3) Escrito distinto: palabras juntas o separadas, "Falling" / "Fallin'" ("Rain Drops Keep Falling on My Head").
  const comp = compacto(fuera.titulo);
  if (comp.length < 4) return null;
  const pegadas = (indice.porCompacto.get(comp) ?? []).filter(
    (c) => c._version === v && artistaCalza(fuera.artistas, c.artista) && (!fuera.duracion || !c.duracion || durar(c) <= MARGEN_BASE),
  );
  if (pegadas.length) return mejor(pegadas);
  // 4) Un error de tipeo (1 letra cada 10, mín. 1) entre canciones del mismo artista, solo si se sabe la duración
  //    y es casi la misma.
  if (!fuera.duracion || comp.length < 6) return null;
  const tope = Math.max(1, Math.floor(comp.length / 10));
  const delArtista = new Set(fuera.artistas.flatMap((a) => indice.porArtista.get(normal(a)) ?? []));
  const tipeo = [...delArtista].filter(
    (c) => c._version === v && c.duracion && durar(c) <= MARGEN_PARECIDO && distancia(comp, c._compacto, tope) <= tope,
  );
  return mejor(tipeo);
}
