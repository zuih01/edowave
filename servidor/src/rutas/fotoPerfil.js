// Foto de perfil: la app la recorta (cuadrada) y la manda; el servidor la vuelve a hacer JPG de 256×256
// (así se borran los datos ocultos de la foto, como el GPS, y nunca se guarda lo que llegó tal cual).
// Un GIF animado llega entero con el recorte elegido (x, y, lado en píxeles) y se rehace como GIF de 256×256
// (máx. 10 s, 15 cuadros por segundo, sin metadatos): sigue moviéndose.
// Se guarda en biblioteca/fotos con el nombre de su huella; se ve igual en todos los aparatos.
// También aquí: la foto propia de una playlist (JPG de 600×600, en biblioteca/fotos-playlists).
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { db } from '../db.js';
import { requiereUsuario } from '../auth.js';

const run = promisify(execFile);
const fotos = () => join(process.env.MUSIC_DIR, '..', 'fotos');
const fotosPlaylists = () => join(process.env.MUSIC_DIR, '..', 'fotos-playlists');
const banners = () => join(process.env.MUSIC_DIR, '..', 'banners');
/** Banner del perfil: foto JPG de 1500×500 o GIF animado de hasta 960×320 (máx. 8 s), recortado al centro. */
const MAX_SALIDA_BANNER = 4 * 1024 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_GIF = 8 * 1024 * 1024;
/** GIF del banner: entra grande (se recorta a 8 s y 960×320, así que lo guardado pesa mucho menos). */
const MAX_GIF_BANNER = 15 * 1024 * 1024;
const MAX_SALIDA_GIF = 3 * 1024 * 1024;
const NOMBRE = /^[a-f0-9]{24}\.(jpg|gif)$/;
const NOMBRE_PL = /^[a-f0-9]{24}\.jpg$/;

/** ¿Es de verdad una imagen? (JPG, PNG o WebP, por sus primeros bytes, no por lo que diga el nombre) */
export function esImagen(b) {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true; // JPG
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'; // WebP
}

/** ¿Es un GIF? (por sus primeros bytes) */
export const esGif = (b) => b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'));

/** Número entero entre 0 y 20000 (las medidas del recorte de un GIF), o null. */
const entero = (v) => (Number.isInteger(v) && v >= 0 && v <= 20000 ? v : null);

