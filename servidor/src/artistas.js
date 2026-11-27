// Nombres de artista ordenados, para que el buscador no muestre el mismo artista (y sus álbumes) varias veces:
//
//  1) Colaboraciones: "Alvaro Diaz & Feid – GATITAS" → "Alvaro Diaz – GATITAS (con Feid)". Ojo: muchos "A & B" son
//     GRUPOS o dúos de verdad (Daryl Hall & John Oates, Wisin & Yandel, Earth, Wind & Fire), así que nada se separa
//     solo: el panel lo sugiere y el admin decide una vez por combinación ("Separar" o "Es un grupo").
//  2) El mismo artista escrito distinto: "Alvaro Diaz" / "Álvaro Díaz" → uno solo ("Unificar" o "Son distintos").
//
// Lo decidido queda guardado (artista_decisiones) y se aplica solo a las canciones que se suban después.
import { db } from './db.js';
import { olvidarIndice } from './repetidas.js';

/** Sin mayúsculas ni tildes ni espacios de más: "Álvaro  Díaz" = "alvaro diaz". */
export const clave = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const SEP = /\s+(?:&|y|x|and|feat\.?|ft\.?|featuring|con)\s+|\s*,\s*/i;
/** "Alvaro Diaz, Feid & Mora" → ["Alvaro Diaz", "Feid", "Mora"] (o [] si es un solo nombre). */
export function partes(artista) {
  const p = String(artista ?? '').split(SEP).map((x) => x.trim()).filter(Boolean);
  return p.length > 1 ? p : [];
}

