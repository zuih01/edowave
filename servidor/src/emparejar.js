// Emparejar una canción de afuera (Spotify) con una del catálogo del servidor.
//
// Es la misma si:
//   - algún artista coincide (el de Spotify está dentro del artista del catálogo, o al revés: así
//     "Daft Punk" calza con "Daft Punk & Pharrell" y "Tyler, The Creator" con "Tyler, The Creator");
//   - y el título coincide: igual, o igual sin lo de paréntesis / después de " - " ("Lady (Hear Me Tonight)",
//     "Song - Remastered 2011"). En ese segundo caso la duración tiene que ser parecida (±15 s) y las dos
//     tienen que ser del mismo tipo: un remix, en vivo, acústica o instrumental no calza con la original.
// Si hay varias, gana la de duración más parecida.

import { normal } from './repetidas.js';

/** Palabras que hacen de una canción otra versión. */
const VERSION = /\b(remix|mix|live|en vivo|directo|acoustic|acustic[ao]|instrumental|karaoke|sped up|slowed|nightcore|cover|version|edit|rework|bootleg|mashup|demo)\b/;
/** Lo que Spotify agrega y no cambia la canción. */
const RELLENO = /\b(remaster(ed)?|remasterizad[ao]|\d{4} remaster(ed)?|mono|stereo|single version|album version|original mix|radio edit|explicit|clean)\b/g;

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
  const poner = (m, k, c) => {
    if (!k) return;
    const l = m.get(k);
    if (l) l.push(c);
    else m.set(k, [c]);
  };
  for (const c of catalogo) {
    const x = { ...c, _version: tipoVersion(c.titulo) };
    poner(porTitulo, normal(c.titulo), x);
    poner(porBase, normal(sinExtras(c.titulo)), x);
  }
  return { porTitulo, porBase };
}

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
    (c) => c._version === v && artistaCalza(fuera.artistas, c.artista) && (!fuera.duracion || !c.duracion || durar(c) <= 15),
  );
  return mejor(parecidas);
}