/** Lo que manda la app: "data:image/…;base64,…" o base64 solo. */
const decodificar = (v) => Buffer.from(String(v ?? '').replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');

/** Imagen cuadrada (recorta al centro), sin metadatos, como JPG de `lado` px. Devuelve el nombre del archivo. */
async function aJpgCuadrado(datos, dir, lado) {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  const salida = `${tmp}.jpg`;
  try {
    await writeFile(tmp, datos);
    await run(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', tmp, '-frames:v', '1', '-vf', `scale=${lado}:${lado}:force_original_aspect_ratio=increase,crop=${lado}:${lado}`, '-map_metadata', '-1', '-q:v', '3', salida],
      { timeout: 20_000 },
    );
    const jpg = await readFile(salida);
    const archivo = `${createHash('sha256').update(jpg).digest('hex').slice(0, 24)}.jpg`;
    await rename(salida, join(dir, archivo));
    return archivo;
  } finally {
    await rm(tmp, { force: true });
    await rm(salida, { force: true });
  }
}

/** GIF animado: el recorte elegido (o el centro), 256×256, máx. 10 s a 15 cuadros/s, sin metadatos. */
async function aGifCuadrado(datos, dir, recorte) {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  const salida = `${tmp}.gif`;
  const x = entero(recorte?.x) ?? 0;
  const y = entero(recorte?.y) ?? 0;
  const l = entero(recorte?.lado);
  // Las medidas ya son enteros validados (nada de texto del usuario llega a ffmpeg); ffmpeg las acota al tamaño real.
  const corte = l
    ? `crop=w='min(${l},min(iw,ih))':h='min(${l},min(iw,ih))':x='min(${x},iw-ow)':y='min(${y},ih-oh)'`
    : `crop=w='min(iw,ih)':h='min(iw,ih)'`;
  try {
    await writeFile(tmp, datos);
    await run(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', tmp, '-t', '10', '-filter_complex', `[0:v]${corte},scale=256:256:flags=lanczos,fps=15,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse`, '-loop', '0', '-map_metadata', '-1', salida],
      { timeout: 60_000 },
    );
    const gif = await readFile(salida);
    if (gif.length > MAX_SALIDA_GIF) throw Object.assign(new Error('pesado'), { pesado: true });
    const archivo = `${createHash('sha256').update(gif).digest('hex').slice(0, 24)}.gif`;
    await rename(salida, join(dir, archivo));
    return archivo;
  } finally {
    await rm(tmp, { force: true });
    await rm(salida, { force: true });
  }
}

/**
 * Banner (3:1, recortado al centro), sin metadatos: JPG de 1500×500 o GIF animado de hasta 960×320.
 * El GIF no se agranda: uno chico queda en su tamaño (agrandarlo lo hacía pesar 3 veces más y tardar un minuto).
 */
async function aBanner(datos, gif) {
  const dir = banners();
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`);
  const salida = `${tmp}.${gif ? 'gif' : 'jpg'}`;
  const encuadre = gif
    ? `crop=w='min(iw,ih*3)':h='min(iw,ih*3)/3',scale=w='min(960,iw)':h=-1:flags=lanczos`
    : `scale=1500:500:force_original_aspect_ratio=increase:flags=lanczos,crop=1500:500`;
  try {
    await writeFile(tmp, datos);
    const gifCon = (fps, colores) => ['-v', 'error', '-y', '-i', tmp, '-t', '8', '-filter_complex', `[0:v]${encuadre},fps=${fps},split[a][b];[a]palettegen=max_colors=${colores}[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', '-map_metadata', '-1', salida];
    const args = gif ? gifCon(12, 128) : ['-v', 'error', '-y', '-i', tmp, '-frames:v', '1', '-vf', encuadre, '-map_metadata', '-1', '-q:v', '3', salida];
    await run('ffmpeg', args, { timeout: gif ? 45_000 : 20_000 }); // Cloudflare corta a los 100 s: los 2 intentos caben
    let out = await readFile(salida);
    // Un GIF con mucho movimiento puede quedar pesado: se reintenta una vez con menos cuadros y colores.
    if (gif && out.length > MAX_SALIDA_BANNER) {
      await run('ffmpeg', gifCon(10, 64), { timeout: 45_000 });
      out = await readFile(salida);
    }
    if (out.length > MAX_SALIDA_BANNER) throw Object.assign(new Error('pesado'), { pesado: true });
    const archivo = `${createHash('sha256').update(out).digest('hex').slice(0, 24)}.${gif ? 'gif' : 'jpg'}`;
    await rename(salida, join(dir, archivo));
    return archivo;
  } finally {
    await rm(tmp, { force: true });
    await rm(salida, { force: true });
  }
}

/** Borra el archivo de un banner si ya nadie lo usa. */
async function borrarBannerSiSobra(archivo) {
  if (!archivo || !NOMBRE.test(archivo)) return;
  const r = await db.query('SELECT 1 FROM usuarios WHERE banner = $1 LIMIT 1', [archivo]);
  if (!r.rowCount) await rm(join(banners(), archivo), { force: true });
}

/** Borra el archivo de una foto si ya nadie la usa. */
async function borrarSiSobra(archivo) {
  if (!archivo || !NOMBRE.test(archivo)) return;
  const r = await db.query('SELECT 1 FROM usuarios WHERE foto = $1 LIMIT 1', [archivo]);
  if (!r.rowCount) await rm(join(fotos(), archivo), { force: true });
}

/** Borra el archivo de una foto de playlist si ya ninguna la usa. */
async function borrarFotoPlaylistSiSobra(archivo) {
  if (!archivo || !NOMBRE_PL.test(archivo)) return;
  const r = await db.query('SELECT 1 FROM playlists WHERE foto = $1 LIMIT 1', [archivo]);
  if (!r.rowCount) await rm(join(fotosPlaylists(), archivo), { force: true });
}

/** Manda una imagen guardada (no es privada: solo se llega con el nombre, que es su huella). */
async function mandarImagen(reply, dir, archivo) {
  try {
    await stat(join(dir, archivo));
  } catch {
    return reply.code(404).send();
  }
  reply.header('Content-Type', archivo.endsWith('.gif') ? 'image/gif' : 'image/jpeg').header('Cache-Control', 'public, max-age=31536000, immutable');
  return reply.send(createReadStream(join(dir, archivo)));
}

export function rutasFoto(app) {
  /** Subir (o cambiar) mi foto: { imagen: "<base64>" } (un GIF trae además recorte: { x, y, lado } en píxeles). */
  app.post('/api/foto', { preHandler: requiereUsuario, bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const datos = decodificar(req.body?.imagen);
    const gif = esGif(datos);
    if (!datos.length || datos.length > (gif ? MAX_GIF : MAX_BYTES)) {
      return reply.code(400).send({ error: gif ? 'El GIF tiene que pesar menos de 8 MB' : 'La imagen tiene que pesar menos de 5 MB' });
    }
    if (!gif && !esImagen(datos)) return reply.code(400).send({ error: 'Ese archivo no es una imagen (JPG, PNG, WebP o GIF)' });
    let archivo;
    try {
      archivo = gif ? await aGifCuadrado(datos, fotos(), req.body?.recorte) : await aJpgCuadrado(datos, fotos(), 256);
    } catch (e) {
      if (e.pesado) return reply.code(400).send({ error: 'Ese GIF queda muy pesado. Prueba uno más corto.' });
      return reply.code(400).send({ error: 'No se pudo leer la imagen' });
    }
    const antes = await db.query('SELECT foto FROM usuarios WHERE id = $1', [req.usuario.id]);
    await db.query('UPDATE usuarios SET foto = $2 WHERE id = $1', [req.usuario.id, archivo]);
    if (antes.rows[0]?.foto !== archivo) await borrarSiSobra(antes.rows[0]?.foto);
    req.log.info({ usuario: req.usuario.nombre, gif }, 'foto de perfil cambiada');
    return { foto: archivo };
  });

  /** Quitar mi foto (vuelve la inicial). */
  app.delete('/api/foto', { preHandler: requiereUsuario }, async (req) => {
    const antes = await db.query('SELECT foto FROM usuarios WHERE id = $1', [req.usuario.id]);
    await db.query('UPDATE usuarios SET foto = NULL WHERE id = $1', [req.usuario.id]);
    await borrarSiSobra(antes.rows[0]?.foto);
    return { foto: null };
  });

  app.get('/api/fotos/:archivo', async (req, reply) => {
    const archivo = String(req.params.archivo);
    if (!NOMBRE.test(archivo)) return reply.code(404).send();
    return mandarImagen(reply, fotos(), archivo);
  });

  // ---------------- Banner del perfil ----------------

  /** Subir (o cambiar) mi banner: { imagen: "<base64>" } (JPG, PNG, WebP o GIF animado). */
  // 15 MB en base64 son unos 20 MB.
  app.post('/api/banner', { preHandler: requiereUsuario, bodyLimit: 22 * 1024 * 1024 }, async (req, reply) => {
    const datos = decodificar(req.body?.imagen);
    const gif = esGif(datos);
    if (!datos.length || datos.length > (gif ? MAX_GIF_BANNER : MAX_BYTES)) {
      return reply.code(400).send({ error: gif ? 'El GIF tiene que pesar menos de 15 MB' : 'La imagen tiene que pesar menos de 5 MB' });
    }
    if (!gif && !esImagen(datos)) return reply.code(400).send({ error: 'Ese archivo no es una imagen (JPG, PNG, WebP o GIF)' });
    let archivo;
    try {
      archivo = await aBanner(datos, gif);
    } catch (e) {
      if (e.pesado) return reply.code(400).send({ error: 'Ese GIF queda muy pesado. Prueba uno más corto o más simple.' });
      return reply.code(400).send({ error: 'No se pudo leer la imagen' });
    }
    const antes = await db.query('SELECT banner FROM usuarios WHERE id = $1', [req.usuario.id]);
    await db.query('UPDATE usuarios SET banner = $2 WHERE id = $1', [req.usuario.id, archivo]);
    if (antes.rows[0]?.banner !== archivo) await borrarBannerSiSobra(antes.rows[0]?.banner);
    req.log.info({ usuario: req.usuario.nombre, gif }, 'banner de perfil cambiado');
    return { banner: archivo };
  });

  /** Quitar mi banner (vuelve el color del perfil). */
  app.delete('/api/banner', { preHandler: requiereUsuario }, async (req) => {
    const antes = await db.query('SELECT banner FROM usuarios WHERE id = $1', [req.usuario.id]);
    await db.query('UPDATE usuarios SET banner = NULL WHERE id = $1', [req.usuario.id]);
    await borrarBannerSiSobra(antes.rows[0]?.banner);
    return { banner: null };
  });

  app.get('/api/banners/:archivo', async (req, reply) => {
    const archivo = String(req.params.archivo);
    if (!NOMBRE.test(archivo)) return reply.code(404).send();
    return mandarImagen(reply, banners(), archivo);
  });

  // ---------------- Foto propia de una playlist ----------------

  /** Poner (o cambiar) la foto de una playlist mía: { imagen: "<base64>" } (JPG, PNG, WebP o GIF; queda JPG). */
  app.post('/api/playlists/:id/foto', { preHandler: requiereUsuario, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const id = String(req.params.id);
    const mia = await db.query('SELECT foto FROM playlists WHERE id = $1 AND usuario_id = $2 AND NOT borrada', [id, req.usuario.id]);
    if (!mia.rowCount) return reply.code(404).send({ error: 'La playlist todavía no se guarda en tu cuenta. Espera unos segundos y vuelve a intentar.' });
    const datos = decodificar(req.body?.imagen);
    if (!datos.length || datos.length > MAX_BYTES) return reply.code(400).send({ error: 'La imagen tiene que pesar menos de 5 MB' });
    if (!esImagen(datos) && !esGif(datos)) return reply.code(400).send({ error: 'Ese archivo no es una imagen (JPG, PNG, WebP o GIF)' });
    let archivo;
    try {
      archivo = await aJpgCuadrado(datos, fotosPlaylists(), 600);
    } catch {
      return reply.code(400).send({ error: 'No se pudo leer la imagen' });
    }
    // También cambia `actualizada`: así los otros aparatos de la cuenta traen la foto al sincronizar.
    const u = await db.query('UPDATE playlists SET foto = $2, actualizada = now() WHERE id = $1 RETURNING actualizada', [id, archivo]);
    if (mia.rows[0].foto !== archivo) await borrarFotoPlaylistSiSobra(mia.rows[0].foto);
    return { foto: archivo, actualizada: new Date(u.rows[0].actualizada).getTime() };
  });

  /** Quitar la foto de una playlist mía (vuelve el mosaico de carátulas). */
  app.delete('/api/playlists/:id/foto', { preHandler: requiereUsuario }, async (req, reply) => {
    const id = String(req.params.id);
    const r = await db.query('SELECT foto FROM playlists WHERE id = $1 AND usuario_id = $2', [id, req.usuario.id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'No existe' });
    const u = await db.query('UPDATE playlists SET foto = NULL, actualizada = now() WHERE id = $1 RETURNING actualizada', [id]);
    await borrarFotoPlaylistSiSobra(r.rows[0].foto);
    return { foto: null, actualizada: new Date(u.rows[0].actualizada).getTime() };
  });

  app.get('/api/playlist-fotos/:archivo', async (req, reply) => {
    const archivo = String(req.params.archivo);
    if (!NOMBRE_PL.test(archivo)) return reply.code(404).send();
    return mandarImagen(reply, fotosPlaylists(), archivo);
  });
}
