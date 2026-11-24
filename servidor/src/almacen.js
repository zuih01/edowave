// Servidor "wifi" (casa): guarda el audio de las canciones nuevas. El catálogo sigue entero en el VPS.
//
// - Una canción nueva se sube y procesa en el VPS como siempre (conversión, carátula, análisis, vibe).
//   Cuando termina, la mudanza la manda a wifi, comprueba la huella y recién ahí borra la copia del VPS.
//   Si wifi está apagado, se queda en el VPS y se manda cuando vuelva: no se pierde nada.
// - Al escuchar una canción de wifi, el VPS la baja a una caché (las más escuchadas quedan acá) y la sirve.
// - Wifi llega por un túnel SSH que abre la casa (servidor-wifi/reproductor-tunel.service): el VPS lo ve en
//   WIFI_URL (127.0.0.1:9107) y le habla con WIFI_CLAVE. Sin esas dos variables, todo queda en el VPS como antes.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db } from './db.js';

const URL_WIFI = process.env.WIFI_URL;
const CLAVE = process.env.WIFI_CLAVE;
export const wifiActivo = () => Boolean(URL_WIFI && CLAVE);

const musica = () => process.env.MUSIC_DIR;
const originales = () => join(musica(), '..', 'originales');
const cache = () => join(musica(), '..', 'cache-wifi');
const tmp = () => join(musica(), '..', 'tmp');
const CACHE_MAX = Number(process.env.WIFI_CACHE_GB ?? 3) * 1024 ** 3;

const cab = (extra = {}) => ({ Authorization: `Bearer ${CLAVE}`, ...extra });
const url = (nombre) => `${URL_WIFI}/a/${nombre.split('/').map(encodeURIComponent).join('/')}`;

async function huellaDe(ruta) {
  const h = createHash('sha256');
  await pipeline(createReadStream(ruta), h);
  return h.digest('hex');
}

// ---------------- Estado (para el panel) ----------------
let estado = null; // { t, valor }
export async function wifiEstado() {
  if (!wifiActivo()) return null;
  if (estado && Date.now() - estado.t < 15_000) return estado.valor;
  let valor;
  try {
    const r = await fetch(`${URL_WIFI}/estado`, { headers: cab(), signal: AbortSignal.timeout(3000) });
    valor = r.ok ? { conectado: true, ...(await r.json()) } : { conectado: false };
  } catch {
    valor = { conectado: false };
  }
  estado = { t: Date.now(), valor };
  return valor;
}

