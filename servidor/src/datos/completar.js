import { bajarImagen, buscarEnTiendas } from './tiendas.js';
import { buscarAlbumYtm } from './ytmusic.js';
import { bajarPortada, buscarAlbumes, buscarGrabaciones, leerAlbum, leerGrabacion } from './musicbrainz.js';

/**
 * Completa lo que le falta a una canción (álbum, artista del álbum, año, pista, géneros, portada) y busca sus
 * créditos en MusicBrainz. NUNCA reemplaza lo que ya venía en el archivo o lo que corregiste en el panel.
 *
 * Misma lógica que la app (src/library/enrich.ts), ahora hecha una vez en el servidor para todos.
 */

/**
 * Separa "Queen & David Bowie", "Daft Punk feat. Pharrell", "A, B" en cada artista. Ojo: también parte nombres
 * como "Earth, Wind & Fire"; por eso siempre se prueba primero el nombre completo (ver `artistasDe`).
 */
export function separarArtistas(s) {
  return [
    ...new Set(
      String(s ?? '')
        .split(/\s*(?:,|;|&|\+|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\by\b|\band\b|\bwith\b|\bvs\.?)\s*/i)
        .map((x) => x.trim())
        .filter((x) => x.length > 1),
    ),
  ];
}

/**
 * Los integrantes que corresponden a un texto de artista: si el nombre completo existe en MusicBrainz se usa
 * ese ("Earth, Wind & Fire"); si no, cada artista por separado ("Queen & David Bowie").
 * `info`: Map nombre -> { mb_artista, miembros }.
 */
export function integrantesDeTexto(texto, info) {
  const completo = info.get(String(texto ?? '').trim());
  if (completo?.mb_artista) return completo.miembros ?? [];
  return separarArtistas(texto).flatMap((n) => info.get(n)?.miembros ?? []);
}

/** Todos los nombres a consultar para un texto de artista: el completo y, si se puede partir, cada uno. */
export function artistasDe(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return [];
  return [...new Set([t, ...separarArtistas(t)])];
}

/**
 * Título para BUSCAR: sin lo que agregan YouTube y las ediciones ("(Audio)", "(Official Video)", "(Lyrics)",
 * "(Radio Edit)", "(Mini CD Single)", "[HD]", "- Remastered 2009"…). Lo que va entre paréntesis se quita
 * entero, salvo que sea todo el título.
 */
export function tituloParaBuscar(t) {
  const s = String(t ?? '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo|single|audio|video|lyric).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || String(t ?? '').trim();
}

export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Quita "(Remastered 2011)", "[Live]", " - Radio Edit"… para comparar títulos. */
const nucleo = (s) => normalizar(String(s).replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, ''));
export function mismoTitulo(a, b) {
  const x = nucleo(a), y = nucleo(b);
  return !!x && !!y && (x === y || normalizar(a) === normalizar(b));
}
/** "Queen" coincide con "Queen", y "Bad Bunny" con "Bad Bunny feat. Drake". */
export function mismoArtista(nuestro, credito) {
  if (!credito?.length) return false;
  const todo = normalizar(credito.map((c) => c.name).join(' '));
  const o = normalizar(nuestro);
  return !!o && credito.some((c) => normalizar(c.name) === o || todo.startsWith(o) || o.startsWith(normalizar(c.name)));
}

const anioDe = (fecha) => {
  const y = fecha ? parseInt(String(fecha).slice(0, 4), 10) : NaN;
  return y > 1000 ? y : null;
};
/** Los 3 géneros más votados por la comunidad. */
const generosDe = (tags) =>
  (tags ?? [])
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((t) => t.name);

/** Prioridad: álbum de estudio oficial > single/EP > recopilatorios y en vivo. */
function rangoEdicion(r) {
  const rg = r['release-group'];
  const estudio = !rg?.['secondary-types']?.length;
  const tipo = rg?.['primary-type'];
  return (r.status === 'Official' ? 0 : 10) + (tipo === 'Album' && estudio ? 0 : (tipo === 'Single' || tipo === 'EP') && estudio ? 3 : 6);
}
function rangoAlbum(g) {
  const estudio = !g['secondary-types']?.length;
  const tipo = g['primary-type'];
  return tipo === 'Album' && estudio ? 0 : (tipo === 'Single' || tipo === 'EP') && estudio ? 1 : 2;
}

// ---------------- Créditos ----------------