/** "Feid" o "Feid y Mora". */
const unir = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} y ${l[l.length - 1]}` : l[0]);

/** Título con los invitados: "GATITAS" → "GATITAS (con Feid)"; no repite si ya los nombra. */
export function tituloCon(titulo, invitados) {
  const t = String(titulo ?? '');
  const faltan = invitados.filter((i) => !clave(t).includes(clave(i)));
  if (!faltan.length) return t;
  return `${t} (con ${unir(faltan)})`;
}

/**
 * Aplica a una canción que se está subiendo lo que el admin ya decidió (colaboración o nombre unificado).
 * `datos` = lo que se leyó del archivo (titulo, artista, artistaAlbum). Lo cambia en el lugar.
 */
export async function aplicarDecisiones(datos) {
  const r = await db.query('SELECT clave, tipo, principal, invitados FROM artista_decisiones WHERE clave = ANY($1)', [
    [clave(datos.artista), clave(datos.artistaAlbum)].filter(Boolean),
  ]);
  const d = new Map(r.rows.map((x) => [x.clave, x]));
  const colab = d.get(clave(datos.artista));
  if (colab?.tipo === 'colaboracion') {
    datos.titulo = tituloCon(datos.titulo, colab.invitados);
    if (clave(datos.artistaAlbum) === clave(datos.artista)) datos.artistaAlbum = colab.principal;
    datos.artista = colab.principal;
  }
  // Nombre unificado (también para el resultado de la colaboración: "Alvaro Diaz" → "Álvaro Díaz").
  const n = await db.query(`SELECT clave, principal FROM artista_decisiones WHERE tipo = 'nombre' AND clave = ANY($1)`, [
    [clave(datos.artista), clave(datos.artistaAlbum)].filter(Boolean),
  ]);
  for (const x of n.rows) {
    if (clave(datos.artista) === x.clave) datos.artista = x.principal;
    if (clave(datos.artistaAlbum) === x.clave) datos.artistaAlbum = x.principal;
  }
  return datos;
}

/** Para el panel: colaboraciones y nombres escritos distinto que todavía no tienen decisión. */
export async function sugerenciasArtistas() {
  const c = (await db.query('SELECT titulo, artista, creditos FROM canciones')).rows;
  const decididas = new Set((await db.query('SELECT clave FROM artista_decisiones')).rows.map((x) => x.clave));
  const cuenta = new Map(); // clave → { escritos: Map(nombre → n), n }
  for (const x of c) {
    const k = clave(x.artista);
    const e = cuenta.get(k) ?? { escritos: new Map(), n: 0 };
    e.n++;
    e.escritos.set(x.artista, (e.escritos.get(x.artista) ?? 0) + 1);
    cuenta.set(k, e);
  }

  // 1) Colaboraciones: el primero existe como artista solo (si no, casi seguro es un grupo: "Earth, Wind & Fire").
  const colabs = new Map();
  for (const x of c) {
    const k = clave(x.artista);
    if (decididas.has(k)) continue;
    const p = partes(x.artista);
    if (!p.length || !cuenta.has(clave(p[0]))) continue;
    const g = colabs.get(k) ?? { clave: k, original: x.artista, principal: p[0], invitados: p.slice(1), n: 0, ejemplos: [], musicbrainz: false };
    g.n++;
    if (g.ejemplos.length < 3) g.ejemplos.push(x.titulo);
    // MusicBrainz lo anota como artistas separados: pista fuerte de que es una colaboración y no un grupo.
    const perf = (x.creditos?.performers ?? []).map((y) => clave(y.name));
    if (perf.length > 1 && p.every((a) => perf.includes(clave(a)))) g.musicbrainz = true;
    colabs.set(k, g);
  }
  // Pistas para decidir: cuántas canciones tiene cada uno solo.
  const colaboraciones = [...colabs.values()]
    .map((g) => ({ ...g, solos: [g.principal, ...g.invitados].map((a) => ({ nombre: a, n: cuenta.get(clave(a))?.n ?? 0 })) }))
    .sort((a, b) => Number(b.musicbrainz) - Number(a.musicbrainz) || b.n - a.n);

  // 2) Mismo nombre escrito distinto (tildes o mayúsculas): se propone el más usado (y con tildes si empatan).
  const nombres = [];
  for (const [k, e] of cuenta) {
    if (e.escritos.size < 2 || decididas.has(`nombre:${k}`)) continue;
    const l = [...e.escritos.entries()].sort((a, b) => b[1] - a[1] || b[0].normalize('NFD').length - a[0].normalize('NFD').length);
    nombres.push({ clave: k, principal: l[0][0], escritos: l.map(([nombre, n]) => ({ nombre, n })), n: e.n });
  }
  nombres.sort((a, b) => b.n - a.n);
  return { colaboraciones, nombres };
}

/** "Separar": todas las canciones con ese artista combinado pasan a "principal – título (con invitados)". */
export async function separarColaboracion(k, principal, invitados) {
  const r = await db.query('SELECT id, titulo, artista, artista_album FROM canciones');
  const cambiar = r.rows.filter((x) => clave(x.artista) === k);
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    for (const x of cambiar) {
      const albumIgual = clave(x.artista_album) === k;
      await c.query('UPDATE canciones SET artista = $2, titulo = $3, artista_album = $4, datos_revisado = now() WHERE id = $1', [
        x.id,
        principal,
        tituloCon(x.titulo, invitados),
        albumIgual ? principal : x.artista_album,
      ]);
    }
    await c.query(
      `INSERT INTO artista_decisiones (clave, tipo, original, principal, invitados) VALUES ($1, 'colaboracion', $2, $3, $4)
       ON CONFLICT (clave) DO UPDATE SET tipo = 'colaboracion', principal = $3, invitados = $4, decidido = now()`,
      [k, cambiar[0]?.artista ?? k, principal, invitados],
    );
    await c.query('COMMIT');
    olvidarIndice(); // cambiaron artistas o títulos: el índice de repetidas se rearma
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return cambiar.length;
}

/** "Unificar": todas las formas de escribir ese nombre pasan a `principal` (artista y artista del álbum). */
export async function unificarNombre(k, principal) {
  const r = await db.query('SELECT id, artista, artista_album FROM canciones');
  let n = 0;
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    for (const x of r.rows) {
      const a = clave(x.artista) === k && x.artista !== principal;
      const al = clave(x.artista_album) === k && x.artista_album !== principal;
      if (!a && !al) continue;
      n++;
      await c.query('UPDATE canciones SET artista = $2, artista_album = $3, datos_revisado = now() WHERE id = $1', [
        x.id,
        a ? principal : x.artista,
        al ? principal : x.artista_album,
      ]);
    }
    await c.query(
      `INSERT INTO artista_decisiones (clave, tipo, original, principal) VALUES ($1, 'nombre', $2, $2)
       ON CONFLICT (clave) DO UPDATE SET tipo = 'nombre', principal = $2, decidido = now()`,
      [k, principal],
    );
    await c.query('COMMIT');
    olvidarIndice(); // cambiaron artistas o títulos: el índice de repetidas se rearma
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  return n;
}

/** "Es un grupo" / "Son distintos": no se vuelve a sugerir. */
export async function noTocar(k, tipo, original) {
  await db.query(
    `INSERT INTO artista_decisiones (clave, tipo, original) VALUES ($1, $2, $3)
     ON CONFLICT (clave) DO UPDATE SET tipo = $2, decidido = now()`,
    [tipo === 'distintos' ? `nombre:${k}` : k, tipo, original],
  );
}
