// Limpieza automática de canciones repetidas (mismas reglas que la subida: ver repetidas.js).
//
// De cada grupo de repetidas se queda la MÁS ANTIGUA (la que se subió primero) y se borran las más nuevas.
// Las escuchas, "me gusta" y playlists de las que se borran pasan a la que se queda: nadie pierde nada.
// Los archivos que estaban en el VPS van a ~/reproductor/papelera/duplicados-<fecha>; los de wifi se borran allá
// (con la cola wifi_borrar, que la mudanza procesa aunque wifi esté apagado).
//
// El servidor la corre solo (al arrancar y cada 6 horas: ver iniciarDuplicados). A mano:
//   node sistema/duplicados.mjs            → solo muestra la lista
//   node sistema/duplicados.mjs --borrar   → borra
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { db } from './db.js';
import { agregarAlIndice, casiIgual, claveRepetida, esCopia, lecturasNombre, mismaCancion, nombreAlReves, normal, olvidarIndice, tituloBase } from './repetidas.js';

const musica = () => process.env.MUSIC_DIR;
const antes = (a, b) => Date.parse(a.subida) - Date.parse(b.subida) || String(a.id).localeCompare(String(b.id));


/** Grupos [queda, ...borrar] según las reglas de repetidas.js. Una sola pasada por el catálogo, todo en memoria. */
export async function buscarRepetidas() {
  const r = await db.query(`
    SELECT c.id, c.titulo, c.artista, c.album, c.duracion, c.pista, c.subida, c.archivo, c.original, c.portada, c.almacen,
           c.nombre_original, coalesce(e.n, 0)::int AS escuchas
      FROM canciones c
      LEFT JOIN (SELECT cancion, count(*) AS n FROM escuchas GROUP BY cancion) e ON e.cancion = 's:' || c.id`);
  const canciones = r.rows;

  const grupos = new Map(); // clave → canciones
  for (const c of canciones) {
    const k = claveRepetida(c.artista, c.titulo);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  // Subidas sin etiquetas con el nombre al revés ("Título - Artista.mp3"): si dada vuelta calza con una canción que
  // ya está y dura casi lo mismo (±5 s), es esa misma.
  for (const c of canciones) {
    if (!salioDelNombre(c)) continue;
    const propia = claveRepetida(c.artista, c.titulo);
    const l2 = lecturasNombre(partesDe(c)).alReves;
    const alReves = claveRepetida(l2.artista, l2.titulo);
    if (!alReves || alReves === propia || !grupos.has(alReves)) continue;
    if (!grupos.get(alReves).some((o) => Math.abs((Number(o.duracion) || 0) - (Number(c.duracion) || 0)) <= 5)) continue;
    const l = grupos.get(propia);
    if (l) {
      l.splice(l.indexOf(c), 1);
      if (!l.length) grupos.delete(propia);
    }
    grupos.get(alReves).push(c);
  }
  // Copias con número o error de tipeo: se suman al grupo de su original (mismo artista, casi la misma duración).
  const porArtista = new Map();
  for (const k of grupos.keys()) {
    const a = k.split('|')[0];
    if (!porArtista.has(a)) porArtista.set(a, []);
    porArtista.get(a).push(k);
  }
  for (const k of [...grupos.keys()]) {
    if (!grupos.has(k)) continue;
    for (const otra of porArtista.get(k.split('|')[0])) {
      if (otra === k || !grupos.has(otra)) continue;
      if (esCopia(k, otra, grupos.get(k)[0].duracion, grupos.get(otra)[0].duracion)) {
        grupos.get(otra).push(...grupos.get(k));
        grupos.delete(k);
        break;
      }
    }
  }
  // Casi idénticas con claves distintas (mismo título base, un artista en común, ±3 s, misma versión): se juntan.
  // Solo se comparan canciones con el mismo título base, así que es rápido aunque el catálogo sea grande.
  const porBase = new Map(); // título base → claves de grupo
  for (const [k, l] of grupos) {
    const b = tituloBase(l[0].titulo);
    if (!b) continue;
    if (!porBase.has(b)) porBase.set(b, []);
    porBase.get(b).push(k);
  }
  for (const claves of porBase.values()) {
    if (claves.length < 2) continue;
    for (let x = 0; x < claves.length; x++) {
      if (!grupos.has(claves[x])) continue;
      for (let y = x + 1; y < claves.length; y++) {
        if (!grupos.has(claves[y])) continue;
        const [ga, gb] = [grupos.get(claves[x]), grupos.get(claves[y])];
        if (ga.some((a) => gb.some((b) => casiIgual(a, b)))) {
          ga.push(...gb);
          grupos.delete(claves[y]);
        }
      }
    }
  }

  const repetidas = [];
  for (const todos of grupos.values()) {
    if (todos.length < 2) continue;
    todos.sort(antes);
    // Cada una se compara con las que ya quedaron: así dos canciones distintas con el mismo nombre en un álbum
    // ("In the Flesh?" / "In the Flesh") quedan las dos, y las copias de cada una se borran.
    const quedan = [];
    for (const c of todos) {
      // Con la misma clave basta mismaCancion; si llegó al grupo por parecido (copia, casi igual o nombre al revés),
      // además tiene que durar casi lo mismo que la que queda: así no se cuela otra versión más larga o más corta.
      const original = quedan.find(
        (q) =>
          mismaCancion(q[0], c) &&
          (claveRepetida(q[0].artista, q[0].titulo) === claveRepetida(c.artista, c.titulo) ||
            Math.abs((Number(q[0].duracion) || 0) - (Number(c.duracion) || 0)) <= 5),
      );
      if (original) original.push(c);
      else quedan.push([c]);
    }
    for (const g of quedan) if (g.length > 1) repetidas.push(g);
  }
  return { total: canciones.length, repetidas };
}

/** Borra las repetidas (deja la más antigua de cada grupo). Devuelve cuántas borró. */
export async function borrarRepetidas(repetidas) {
  if (!repetidas.length) return { borradas: 0, papelera: null };
  const archivos = [];
  const cliente = await db.connect();
  let borradas = 0;
  try {
    await cliente.query('BEGIN');
    for (const [queda, ...resto] of repetidas) {
      const q = 's:' + queda.id;
      for (const c of resto) {
        const b = 's:' + c.id;
        await cliente.query('UPDATE escuchas SET cancion = $1 WHERE cancion = $2', [q, b]);
        await cliente.query(
          `INSERT INTO impresiones (dia, cancion, origen, veces)
             SELECT dia, $1, origen, veces FROM impresiones WHERE cancion = $2
           ON CONFLICT (dia, cancion, origen) DO UPDATE SET veces = impresiones.veces + EXCLUDED.veces`,
          [q, b],
        );
        await cliente.query('DELETE FROM impresiones WHERE cancion = $1', [b]);
        // Playlists: si ya tenía la que queda, la repetida se quita (no queda dos veces); si no, se cambia por ella.
        await cliente.query(
          `DELETE FROM playlist_canciones p WHERE p.cancion = $2
              AND EXISTS (SELECT 1 FROM playlist_canciones o WHERE o.playlist_id = p.playlist_id AND o.cancion = $1)`,
          [q, b],
        );
        await cliente.query('UPDATE playlist_canciones SET cancion = $1 WHERE cancion = $2', [q, b]);
        // "Me gusta": si la persona ya valoró la que queda, se mantiene esa.
        await cliente.query(
          `INSERT INTO valoraciones (usuario_id, cancion, valor, fecha)
             SELECT usuario_id, $1, valor, fecha FROM valoraciones WHERE cancion = $2
           ON CONFLICT (usuario_id, cancion) DO NOTHING`,
          [q, b],
        );
        await cliente.query('DELETE FROM valoraciones WHERE cancion = $1', [b]);
        await cliente.query('DELETE FROM reco_mostradas WHERE cancion = $1', [b]).catch(() => {});
        await cliente.query('DELETE FROM canciones WHERE id = $1', [c.id]); // su análisis se borra con ella
        if (c.almacen === 'wifi') {
          await cliente.query('INSERT INTO wifi_borrar (archivo) VALUES ($1) ON CONFLICT DO NOTHING', [c.archivo]);
          if (c.original) await cliente.query('INSERT INTO wifi_borrar (archivo) VALUES ($1) ON CONFLICT DO NOTHING', [`originales/${c.original}`]);
          archivos.push({ ruta: join(musica(), '..', 'cache-wifi', c.archivo), guardar: false });
        } else {
          archivos.push({ ruta: join(musica(), c.archivo), guardar: true });
          if (c.original) archivos.push({ ruta: join(musica(), '..', 'originales', c.original), guardar: true });
        }
        if (c.portada) {
          const otra = await cliente.query('SELECT 1 FROM canciones WHERE portada = $1 LIMIT 1', [c.portada]);
          if (!otra.rowCount) archivos.push({ ruta: join(musica(), '..', 'portadas', c.portada), guardar: false });
        }
        borradas++;
      }
    }
    await cliente.query('COMMIT');
    olvidarIndice();
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
  const papelera = join(musica(), '..', '..', 'papelera', `duplicados-${new Date().toISOString().slice(0, 10)}`);
  await mkdir(papelera, { recursive: true });
  for (const { ruta, guardar } of archivos) {
    if (guardar) await rename(ruta, join(papelera, basename(ruta))).catch(() => rm(ruta, { force: true }));
    else await rm(ruta, { force: true });
  }
  return { borradas, papelera };
}

/**
 * Canciones subidas sin etiquetas con el nombre al revés ("NOT CUTE ANYMORE - ILLIT.mp3" quedó con artista
 * "NOT CUTE ANYMORE"): si el "título" es un artista que el catálogo conoce (por canciones con álbum, que sí traían
 * etiquetas) y el "artista" no, se dan vuelta. Sus datos (MusicBrainz, carátula) se vuelven a buscar.
 * @returns {Promise<{id:string, artista:string, titulo:string}[]>} las que hay que dar vuelta (ya con el orden bueno)
 */
export async function buscarAlReves() {
  const r = await db.query(`SELECT id, titulo, artista, album, duracion, pista, nombre_original, subida_por::text AS por,
                                   to_char(subida, 'YYYY-MM-DD') AS dia FROM canciones`);
  // El catálogo "de confianza": canciones cuyo artista y título no salieron del nombre del archivo.
  const confiables = r.rows.filter((c) => !salioDelNombre(c));
  const indice = { porClave: new Map(), artistas: new Set() };
  for (const c of confiables) agregarAlIndice(c, indice);
  const dudosas = r.rows.filter(salioDelNombre).map((c) => ({ c, partes: partesDe(c) }));
  // 1) Las que se pueden decidir por el catálogo.
  const lotes = new Map(); // persona + día → { alReves, derecho }
  for (const d of dudosas) {
    d.alReves = nombreAlReves(indice, d.partes, Number(d.c.duracion));
    if (d.alReves === null) continue;
    const k = `${d.c.por}|${d.c.dia}`;
    const l = lotes.get(k) ?? { alReves: 0, derecho: 0 };
    l[d.alReves ? 'alReves' : 'derecho']++;
    lotes.set(k, l);
  }
  // 2) Las dudosas siguen la costumbre de su lote (misma persona, mismo día): 8 de cada 10 y al menos 5.
  for (const d of dudosas) {
    if (d.alReves !== null) continue;
    const l = lotes.get(`${d.c.por}|${d.c.dia}`);
    const n = l ? l.alReves + l.derecho : 0;
    d.alReves = n >= 5 && l.alReves / n >= 0.8;
  }
  return dudosas.filter((d) => d.alReves).map(({ c, partes }) => ({ id: c.id, ...lecturasNombre(partes).alReves }));
}

/** Partes del nombre original sin extensión ("A - B - C.mp3" → ["A", "B", "C"]). */
const partesDe = (c) =>
  String(c.nombre_original ?? '')
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ')
    .split(' - ')
    .map((p) => p.trim())
    .filter(Boolean);
/** ¿Artista y título son tal cual "A - B…" del nombre del archivo (sin etiquetas)? Con o sin álbum. */
const salioDelNombre = (c) => {
  const p = partesDe(c);
  return p.length > 1 && normal(c.artista) === normal(p[0]) && normal(c.titulo) === normal(p.slice(1).join(' - '));
};

export async function enderezarNombres(lista) {
  if (!lista.length) return 0;
  const r = await db.query(
    `UPDATE canciones c SET artista = x.artista, titulo = x.titulo, datos_estado = 'pendiente', datos_revisado = now()
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, artista text, titulo text) WHERE c.id = x.id`,
    [JSON.stringify(lista)],
  );
  olvidarIndice();
  return r.rowCount;
}

/** El servidor revisa solo: a los 2 minutos de arrancar y cada 6 horas. */
export function iniciarDuplicados(log, alTerminar = () => {}) {
  let corriendo = false;
  const revisar = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      // (Dar vuelta nombres solo a mano: la detección automática se equivocó con canciones buenas el 26-11.)
      const { repetidas } = await buscarRepetidas();
      if (!repetidas.length) return;
      const { borradas } = await borrarRepetidas(repetidas);
      for (const [queda, ...resto] of repetidas) {
        log.info({ queda: `${queda.artista} – ${queda.titulo}`, borradas: resto.map((c) => c.id) }, 'duplicados: canción repetida borrada');
      }
      log.warn({ borradas }, 'duplicados: se borraron canciones repetidas (quedó la más antigua de cada una)');
      alTerminar();
    } catch (e) {
      log.error({ err: e.message }, 'duplicados: no se pudo revisar');
    } finally {
      corriendo = false;
    }
  };
  setTimeout(() => void revisar(), 2 * 60_000).unref();
  setInterval(() => void revisar(), 6 * 60 * 60_000).unref();
}