const ROL = {
  composer: 'Compositor', lyricist: 'Letrista', writer: 'Autor', arranger: 'Arreglos', producer: 'Productor',
  engineer: 'Ingeniería de sonido', 'audio engineer': 'Ingeniería de sonido', mix: 'Mezcla', mastering: 'Masterización',
  recording: 'Grabación', programming: 'Programación', vocal: 'Voz', performer: 'Intérprete',
  'performing orchestra': 'Orquesta', conductor: 'Director',
};
const AUTORES = new Set(['composer', 'lyricist', 'writer', 'arranger', 'librettist', 'translator']);
const INTERPRETES = new Set(['vocal', 'instrument', 'performer', 'performing orchestra', 'conductor', 'chorus master']);
function nombreRol(tipo, attrs) {
  if (tipo === 'instrument' && attrs?.length) return attrs.join(', ');
  if (tipo === 'vocal' && attrs?.length) return `Voz (${attrs.join(', ')})`;
  return ROL[tipo] ?? tipo.charAt(0).toUpperCase() + tipo.slice(1);
}
function sumar(lista, nombre, rol) {
  if (!nombre) return;
  const c = lista.find((x) => x.name === nombre);
  if (!c) lista.push({ name: nombre, roles: [rol] });
  else if (!c.roles.includes(rol)) c.roles.push(rol);
}
/** Mismo formato que usa la app en "Créditos". */
function armarCreditos(d) {
  const c = { recordingId: d.id, performers: [], writers: [], production: [] };
  for (const a of d['artist-credit'] ?? []) sumar(c.performers, a.name, 'Artista');
  for (const rel of d.relations ?? []) {
    if (rel['target-type'] === 'work') {
      for (const w of rel.work?.relations ?? []) if (w['target-type'] === 'artist' && AUTORES.has(w.type)) sumar(c.writers, w.artist?.name, nombreRol(w.type));
    } else if (rel['target-type'] === 'artist') {
      const lista = INTERPRETES.has(rel.type) ? c.performers : AUTORES.has(rel.type) ? c.writers : c.production;
      sumar(lista, rel.artist?.name, nombreRol(rel.type, rel.attributes));
    }
  }
  return c;
}

// ---------------- Completar una canción ----------------

/**
 * @param c fila de la canción (titulo, artista, album, artista_album, anio, pista, generos, duracion, portada)
 * @param guardarPortada (Buffer) => Promise<string|null>  guarda la imagen y devuelve su nombre de archivo
 * @returns {{ cambios: object, completado: string[], grabacion: string|null, creditos: object|null } | null}
 *          null = MusicBrainz no tiene esta canción
 */
export async function completarCancion(c, guardarPortada) {
  if (!c.artista || /^artista desconocido$/i.test(c.artista)) return null;

  // 1) La grabación más parecida: mismo álbum, versión de estudio y duración similar.
  const buscado = tituloParaBuscar(c.titulo);
  let encontradas = await buscarGrabaciones(buscado, c.artista);
  if (!encontradas.length && buscado !== c.titulo) encontradas = await buscarGrabaciones(c.titulo, c.artista);
  const recs = encontradas.filter(
    (r) => r.score >= 85 && mismoTitulo(r.title, c.titulo) && mismoArtista(c.artista, r['artist-credit']),
  );
  const puntaje = (r) => {
    let s = 0;
    const rels = r.releases ?? [];
    if (c.album && rels.some((x) => mismoTitulo(x['release-group']?.title ?? x.title, c.album))) s += 4;
    if (rels.some((x) => rangoEdicion(x) === 0)) s += 2;
    if (/live|en vivo|demo|remix|acoustic/i.test(r.disambiguation ?? '')) s -= 3;
    if (r.length && c.duracion > 30) s -= Math.min(3, Math.abs(r.length / 1000 - c.duracion) / 10);
    return s;
  };
  const grabacion = recs.sort((a, b) => puntaje(b) - puntaje(a))[0] ?? null;

  // 2) El álbum: si ya lo sabemos, se busca por nombre; si no, el álbum original donde salió la grabación.
  let album = null; // release-group
  let edicion = null; // release (para el número de pista)
  if (c.album) {
    const elegir = (grupos, quien) =>
      grupos
        .filter((g) => g.score >= 85 && mismoTitulo(g.title, c.album) && mismoArtista(quien, g['artist-credit']))
        .sort((a, b) => rangoAlbum(a) - rangoAlbum(b) || (a['first-release-date'] || '9999').localeCompare(b['first-release-date'] || '9999'))[0];
    const quien = c.artista_album || c.artista;
    album = elegir(await buscarAlbumes(c.album, quien), quien);
    if (!album && quien !== c.artista) album = elegir(await buscarAlbumes(c.album, c.artista), c.artista);
  } else if (grabacion) {
    const ediciones = recs.flatMap((r) => r.releases ?? []);
    ediciones.sort((a, b) => rangoEdicion(a) - rangoEdicion(b) || (a.date || '9999').localeCompare(b.date || '9999'));
    edicion = ediciones[0] ?? null;
    album = edicion?.['release-group'] ?? null;
  }
  if (!grabacion && !album) return null;

  const cambios = {};
  const completado = [];
  const poner = (campo, valor) => {
    if (valor === null || valor === undefined || (Array.isArray(valor) && !valor.length)) return;
    cambios[campo] = valor;
    completado.push(campo);
  };

  if (album) {
    if (!c.album) {
      poner('album', album.title);
      const credito = edicion?.['artist-credit']?.map((x) => x.name).join(', ');
      if (!c.artista_album) poner('artista_album', credito && credito !== 'Various Artists' ? credito : c.artista);
    }
    if (!c.anio) {
      let anio = anioDe(album['first-release-date']);
      if (!anio) anio = anioDe((await leerAlbum(album.id))?.['first-release-date']) ?? anioDe(edicion?.date);
      poner('anio', anio);
    }
    if (!c.pista && edicion) {
      const n = parseInt(edicion.media?.[0]?.track?.[0]?.number ?? '', 10);
      if (n > 0) poner('pista', n);
    }
  }

  // 3) Créditos y géneros de la grabación.
  let creditos = null;
  let generos = [];
  if (grabacion) {
    const d = await leerGrabacion(grabacion.id);
    if (d) {
      creditos = armarCreditos(d);
      generos = generosDe(d.tags);
    }
    if (!generos.length) generos = generosDe(recs.flatMap((r) => r.tags ?? []));
  }
  if (!c.generos?.length) {
    if (!generos.length && album) generos = generosDe(album.tags ?? (await leerAlbum(album.id))?.tags);
    poner('generos', generos);
  }

  // 4) Portada del álbum si el MP3 no traía.
  if (!c.portada && album) {
    const img = await bajarPortada(album.id);
    if (img) poner('portada', await guardarPortada(img));
  }

  return { cambios, completado, grabacion: grabacion?.id ?? null, creditos };
}

