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
import { claveRepetida, esCopia, mismaCancion } from './repetidas.js';

const musica = () => process.env.MUSIC_DIR;
const antes = (a, b) => Date.parse(a.subida) - Date.parse(b.subida) || String(a.id).localeCompare(String(b.id));

/** Grupos [queda, ...borrar] según las reglas de repetidas.js. */
export async function buscarRepetidas() {
  const r = await db.query(`
    SELECT c.id, c.titulo, c.artista, c.album, c.duracion, c.pista, c.subida, c.archivo, c.original, c.portada, c.almacen,
           (SELECT count(*) FROM escuchas e WHERE e.cancion = 's:' || c.id)::int AS escuchas
      FROM canciones c`);
  const canciones = r.rows;

  const grupos = new Map(); // clave → canciones
  for (const c of canciones) {
    const k = claveRepetida(c.artista, c.titulo);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
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

  const repetidas = [];
  for (const todos of grupos.values()) {
    if (todos.length < 2) continue;
    todos.sort(antes);
    // Cada una se compara con las que ya quedaron: así dos canciones distintas con el mismo nombre en un álbum
    // ("In the Flesh?" / "In the Flesh") quedan las dos, y las copias de cada una se borran.
    const quedan = [];
    for (const c of todos) {
      const original = quedan.find((q) => mismaCancion(q[0], c));
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

/** El servidor revisa solo: a los 2 minutos de arrancar y cada 6 horas. */
export function iniciarDuplicados(log, alTerminar = () => {}) {
  let corriendo = false;
  const revisar = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
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
