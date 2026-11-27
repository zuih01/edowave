import { join } from 'node:path';
import { db } from '../db.js';
import { decodificarMono, guardarImagen, medirVolumen } from '../medios.js';
import { artistasDe, completarAlbumYPortada, completarCancion, completarConTiendas, normalizar } from '../datos/completar.js';
import { integrantesDe } from '../datos/musicbrainz.js';
import { SinConexion } from '../datos/musicbrainz.js';
import { analizarRasgos } from './rasgos.js';
import { analizarRitmo } from './ritmo.js';
import { avisarMudanza, rutaAudio } from '../almacen.js';

/**
 * Cola de análisis: cada canción subida se analiza UNA vez aquí (de a una, para no saturar el servidor):
 *  - ritmo (BPM, golpes, puntos de mezcla) → Automix
 *  - volumen (LUFS y pico) → nivelador
 *  - rasgos (energía, brillo…) → algoritmo de cada usuario
 * Al arrancar, retoma las que quedaron pendientes.
 */

let corriendo = false;
let log = console;

export function iniciarCola(logger) {
  log = logger;
  void procesar();
  void procesarDatos();
  void procesarArtistas();
  // Las que siguen sin álbum o sin carátula se vuelven a buscar solas: al arrancar y cada 6 horas.
  setTimeout(() => void reintentarSinAlbum(), 60_000).unref();
  setInterval(() => void reintentarSinAlbum(), 6 * 3600_000).unref();
}

/**
 * Vuelve a poner en cola (de a 500) las canciones sin álbum o sin carátula que no se revisan hace 7 días, o que se
 * revisaron antes de que existiera la búsqueda en YouTube Music y el "sencillo" (26-11-2026).
 */
const FUENTES_DESDE = '2026-11-26T08:00:00Z';
async function reintentarSinAlbum() {
  try {
    const r = await db.query(
      `UPDATE canciones SET datos_estado = 'pendiente'
        WHERE id IN (SELECT id FROM canciones
                      WHERE (album IS NULL OR album = '' OR portada IS NULL)
                        AND datos_estado IN ('sin_resultado', 'listo', 'error')
                        AND (datos_revisado IS NULL OR datos_revisado < now() - interval '7 days' OR datos_revisado < $1)
                      ORDER BY subida DESC LIMIT 500)`,
      [FUENTES_DESDE],
    );
    if (r.rowCount) {
      log.info({ canciones: r.rowCount }, 'datos: se vuelven a buscar álbum y carátula de las que no tenían');
      void procesarDatos();
    }
  } catch (e) {
    log.warn({ err: e.message }, 'datos: no se pudieron reintentar las canciones sin álbum');
  }
}

/** Avisa que hay canciones nuevas por analizar y por completar. */
export const avisarCola = () => {
  void procesar();
  void procesarDatos();
  void procesarArtistas();
};

// ---------------- Integrantes de los grupos (para buscar "Freddie Mercury" y encontrar a Queen) ----------------

let buscandoArtistas = false;