/**
 * Si MusicBrainz no encontró la canción o no supo el álbum, se completa lo que falte con iTunes / Deezer.
 * Recibe lo que devolvió `completarCancion` (o null) y devuelve el resultado combinado (o null si nadie la tiene).
 */
export async function completarConTiendas(c, res, guardarPortada) {
  const cambios = { ...(res?.cambios ?? {}) };
  const tieneAlbum = !!(c.album || cambios.album);
  const tienePortada = !!(c.portada || cambios.portada);
  const tieneGenero = !!(c.generos?.length || cambios.generos?.length);
  const tieneAnio = !!(c.anio || cambios.anio);
  if (tieneAlbum && tienePortada && tieneGenero && tieneAnio) return res;
  if (!c.artista || /^artista desconocido$/i.test(c.artista)) return res;
  const t = await buscarEnTiendas(tituloParaBuscar(c.titulo), c.artista);
  if (!t) return res;
  const completado = [...(res?.completado ?? [])];
  const poner = (campo, valor) => {
    if (valor === null || valor === undefined || (Array.isArray(valor) && !valor.length)) return;
    if (cambios[campo] !== undefined) return; // lo de MusicBrainz manda
    cambios[campo] = valor;
    completado.push(campo);
  };
  if (!c.album) {
    poner('album', t.album);
    if (!c.artista_album) poner('artista_album', t.artistaAlbum);
    if (!c.anio) poner('anio', t.anio);
    if (!c.pista) poner('pista', t.pista);
  }
  if (!c.generos?.length) poner('generos', t.generos);
  if (!c.anio && c.album) poner('anio', t.anio);
  if (!tienePortada && t.portada) {
    const img = await bajarImagen(t.portada);
    if (img) poner('portada', await guardarPortada(img));
  }
  if (!completado.length) return res;
  return { cambios, completado, grabacion: res?.grabacion ?? null, creditos: res?.creditos ?? null, fuente: t.fuente };
}

/**
 * Último paso para que ninguna canción quede sin álbum ni carátula:
 *   1) YouTube Music (tiene casi todo: OST de anime y juegos, phonk, artistas chicos), si todavía falta algo.
 *   2) Si nadie sabe el álbum, es un sencillo: el álbum se llama como la canción (sin "feat.", "Remastered"…).
 * La carátula, si nadie la tiene, queda la de por defecto. Nunca pisa lo que ya había.
 */
export async function completarAlbumYPortada(c, res, guardarPortada) {
  const cambios = { ...(res?.cambios ?? {}) };
  const completado = [...(res?.completado ?? [])];
  const tieneAlbum = !!(c.album || cambios.album);
  const tienePortada = !!(c.portada || cambios.portada);
  if (tieneAlbum && tienePortada) return res;
  const poner = (campo, valor) => {
    if (valor === null || valor === undefined || valor === '' || cambios[campo] !== undefined) return;
    cambios[campo] = valor;
    completado.push(campo);
  };
  let y = null;
  let ytmFallo = false;
  if (c.artista && !/^artista desconocido$/i.test(c.artista)) {
    try {
      y = await buscarAlbumYtm(c.artista, c.titulo, c.duracion);
    } catch {
      ytmFallo = true; // YouTube Music no respondió: se reintenta otro día (no se inventa el sencillo todavía)
    }
  }
  if (y) {
    if (!tieneAlbum) {
      poner('album', y.album);
      if (!c.artista_album) poner('artista_album', y.artistaAlbum);
    }
    if (!tienePortada && y.portada) {
      const img = await bajarImagen(y.portada);
      if (img) poner('portada', await guardarPortada(img));
    }
  }
  if (!c.album && !cambios.album && !ytmFallo) {
    poner('album', tituloParaBuscar(c.titulo));
    if (!c.artista_album) poner('artista_album', c.artista);
  }
  if (completado.length === (res?.completado ?? []).length) return res;
  return { cambios, completado, grabacion: res?.grabacion ?? null, creditos: res?.creditos ?? null, fuente: y ? 'ytmusic' : res?.fuente ?? 'sencillo' };
}
