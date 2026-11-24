import { integrantesDeTexto } from '../datos/completar.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { db } from '../db.js';
import { requiereAdmin, requiereUsuario } from '../auth.js';
import { aligerar, convertirAudio, guardarImagen, leerDatos, nombreFormato, planAudio, sacarPortada, TIPOS } from '../medios.js';
import { avisarCola } from '../analisis/cola.js';
import { claveRepetida, esCopia, mismaCancion } from '../repetidas.js';
import { avisarVibra } from '../analisis/vibra.js';
import { avisarLastfm } from '../datos/lastfm.js';
import { avisarAnioOriginal } from '../datos/anioOriginal.js';
import { esImagen } from './fotoPerfil.js';
import { CATEGORIAS, avisarCategorias } from '../categorias.js';
import { avisarFaltantes } from '../importarPlaylist.js';
import { aplicarDecisiones } from '../artistas.js';
import { avisarMudanza, borrarDeWifi, rutaAudio, wifiActivo, wifiEstado } from '../almacen.js';

const gzipAsync = promisify(gzip);
const MAX_MB = 500; // un WAV largo pesa mucho
const nuevoId = () => randomBytes(8).toString('base64url');
const musica = () => process.env.MUSIC_DIR;
const portadas = () => join(musica(), '..', 'portadas');
const temporal = () => join(musica(), '..', 'tmp');

/**
 * Enlaces firmados para escuchar: el reproductor del teléfono (<audio>) no puede mandar la sesión en un
 * encabezado, así que pide un enlace que vale solo para esa canción, ese usuario y unas horas. Con él la
 * canción empieza a sonar mientras se descarga (en vez de esperar el archivo completo).
 */
// El secreto se guarda en un archivo (junto a la música) para que las llaves sigan valiendo tras reiniciar.
const SECRETO = (() => {
  if (process.env.FIRMA_AUDIO) return process.env.FIRMA_AUDIO;
  const ruta = join(process.env.MUSIC_DIR, '..', 'firma-audio.key');
  try {
    return readFileSync(ruta, 'utf8').trim();
  } catch {
    const nuevo = randomBytes(32).toString('hex');
    writeFileSync(ruta, nuevo, { mode: 0o600 });
    return nuevo;
  }
})();
const VIGENCIA_S = 6 * 60 * 60;
const firmar = (id, usuario, vence) => createHmac('sha256', SECRETO).update(`${id}.${usuario}.${vence}`).digest('base64url');
/**
 * Llave de audio: una sola por cuenta y por unas horas, vale para TODAS las canciones. Así la app arma el
 * enlace de cualquier canción al instante, sin preguntarle nada al servidor antes de darle play.
 */
const LLAVE_S = 12 * 60 * 60;
const llaveDe = (usuario, vence) => createHmac('sha256', SECRETO).update(`llave.${usuario}.${vence}`).digest('base64url');
function llaveValida(q) {
  const vence = Number(q?.v);
  if (!q?.k || !q?.u || !(vence > Date.now() / 1000)) return false;
  const esperada = Buffer.from(llaveDe(String(q.u), vence));
  const dada = Buffer.from(String(q.k));
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}

function firmaValida(id, q) {
  const vence = Number(q?.v);
  if (!q?.f || !q?.u || !(vence > Date.now() / 1000)) return false;
  const esperada = Buffer.from(firmar(id, String(q.u), vence));
  const dada = Buffer.from(String(q.f));
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}
/** Deja pasar con la sesión (encabezado) o con un enlace firmado vigente. */
async function usuarioOFirma(req, reply) {
  if (llaveValida(req.query) || firmaValida(String(req.params.id), req.query)) return;
  return requiereUsuario(req, reply);
}
const originales = () => join(musica(), '..', 'originales');

/** Así ve una canción la app y el panel. */
const CAMPOS = `c.id, c.titulo, c.artista, c.album, c.artista_album, c.anio, c.generos, c.pista, c.duracion, c.bitrate,
  c.tamano, c.portada, c.subida, c.nombre_original, a.estado AS analisis, a.error AS analisis_error,
  a.ritmo->>'bpm' AS bpm, (a.ritmo->>'steady')::boolean AS tempo_constante, a.lufs,
  c.datos_estado, c.mb_completado, c.mb_grabacion, c.formato, c.formato_original, c.categorias`;