// ---------------- Operaciones con wifi ----------------
async function subir(nombre, ruta) {
  const sha256 = await huellaDe(ruta);
  const { size } = await stat(ruta);
  const r = await fetch(url(nombre), {
    method: 'PUT',
    headers: cab({ 'X-Sha256': sha256, 'Content-Length': String(size), 'Content-Type': 'application/octet-stream' }),
    body: Readable.toWeb(createReadStream(ruta)),
    duplex: 'half',
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok || res.sha256 !== sha256 || res.tamano !== size) throw new Error(`wifi no guardó ${nombre}: ${res.error ?? r.status}`);
}

export async function wifiBorrar(nombre) {
  try {
    const r = await fetch(url(nombre), { method: 'DELETE', headers: cab(), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    // Wifi apagado: se anota y la mudanza lo reintenta.
    await db.query('INSERT INTO wifi_borrar (archivo) VALUES ($1) ON CONFLICT DO NOTHING', [nombre]);
  }
}

/** Borra los archivos de una canción que ya no existe (en wifi y en la caché). */
export async function borrarDeWifi({ archivo, original }) {
  await rm(join(cache(), archivo), { force: true });
  await wifiBorrar(archivo);
  if (original) await wifiBorrar(`originales/${original}`);
}

// ---------------- Caché del VPS ----------------
const bajando = new Map(); // archivo → promesa (dos personas pidiendo la misma canción bajan una sola vez)

async function bajar(archivo, destino = join(cache(), archivo)) {
  const parcial = join(tmp(), `wifi-${randomBytes(6).toString('hex')}`);
  try {
    const r = await fetch(url(archivo), { headers: cab(), signal: AbortSignal.timeout(2 * 60_000) });
    if (!r.ok) throw new Error(`wifi respondió ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(parcial));
    const largo = Number(r.headers.get('content-length'));
    if (largo && (await stat(parcial)).size !== largo) throw new Error('llegó incompleta');
    await rename(parcial, destino);
  } catch (e) {
    await rm(parcial, { force: true });
    throw e;
  }
  void limpiarCache();
  return destino;
}

/** Copia temporal de un archivo de wifi (para analizarlo); quien la pide la borra al terminar. */
export async function copiaTemporal(archivo) {
  return bajar(archivo, join(tmp(), `analizar-${randomBytes(6).toString('hex')}-${archivo}`));
}

let limpiando = false;
async function limpiarCache() {
  if (limpiando) return;
  limpiando = true;
  try {
    const dir = cache();
    const archivos = [];
    for (const f of await readdir(dir)) {
      const s = await stat(join(dir, f)).catch(() => null);
      if (s) archivos.push({ f, size: s.size, t: s.mtimeMs });
    }
    let total = archivos.reduce((s, a) => s + a.size, 0);
    archivos.sort((a, b) => a.t - b.t); // lo menos escuchado hace más tiempo, primero afuera
    for (const a of archivos) {
      if (total <= CACHE_MAX) break;
      await rm(join(dir, a.f), { force: true });
      total -= a.size;
    }
  } finally {
    limpiando = false;
  }
}

/**
 * Ruta local del audio de una canción ({ archivo, almacen }): en el VPS, o en la caché (bajándola de wifi si
 * hace falta). Si wifi no está, lanza un error con codigo 503.
 */
export async function rutaAudio(c) {
  if (c.almacen !== 'wifi') return join(musica(), c.archivo);
  const enCache = join(cache(), c.archivo);
  try {
    await stat(enCache);
    const ahora = new Date();
    await utimes(enCache, ahora, ahora).catch(() => {}); // recién escuchada: queda al final de la fila
    return enCache;
  } catch {}
  if (!wifiActivo()) throw Object.assign(new Error('wifi no configurado'), { codigo: 503 });
  let p = bajando.get(c.archivo);
  if (!p) {
    p = bajar(c.archivo).finally(() => bajando.delete(c.archivo));
    bajando.set(c.archivo, p);
  }
  try {
    return await p;
  } catch (e) {
    throw Object.assign(new Error(`La canción está en el servidor de casa y no está disponible ahora (${e.message})`), { codigo: 503 });
  }
}

// ---------------- Mudanza VPS → wifi ----------------
let log = console;
let mudando = false;
let otraVuelta = false; // llegó un aviso mientras se mudaba: dar otra vuelta al terminar

async function mudar() {
  if (!wifiActivo()) return;
  if (mudando) {
    otraVuelta = true;
    return;
  }
  mudando = true;
  otraVuelta = false;
  try {
    if (!(await wifiEstado())?.conectado) return;
    // Borrados que quedaron pendientes porque wifi estaba apagado.
    for (const { archivo } of (await db.query('SELECT archivo FROM wifi_borrar LIMIT 200')).rows) {
      const r = await fetch(url(archivo), { method: 'DELETE', headers: cab(), signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (r?.ok) await db.query('DELETE FROM wifi_borrar WHERE archivo = $1', [archivo]);
    }
    for (;;) {
      // Lista para mudarse apenas termina su análisis (ritmo/volumen). El vibe, si todavía no está, se hace
      // después con una copia temporal traída de wifi (ver vibra.js).
      const r = await db.query(
        `SELECT c.id, c.archivo, c.original, c.titulo FROM canciones c
           JOIN analisis a ON a.cancion_id = c.id
          WHERE c.mudar AND c.almacen = 'vps' AND a.estado <> 'pendiente'
          ORDER BY c.subida LIMIT 1`,
      );
      const c = r.rows[0];
      if (!c) return;
      const ruta = join(musica(), c.archivo);
      try {
        await subir(c.archivo, ruta);
        if (c.original) await subir(`originales/${c.original}`, join(originales(), c.original));
      } catch (e) {
        log.warn({ cancion: c.titulo, err: e.message }, 'wifi: no se pudo mudar (se reintenta después)');
        return;
      }
      const u = await db.query(`UPDATE canciones SET almacen = 'wifi', mudar = false WHERE id = $1 AND almacen = 'vps'`, [c.id]);
      if (!u.rowCount) {
        // La borraron mientras se subía.
        await borrarDeWifi(c);
        continue;
      }
      // Ya está a salvo en wifi: se borra del VPS (sin dejar copia).
      await rm(ruta, { force: true });
      if (c.original) await rm(join(originales(), c.original), { force: true });
      log.info({ cancion: c.titulo }, 'wifi: canción guardada en el servidor de casa (borrada del VPS)');
    }
  } catch (e) {
    log.error({ err: e.message }, 'wifi: error en la mudanza');
  } finally {
    mudando = false;
    if (otraVuelta) setImmediate(() => void mudar());
  }
}

export function avisarMudanza() {
  setImmediate(() => void mudar());
}

export async function iniciarAlmacen(logger) {
  log = logger;
  await mkdir(cache(), { recursive: true });
  if (!wifiActivo()) return log.info('wifi: sin WIFI_URL/WIFI_CLAVE (todo se guarda en el VPS)');
  setTimeout(() => void mudar(), 30_000);
  setInterval(() => void mudar(), 60_000).unref();
}