async function procesarArtistas() {
  if (buscandoArtistas) return;
  buscandoArtistas = true;
  try {
    // Cada artista de las canciones queda anotado una vez: el nombre completo primero y, si no existe en
    // MusicBrainz, cada uno de los que van juntos ("Queen & David Bowie").
    const nombres = new Set();
    for (const f of (await db.query('SELECT DISTINCT artista, artista_album FROM canciones')).rows)
      for (const n of [...artistasDe(f.artista), ...artistasDe(f.artista_album)]) nombres.add(n);
    if (nombres.size) await db.query('INSERT INTO artistas_info (nombre) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [[...nombres]]);
    for (;;) {
      // Los nombres completos (más largos) primero: si ya se encontró el completo, sus partes no hacen falta.
      const r = await db.query(`SELECT nombre FROM artistas_info WHERE estado = 'pendiente' ORDER BY length(nombre) DESC, nombre LIMIT 1`);
      const nombre = r.rows[0]?.nombre;
      if (!nombre) return;
      try {
        const res = await integrantesDe(nombre, (a, b) => normalizar(a) === normalizar(b));
        await db.query(
          `UPDATE artistas_info SET estado = $2, mb_artista = $3, tipo = $4, miembros = $5, revisado = now() WHERE nombre = $1`,
          [nombre, res ? 'listo' : 'sin_resultado', res?.id ?? null, res?.tipo ?? null, res?.miembros ?? []],
        );
        if (res?.miembros.length) log.info({ artista: nombre, integrantes: res.miembros.length }, 'integrantes del grupo');
      } catch (e) {
        if (e instanceof SinConexion) {
          setTimeout(() => void procesarArtistas(), 10 * 60 * 1000);
          return;
        }
        await db.query(`UPDATE artistas_info SET estado = 'error', revisado = now() WHERE nombre = $1`, [nombre]);
      }
    }
  } catch (e) {
    log.warn({ error: e.message }, 'no se pudieron buscar los integrantes');
  } finally {
    buscandoArtistas = false;
  }
}

// ---------------- Datos desde MusicBrainz (va aparte: depende de internet y de 1 consulta por segundo) ----------------

let completando = false;

async function procesarDatos() {
  if (completando) return;
  completando = true;
  try {
    for (;;) {
      const r = await db.query(
        `SELECT id, titulo, artista, album, artista_album, anio, pista, generos, duracion, portada, mb_completado
           FROM canciones WHERE datos_estado = 'pendiente' ORDER BY subida LIMIT 1`,
      );
      const c = r.rows[0];
      if (!c) return;
      try {
        const guardar = (img) => guardarImagen(img, join(process.env.MUSIC_DIR, '..', 'portadas'));
        // MusicBrainz primero; lo que no sepa (álbum, portada) se busca en iTunes / Deezer y después en YouTube Music.
        // Si nadie sabe el álbum, es un sencillo: se llama como la canción.
        const res = await completarAlbumYPortada(c, await completarConTiendas(c, await completarCancion(c, guardar), guardar), guardar);
        if (!res) {
          await db.query(`UPDATE canciones SET datos_estado = 'sin_resultado', datos_revisado = now() WHERE id = $1`, [c.id]);
          log.info({ cancion: c.titulo }, 'MusicBrainz no tiene esta canción');
          continue;
        }
        const sets = ["datos_estado = 'listo'", 'datos_revisado = now()', 'mb_grabacion = $2', 'creditos = $3', 'mb_completado = $4'];
        const vals = [c.id, res.grabacion, res.creditos, [...new Set([...(c.mb_completado ?? []), ...res.completado])]];
        for (const [k, v] of Object.entries(res.cambios)) {
          vals.push(v);
          sets.push(`${k} = $${vals.length}`);
        }
        await db.query(`UPDATE canciones SET ${sets.join(', ')} WHERE id = $1`, vals);
        log.info({ cancion: c.titulo, completado: res.completado }, 'datos completados desde MusicBrainz');
      } catch (e) {
        if (e instanceof SinConexion) {
          // Sin internet: se reintenta en 10 minutos (la canción queda pendiente).
          log.warn('sin conexión con MusicBrainz; se reintenta en 10 minutos');
          setTimeout(() => void procesarDatos(), 10 * 60 * 1000);
          return;
        }
        await db.query(`UPDATE canciones SET datos_estado = 'error', datos_revisado = now() WHERE id = $1`, [c.id]);
        log.warn({ cancion: c.titulo, error: e.message }, 'no se pudieron completar los datos');
      }
    }
  } finally {
    completando = false;
  }
}

async function procesar() {
  if (corriendo) return;
  corriendo = true;
  try {
    for (;;) {
      const r = await db.query(
        `SELECT c.id, c.archivo, c.almacen, c.titulo FROM analisis a JOIN canciones c ON c.id = a.cancion_id
          WHERE a.estado = 'pendiente' ORDER BY c.subida LIMIT 1`,
      );
      const c = r.rows[0];
      if (!c) return;
      const t0 = Date.now();
      try {
        const ruta = await rutaAudio(c); // si está en wifi, se trae a la caché
        const mono = await decodificarMono(ruta);
        const ritmo = analizarRitmo(mono);
        const rasgos = analizarRasgos(mono);
        const vol = await medirVolumen(ruta);
        await db.query(
          `UPDATE analisis SET estado = 'listo', error = NULL, ritmo = $2, rasgos = $3, lufs = $4, pico = $5, actualizado = now()
            WHERE cancion_id = $1`,
          [c.id, ritmo, rasgos, vol.lufs, vol.pico],
        );
        log.info({ cancion: c.titulo, bpm: ritmo?.bpm, lufs: vol.lufs, ms: Date.now() - t0 }, 'canción analizada');
      } catch (e) {
        await db.query(`UPDATE analisis SET estado = 'error', error = $2, actualizado = now() WHERE cancion_id = $1`, [c.id, String(e.message).slice(0, 300)]);
        log.warn({ cancion: c.titulo, error: e.message }, 'no se pudo analizar');
      }
      avisarMudanza(); // terminó su análisis: ya puede irse a wifi
    }
  } finally {
    corriendo = false;
  }
}