/**
 * Agrega a la biblioteca un archivo de audio ya guardado en `tmp` (subido por el panel o dejado en la carpeta
 * de entrada). Lo convierte si hace falta, saca la carátula, lo registra y lo manda a analizar.
 * Devuelve { cancion } o { error, codigo } (409 = ya estaba). `tmp` se mueve o queda para que lo borre quien llama.
 */
export async function procesarAudio({ tmp, nombre, huella, subidaPor = null, log }) {
  const repetida = await db.query('SELECT id, titulo, artista FROM canciones WHERE sha256 = $1', [huella]);
  if (repetida.rowCount) {
    const r = repetida.rows[0];
    return { codigo: 409, error: `Ya está subida: ${r.artista} – ${r.titulo}`, id: r.id };
  }

  let datos;
  try {
    datos = await leerDatos(tmp, nombre);
  } catch (e) {
    return { codigo: 400, error: e.message };
  }
  // Lo que el admin ya decidió sobre este artista: "Alvaro Diaz & Feid" → "Alvaro Diaz – … (con Feid)",
  // "Alvaro Diaz" → "Álvaro Díaz" (ver artistas.js y la pestaña Artistas del panel).
  await aplicarDecisiones(datos).catch((e) => log.warn({ err: e.message }, 'artistas: no se pudieron aplicar las decisiones'));

  // La misma canción ya subida (aunque sea de otro álbum, dure distinto, o sea una copia "Thriller1"; el artista
  // escrito "A, B" o "A y B" da igual): se rechaza y no se guarda nada. Las versiones distintas (remix, en vivo,
  // "con X", "feat."…) y las colaboraciones con otra persona sí entran. Ver repetidas.js.
  const clave = claveRepetida(datos.artista, datos.titulo);
  if (clave) {
    const iguales = await db.query('SELECT id, titulo, artista, album, duracion, pista FROM canciones');
    const nueva = { titulo: datos.titulo, album: datos.album, duracion: datos.duracion, pista: datos.pista };
    const misma = iguales.rows.find((c) => {
      const k = claveRepetida(c.artista, c.titulo);
      if (!k) return false;
      if (k === clave) return mismaCancion(nueva, c);
      return esCopia(clave, k, datos.duracion, c.duracion) || esCopia(k, clave, c.duracion, datos.duracion);
    });
    if (misma) return { codigo: 409, error: `Ya está subida: ${misma.artista} – ${misma.titulo}`, id: misma.id };
  }
  const id = nuevoId();
  const plan = planAudio(datos);
  const archivo = `${id}.${plan.formato}`;
  const portada = datos.tienePortada ? await sacarPortada(tmp, portadas()) : null;
  const formatoOriginal = nombreFormato(nombre, datos);
  let original = null;
  if (plan.args) {
    try {
      await convertirAudio(tmp, join(musica(), archivo), plan, datos.etiquetasEnPista);
    } catch (e) {
      await rm(join(musica(), archivo), { force: true });
      log.error({ err: e.message }, 'no se pudo convertir');
      return { codigo: 400, error: `No se pudo convertir el ${formatoOriginal.toUpperCase()}` };
    }
    original = `${id}.${formatoOriginal}`;
    await rename(tmp, join(originales(), original)); // el archivo subido queda guardado igual
  } else {
    await rename(tmp, join(musica(), archivo));
    // Listo para streaming: sin carátula incrustada / con el índice al principio (no cambia el sonido).
    await aligerar(join(musica(), archivo), plan.formato).catch((e) => log.warn({ err: e.message }, 'no se pudo aligerar'));
  }
  const servido = (await stat(join(musica(), archivo))).size;
  await db.query(
    `INSERT INTO canciones (id, archivo, sha256, titulo, artista, album, artista_album, anio, generos, pista, duracion, bitrate,
                            tamano, portada, subida_por, nombre_original, formato, formato_original, original, mudar)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, archivo, huella, datos.titulo, datos.artista, datos.album, datos.artistaAlbum, datos.anio, datos.generos, datos.pista,
     datos.duracion, datos.bitrate, servido, portada, subidaPor, nombre, plan.formato,
     formatoOriginal === plan.formato ? null : formatoOriginal, original, wifiActivo()],
  );
  await db.query('INSERT INTO analisis (cancion_id) VALUES ($1)', [id]);
  avisarCola();
  avisarVibra();
  avisarLastfm();
  avisarAnioOriginal();
  avisarMudanza();
  avisarCategorias();
  avisarFaltantes(); // playlists importadas que esperaban esta canción
  log.info({ cancion: `${datos.artista} – ${datos.titulo}`, formato: `${formatoOriginal} → ${plan.formato} (${plan.modo})` }, 'canción subida');
  const r = await db.query(`SELECT ${CAMPOS} FROM canciones c LEFT JOIN analisis a ON a.cancion_id = c.id WHERE c.id = $1`, [id]);
  return { cancion: r.rows[0] };
}

/** Carpeta temporal del servidor (misma unidad que la música, para mover sin copiar). */
export { temporal, nuevoId };

export default async function rutasMusica(app) {
  await mkdir(musica(), { recursive: true });
  await mkdir(portadas(), { recursive: true });
  await mkdir(temporal(), { recursive: true });
  await mkdir(originales(), { recursive: true });

  // ---------------- Subir (solo admin) ----------------

  /**
   * Sube UN archivo de audio (el panel manda de a uno, con su barra de progreso).
   * MP3, M4A y FLAC se guardan tal cual; los demás se preparan para que suenen en todos lados (ver planAudio).
   * Si ya existe el mismo archivo, avisa y no lo duplica.
   */
  app.post('/api/admin/canciones', { preHandler: requiereAdmin }, async (req, reply) => {
    const parte = await req.file({ limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });
    if (!parte) return reply.code(400).send({ error: 'Falta el archivo' });
    const nombre = parte.filename || 'cancion.mp3';
    const tmp = join(temporal(), `${nuevoId()}.part`);
    const sha = createHash('sha256');
    let tamano = 0;
    try {
      parte.file.on('data', (b) => {
        sha.update(b);
        tamano += b.length;
      });
      await pipeline(parte.file, createWriteStream(tmp));
      if (parte.file.truncated) return reply.code(413).send({ error: `El archivo pasa de ${MAX_MB} MB` });
      const r = await procesarAudio({ tmp, nombre, huella: sha.digest('hex'), subidaPor: req.usuario.id, log: req.log });
      if (r.error) return reply.code(r.codigo).send({ error: r.error, id: r.id });
      return r.cancion;
    } finally {
      await rm(tmp, { force: true });
    }
  });

  // Corregir datos de una canción (título, artista, álbum, año, géneros).
  app.patch('/api/admin/canciones/:id', { preHandler: requiereAdmin }, async (req, reply) => {
    const b = req.body ?? {};
    const texto = (v, max = 200) => (v === undefined ? undefined : String(v).trim().slice(0, max) || null);
    const cambios = {
      titulo: texto(b.titulo),
      artista: texto(b.artista),
      album: texto(b.album),
      artista_album: texto(b.artistaAlbum),
      anio: b.anio === undefined ? undefined : Number(b.anio) > 1000 && Number(b.anio) < 3000 ? Math.round(Number(b.anio)) : null,
      generos: b.generos === undefined ? undefined : (Array.isArray(b.generos) ? b.generos : String(b.generos).split(','))
        .map((g) => String(g).trim()).filter(Boolean).slice(0, 10),
      // Categorías especiales (meme / anime / OST de videojuego): solo las conocidas.
      categorias: !Array.isArray(b.categorias) ? undefined : [...new Set(b.categorias.map(String))].filter((x) => CATEGORIAS.includes(x)),
    };
    if (cambios.titulo === null || cambios.artista === null) return reply.code(400).send({ error: 'El título y el artista no pueden quedar vacíos' });
    const sets = [];
    const vals = [req.params.id];
    for (const [k, v] of Object.entries(cambios)) {
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${k} = $${vals.length}`);
    }
    if (!sets.length) return reply.code(400).send({ error: 'Nada que cambiar' });
    // Las categorías cambian la radio y los mixes: el catálogo de recomendaciones se rehace (datos_revisado).
    if (cambios.categorias !== undefined) sets.push('datos_revisado = now()');
    // Lo que corregiste a mano deja de contar como "completado desde MusicBrainz".
    vals.push(Object.keys(cambios).filter((k) => cambios[k] !== undefined && k !== 'categorias'));
    sets.push(`mb_completado = array(SELECT unnest(mb_completado) EXCEPT SELECT unnest($${vals.length}::text[]))`);
    const r = await db.query(`UPDATE canciones SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    lista = null; // la lista guardada para la app ya no está al día
    if (cambios.categorias?.length) avisarCategorias(); // sugiere el resto del álbum o del artista
    if (cambios.titulo || cambios.artista) avisarFaltantes(); // con el nombre corregido puede calzar con una que faltaba
    const q = await db.query(`SELECT ${CAMPOS} FROM canciones c LEFT JOIN analisis a ON a.cancion_id = c.id WHERE c.id = $1`, [req.params.id]);
    return q.rows[0];
  });

  /**
   * Cambiar la carátula: { imagen: "<base64 JPG/PNG/WebP>", album: true|false }.
   * Con album: true se pone a todas las canciones del mismo álbum (mismo álbum y mismo artista del álbum o artista).
   * La imagen se rehace como JPG (máx. 600 px, sin datos ocultos); la carátula vieja se borra si ya nadie la usa.
   */
  app.post('/api/admin/canciones/:id/portada', { preHandler: requiereAdmin, bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const datos = Buffer.from(String(req.body?.imagen ?? '').replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
    if (!datos.length || datos.length > 10 * 1024 * 1024) return reply.code(400).send({ error: 'La imagen tiene que pesar menos de 10 MB' });
    if (!esImagen(datos)) return reply.code(400).send({ error: 'Ese archivo no es una imagen (JPG, PNG o WebP)' });
    const c = await db.query('SELECT album, coalesce(artista_album, artista) AS dueno FROM canciones WHERE id = $1', [req.params.id]);
    if (!c.rowCount) return reply.code(404).send({ error: 'No existe' });
    await mkdir(portadas(), { recursive: true });
    const archivo = await guardarImagen(datos, portadas());
    if (!archivo) return reply.code(400).send({ error: 'No se pudo leer la imagen' });
    const todoAlbum = req.body?.album === true && !!c.rows[0].album;
    const ids = todoAlbum
      ? (await db.query(
          `SELECT id FROM canciones WHERE lower(album) = lower($1) AND lower(coalesce(artista_album, artista)) = lower($2)`,
          [c.rows[0].album, c.rows[0].dueno],
        )).rows.map((x) => x.id)
      : [req.params.id];
    const antes = (await db.query('SELECT DISTINCT portada FROM canciones WHERE id = ANY($1) AND portada IS NOT NULL', [ids])).rows.map((x) => x.portada);
    const r = await db.query('UPDATE canciones SET portada = $2, datos_revisado = now() WHERE id = ANY($1)', [ids, archivo]);
    // Carátulas que quedaron sin usar.
    for (const p of antes) {
      if (p === archivo || !/^[a-f0-9]{24}\.jpg$/.test(p)) continue;
      const otra = await db.query('SELECT 1 FROM canciones WHERE portada = $1 LIMIT 1', [p]);
      if (!otra.rowCount) await rm(join(portadas(), p), { force: true });
    }
    lista = null;
    req.log.info({ cancion: req.params.id, portada: archivo, canciones: r.rowCount }, 'carátula cambiada a mano');
    return { portada: archivo, canciones: r.rowCount };
  });

  // Volver a analizar (por ejemplo, si falló).
  app.post('/api/admin/canciones/:id/analizar', { preHandler: requiereAdmin }, async (req) => {
    await db.query(`UPDATE analisis SET estado = 'pendiente', error = NULL WHERE cancion_id = $1`, [req.params.id]);
    await db.query(`UPDATE canciones SET datos_estado = 'pendiente' WHERE id = $1`, [req.params.id]);
    avisarCola();
    return { ok: true };
  });

  // Borrar una canción del servidor (el archivo y sus datos). Se quita también de playlists y me gusta.
  app.delete('/api/admin/canciones/:id', { preHandler: requiereAdmin }, async (req, reply) => {
    const r = await db.query('DELETE FROM canciones WHERE id = $1 RETURNING archivo, portada, original, almacen', [req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    const clave = `s:${req.params.id}`;
    await db.query('DELETE FROM valoraciones WHERE cancion = $1', [clave]);
    await db.query('DELETE FROM playlist_canciones WHERE cancion = $1', [clave]);
    if (r.rows[0].almacen === 'wifi') await borrarDeWifi(r.rows[0]);
    else {
      await rm(join(musica(), r.rows[0].archivo), { force: true });
      if (r.rows[0].original) await rm(join(originales(), r.rows[0].original), { force: true });
    }
    const p = r.rows[0].portada;
    if (p) {
      const otra = await db.query('SELECT 1 FROM canciones WHERE portada = $1 LIMIT 1', [p]);
      if (!otra.rowCount) await rm(join(portadas(), p), { force: true });
    }
    return { ok: true };
  });

  /**
   * Borrar TODAS las canciones del servidor: archivos, originales, portadas y sus datos. Se quitan también de
   * los "me gusta" y playlists de todos. No se puede deshacer, por eso hay que mandar confirmar: 'BORRAR'.
   */
  app.delete('/api/admin/canciones', { preHandler: requiereAdmin }, async (req, reply) => {
    // Solo la cuenta de admin "zuih" (el dueño) puede vaciar la biblioteca.
    if (String(req.usuario.nombre ?? '').trim().toLowerCase() !== 'zuih') return reply.code(403).send({ error: 'Solo el dueño puede hacer esto' });
    if (req.body?.confirmar !== 'BORRAR') return reply.code(400).send({ error: 'Falta confirmar' });
    const c = await db.connect();
    let n = 0;
    try {
      await c.query('BEGIN');
      const enWifi = await c.query(`SELECT archivo, original FROM canciones WHERE almacen = 'wifi'`);
      for (const w of enWifi.rows) {
        await c.query('INSERT INTO wifi_borrar (archivo) VALUES ($1) ON CONFLICT DO NOTHING', [w.archivo]);
        if (w.original) await c.query('INSERT INTO wifi_borrar (archivo) VALUES ($1) ON CONFLICT DO NOTHING', [`originales/${w.original}`]);
      }
      n = (await c.query('DELETE FROM canciones')).rowCount; // su análisis se borra con ellas
      await c.query("DELETE FROM valoraciones WHERE cancion LIKE 's:%'");
      await c.query("DELETE FROM playlist_canciones WHERE cancion LIKE 's:%'");
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    // Los archivos (no las carpetas).
    for (const dir of [musica(), originales(), portadas()]) {
      for (const f of await readdir(dir).catch(() => [])) await rm(join(dir, f), { force: true, recursive: true });
    }
    avisarMudanza(); // borra en wifi lo que estaba allá
    req.log.warn({ canciones: n }, 'el admin borró todas las canciones del servidor');
    return { ok: true, borradas: n };
  });

  app.get('/api/admin/canciones', { preHandler: requiereAdmin }, async () => {
    const r = await db.query(`SELECT ${CAMPOS} FROM canciones c LEFT JOIN analisis a ON a.cancion_id = c.id ORDER BY c.subida DESC`);
    const t = await db.query(`SELECT count(*)::int AS n, coalesce(sum(tamano), 0)::bigint AS bytes,
      count(*) FILTER (WHERE almacen = 'wifi')::int AS en_wifi, coalesce(sum(tamano) FILTER (WHERE almacen = 'wifi'), 0)::bigint AS bytes_wifi,
      count(*) FILTER (WHERE mudar AND almacen = 'vps')::int AS por_mudar FROM canciones`);
    // Espacio del disco donde está la música (libre y total), para el panel.
    const d = await statfs(musica()).catch(() => null);
    const disco = d ? { libre: d.bavail * d.bsize, total: d.blocks * d.bsize } : null;
    const w = await wifiEstado();
    const wifi = w && { ...w, canciones: t.rows[0].en_wifi, bytes: Number(t.rows[0].bytes_wifi), pendientes: t.rows[0].por_mudar };
    return { canciones: r.rows, total: t.rows[0].n, bytes: Number(t.rows[0].bytes), disco, wifi };
  });

  // ---------------- Escuchar (cualquier usuario con sesión) ----------------

  /**
   * La biblioteca del servidor, con el análisis listo para la app. Con miles de canciones son varios MB, así que:
   * - se arma una sola vez y se guarda ya comprimida (gzip: ~7 veces menos) hasta que cambie algo;
   * - lleva una huella (ETag): si la app ya la tiene igual, el servidor responde "sin cambios" sin mandar nada.
   */
  let lista = null; // { firma, etag, json, gz }
  let armandoLista = null;
  async function listaCanciones() {
    const f = await db.query(
      `SELECT count(*)::int AS n, coalesce(max(greatest(c.subida, c.datos_revisado, c.anio_revisado)), now())::text AS c,
              (SELECT count(*) FROM analisis WHERE estado = 'listo')::int AS a,
              (SELECT coalesce(max(revisado), now())::text FROM artistas_info) AS m
         FROM canciones c`,
    ).catch(() => db.query(`SELECT count(*)::int AS n, coalesce(max(subida), now())::text AS c,
              (SELECT count(*) FROM analisis WHERE estado = 'listo')::int AS a FROM canciones`));
    const firma = JSON.stringify(f.rows[0]);
    if (lista?.firma === firma) return lista;
    armandoLista ??= (async () => {
      try {
        const r = await db.query(
          `SELECT c.id, c.titulo, c.artista, c.album, c.artista_album, c.anio, c.generos, c.pista, c.duracion, c.tamano, c.portada,
                  c.formato, c.subida, c.creditos, c.mb_grabacion, c.mb_completado, a.ritmo, a.rasgos, a.lufs, a.pico
             FROM canciones c LEFT JOIN analisis a ON a.cancion_id = c.id
            ORDER BY c.subida`,
        );
        // Integrantes de los grupos (para el buscador): los del artista de la canción y los del álbum.
        const info = new Map((await db.query(`SELECT nombre, mb_artista, miembros FROM artistas_info WHERE estado = 'listo'`)).rows.map((x) => [x.nombre, x]));
        for (const c of r.rows) {
          const m = new Set([...integrantesDeTexto(c.artista, info), ...integrantesDeTexto(c.artista_album, info)]);
          if (m.size) c.miembros = [...m];
        }
        const json = Buffer.from(JSON.stringify(r.rows));
        const gz = await gzipAsync(json, { level: 6 });
        lista = { firma, etag: `"${createHash('sha1').update(json).digest('base64url')}"`, json, gz };
        return lista;
      } finally {
        armandoLista = null;
      }
    })();
    return armandoLista;
  }

  app.get('/api/canciones', { preHandler: requiereUsuario }, async (req, reply) => {
    const l = await listaCanciones();
    reply.header('ETag', l.etag).header('Cache-Control', 'private, no-cache').header('Vary', 'Accept-Encoding, Authorization');
    if (req.headers['if-none-match'] === l.etag) return reply.code(304).send();
    reply.type('application/json; charset=utf-8');
    if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) return reply.header('Content-Encoding', 'gzip').send(l.gz);
    return reply.send(l.json);
  });

  /** El audio (MP3, M4A o FLAC), con soporte para pedir trozos (Range): así se puede adelantar sin bajar todo. */
  /** Llave de audio de esta cuenta (ver `llaveDe`). */
  app.get('/api/audio/llave', { preHandler: requiereUsuario }, async (req) => {
    const u = String(req.usuario.id);
    const vence = Math.floor(Date.now() / 1000) + LLAVE_S;
    return { u, v: vence, k: llaveDe(u, vence) };
  });

  /** Enlace firmado para escuchar una canción al instante (ver `firmar`). */
  app.get('/api/canciones/:id/firma', { preHandler: requiereUsuario }, async (req) => {
    const id = String(req.params.id);
    const vence = Math.floor(Date.now() / 1000) + VIGENCIA_S;
    const u = String(req.usuario.id);
    return { url: `/api/canciones/${encodeURIComponent(id)}/audio?u=${u}&v=${vence}&f=${firmar(id, u, vence)}`, vence: vence * 1000 };
  });

  app.get('/api/canciones/:id/audio', { preHandler: usuarioOFirma }, async (req, reply) => {
    const r = await db.query('SELECT archivo, formato, almacen FROM canciones WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    let ruta;
    try {
      ruta = await rutaAudio(r.rows[0]); // en el VPS, o traída del servidor de casa (wifi)
    } catch (e) {
      req.log.warn({ cancion: req.params.id, err: e.message }, 'audio no disponible');
      return reply.code(e.codigo ?? 500).header('Retry-After', '60').send({ error: e.message });
    }
    const { size } = await stat(ruta);
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', TIPOS[r.rows[0].formato] ?? 'audio/mpeg').header('Cache-Control', 'private, max-age=31536000, immutable');
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && (m[1] || m[2])) {
      let ini = m[1] ? Number(m[1]) : size - Number(m[2]);
      let fin = m[1] && m[2] ? Number(m[2]) : size - 1;
      ini = Math.max(0, ini);
      fin = Math.min(size - 1, fin);
      if (ini > fin) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      reply.code(206).header('Content-Range', `bytes ${ini}-${fin}/${size}`).header('Content-Length', fin - ini + 1);
      return reply.send(createReadStream(ruta, { start: ini, end: fin }));
    }
    reply.header('Content-Length', size);
    return reply.send(createReadStream(ruta));
  });

  /** Portadas (no son privadas: solo una imagen identificada por su huella). */
  app.get('/api/portadas/:archivo', async (req, reply) => {
    const archivo = String(req.params.archivo);
    if (!/^[a-f0-9]{24}\.jpg$/.test(archivo)) return reply.code(404).send();
    try {
      await stat(join(portadas(), archivo));
    } catch {
      return reply.code(404).send();
    }
    reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(join(portadas(), archivo)));
  });
}
