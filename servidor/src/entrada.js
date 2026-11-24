// Carpeta de entrada: lo que se deja en ~/reproductor/entrada (por SFTP, scp, etc.) se agrega solo a la
// biblioteca, igual que si se subiera desde el panel. Se revisa cada minuto, de a un archivo por vez.
//   - Agregada        → el archivo sale de la carpeta (queda en la biblioteca).
//   - Ya estaba       → se mueve a entrada/ya-estaban/
//   - No se pudo      → se mueve a entrada/errores/ junto a un .txt con el motivo.
// Un archivo que todavía se está copiando (cambió de tamaño hace poco) se deja para la próxima vuelta.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { db } from './db.js';
import { nuevoId, procesarAudio, temporal } from './rutas/musica.js';

const EXT = /\.(mp3|m4a|aac|mp4|flac|wav|wave|aif|aiff|alac|ogg|oga|opus|wma|ac3|eac3|ape|wv|mka|amr|caf|dsf|mpc|tta|webm)$/i;
const CADA_MS = 60_000;
const QUIETO_MS = 30_000; // sin cambios hace al menos 30 s = terminó de copiarse
const APARTE = new Set(['errores', 'ya-estaban']);

export const carpetaEntrada = () => process.env.ENTRADA_DIR || join(process.env.MUSIC_DIR, '..', '..', 'entrada');

const huellaDe = (p) =>
  new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(p).on('data', (b) => h.update(b)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });

/** Mueve aunque sea a otro disco. */
async function mover(de, a) {
  try {
    await rename(de, a);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await copyFile(de, a);
    await rm(de, { force: true });
  }
}

/** Nombre libre dentro de `dir` (si ya existe "x.mp3", usa "x (2).mp3"). */
async function libre(dir, nombre) {
  const ext = extname(nombre);
  const base = basename(nombre, ext);
  for (let i = 1; ; i++) {
    const n = i === 1 ? nombre : `${base} (${i})${ext}`;
    try {
      await stat(join(dir, n));
    } catch {
      return join(dir, n);
    }
  }
}

async function* audios(dir, raiz = dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === raiz && APARTE.has(e.name)) continue;
      yield* audios(p, raiz);
    } else if (e.isFile() && EXT.test(e.name) && !e.name.startsWith('.')) yield p;
  }
}

let ocupado = false;
const tamanos = new Map(); // tamaño de cada archivo en la vuelta anterior
async function revisar(log) {
  if (ocupado) return;
  ocupado = true;
  const raiz = carpetaEntrada();
  try {
    let admin;
    for await (const p of audios(raiz)) {
      const s = await stat(p).catch(() => null);
      // Todavía se está copiando: cambió hace poco o su tamaño no es el de la vuelta anterior.
      const antes = tamanos.get(p);
      tamanos.set(p, s?.size);
      if (!s || Date.now() - s.mtimeMs < QUIETO_MS || antes !== s.size) continue;
      tamanos.delete(p);
      admin ??= (await db.query('SELECT id FROM usuarios WHERE es_admin ORDER BY id LIMIT 1')).rows[0]?.id ?? null;
      const nombre = basename(p);
      const rel = relative(raiz, p);
      const tmp = join(temporal(), `${nuevoId()}.part`);
      try {
        const huella = await huellaDe(p);
        await mover(p, tmp);
        const r = await procesarAudio({ tmp, nombre, huella, subidaPor: admin, log });
        if (r.codigo === 409) {
          await mover(tmp, await libre(join(raiz, 'ya-estaban'), nombre));
          log.info({ archivo: rel }, 'entrada: ya estaba en la biblioteca');
        } else if (r.error) {
          const destino = await libre(join(raiz, 'errores'), nombre);
          await mover(tmp, destino);
          await writeFile(`${destino}.error.txt`, `${r.error}\n`);
          log.warn({ archivo: rel, error: r.error }, 'entrada: no se pudo agregar');
        } else {
          log.info({ archivo: rel }, 'entrada: agregada');
        }
      } catch (e) {
        log.error({ archivo: rel, err: e.message }, 'entrada: error inesperado');
        // Si ya se había sacado de la carpeta, vuelve a errores para no perderlo.
        const quedo = await stat(tmp).then(() => true, () => false);
        if (quedo) {
          const destino = await libre(join(raiz, 'errores'), nombre);
          await mover(tmp, destino).catch(() => {});
          await writeFile(`${destino}.error.txt`, `${e.message}\n`).catch(() => {});
        }
      } finally {
        await rm(tmp, { force: true });
      }
    }
  } finally {
    ocupado = false;
  }
}

export async function iniciarEntrada(log) {
  const raiz = carpetaEntrada();
  for (const d of [raiz, join(raiz, 'errores'), join(raiz, 'ya-estaban')]) await mkdir(d, { recursive: true });
  log.info({ carpeta: raiz }, 'carpeta de entrada lista');
  const vuelta = () => revisar(log).catch((e) => log.error({ err: e.message }, 'entrada: no se pudo revisar'));
  setTimeout(vuelta, 10_000);
  setInterval(vuelta, CADA_MS).unref();
}
