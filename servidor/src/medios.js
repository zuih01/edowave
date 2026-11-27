import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Lo que ffprobe sabe del archivo: formato, duración, bitrate y etiquetas (ID3, Vorbis, MP4, WMA…).
 * Sirve cualquier formato de audio que ffmpeg entienda. Lanza un error si no tiene audio.
 */
export async function leerDatos(ruta, nombreOriginal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ruta], { maxBuffer: 8 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  const fmt = info.format ?? {};
  const audio = (info.streams ?? []).find((s) => s.codec_type === 'audio');
  if (!audio) throw new Error('No es un archivo de audio');
  const duracion = Number(fmt.duration ?? audio.duration);
  if (!(duracion > 1)) throw new Error('No se pudo leer la duración');

  // Etiquetas (sin importar mayúsculas: TITLE, title…)
  const tags = {};
  for (const [k, v] of Object.entries({ ...(audio.tags ?? {}), ...(fmt.tags ?? {}) })) tags[k.toLowerCase()] = String(v).trim();

  // Sin etiquetas: "Artista - Título.mp3"
  const base = basename(nombreOriginal ?? ruta, extname(nombreOriginal ?? ruta)).replace(/_/g, ' ').trim();
  const partes = base.split(' - ');
  const artistaArchivo = partes.length > 1 ? partes[0].trim() : null;
  const tituloArchivo = partes.length > 1 ? partes.slice(1).join(' - ').trim() : base;

  const anio = parseInt((tags.date ?? tags.year ?? tags.tyer ?? '').slice(0, 4), 10);
  const pista = parseInt(tags.track ?? '', 10);
  const generos = (tags.genre ?? '')
    .split(/[;/,]| \| /)
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    titulo: tags.title || tituloArchivo || 'Sin título',
    artista: tags.artist || artistaArchivo || 'Artista desconocido',
    album: tags.album || null,
    artistaAlbum: tags.album_artist || tags['album artist'] || null,
    anio: anio > 1000 && anio < 3000 ? anio : null,
    pista: pista > 0 ? pista : null,
    generos,
    duracion,
    bitrate: Math.round(Number(fmt.bit_rate ?? audio.bit_rate ?? 0) / 1000) || null,
    tienePortada: (info.streams ?? []).some((s) => s.codec_type === 'video'),
    codec: audio.codec_name ?? '',
    contenedor: fmt.format_name ?? '',
    // OGG/Opus guardan las etiquetas en la pista de audio, no en el archivo
    etiquetasEnPista: !Object.keys(fmt.tags ?? {}).length && !!Object.keys(audio.tags ?? {}).length,
    // Artista y título salieron del nombre "A - B" (sin etiquetas): quien sube puede orientarlo (ver orientarNombre).
    desdeNombre: !tags.title && !tags.artist && partes.length > 1,
    partesNombre: partes.map((p) => p.trim()).filter(Boolean),
  };
}

/**
 * Saca la portada incrustada en el MP3 y la guarda como JPG de hasta 600 px.
 * Devuelve la huella del JPG (las canciones del mismo álbum comparten el archivo) o null.
 */
export async function sacarPortada(ruta, carpeta) {
  const tmp = `${carpeta}/.tmp-${process.pid}-${Date.now()}.jpg`;
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', ruta, '-map', '0:v:0', '-frames:v', '1', '-vf', "scale='min(600,iw)':-2", '-q:v', '3', tmp]);
    const datos = await readFile(tmp);
    const id = createHash('sha256').update(datos).digest('hex').slice(0, 24);
    await rename(tmp, `${carpeta}/${id}.jpg`);
    return `${id}.jpg`;
  } catch {
    await rm(tmp, { force: true });
    return null;
  }
}

/**
 * Decodifica la canción completa a mono, 22 050 Hz (lo que usan los análisis).
 * @returns {Promise<Float32Array>}
 */
export function decodificarMono(ruta, hz = 22050) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', ruta, '-ac', '1', '-ar', String(hz), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const trozos = [];
    let err = '';
    p.stdout.on('data', (b) => trozos.push(b));
    p.stderr.on('data', (b) => (err += b));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffmpeg terminó con ${code}`));
      const buf = Buffer.concat(trozos);
      const out = new Float32Array(buf.length >> 2);
      new Uint8Array(out.buffer).set(buf.subarray(0, out.length * 4));
      resolve(out);
    });
  });
}

/**
 * Volumen según la norma EBU R128 / ITU-R BS.1770 (la misma que usa el nivelador de la app):
 * sonoridad integrada (LUFS) y pico de muestra (dBFS).
 */
export function medirVolumen(ruta) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-nostats', '-v', 'info', '-i', ruta, '-af', 'ebur128=peak=sample', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (b) => (err += b));
    p.on('error', reject);
    p.on('close', () => {
      const resumen = err.slice(err.lastIndexOf('Summary:'));
      const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(resumen)?.[1]);
      const pico = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(resumen)?.[1]);
      if (!Number.isFinite(lufs)) return reject(new Error('No se pudo medir el volumen'));
      resolve({ lufs, pico: Number.isFinite(pico) ? pico : -90 });
    });
  });
}

/** Guarda una imagen (por ejemplo, la portada de MusicBrainz) como JPG de hasta 600 px. Devuelve su nombre o null. */
export async function guardarImagen(datos, carpeta) {
  const entrada = `${carpeta}/.tmp-in-${process.pid}-${Date.now()}`;
  await writeFile(entrada, datos);
  try {
    return await sacarPortada(entrada, carpeta);
  } finally {
    await rm(entrada, { force: true });
  }
}

// ---------------- Formatos ----------------

/**
 * Qué hacer con el audio subido para que suene en el iPhone y en el PC:
 * - MP3, AAC (M4A) y FLAC: se guardan TAL CUAL (no se tocan).
 * - AAC suelto (.aac) o FLAC dentro de OGG: se reempaqueta sin tocar el sonido (M4A / FLAC).
 * - WAV, AIFF y ALAC: se pasan a FLAC, que es SIN PÉRDIDA (mismo sonido, la mitad de peso).
 * - El resto (WMA, OGG, Opus, AC3…): el iPhone no los lee, se convierten a MP3 320 kbps.
 */
export function planAudio({ codec, contenedor }) {
  const en = (re) => re.test(contenedor);
  if (codec === 'mp3' && en(/mp3/)) return { formato: 'mp3', modo: 'tal cual' };
  if (codec === 'aac' && en(/mp4|m4a|mov/)) return { formato: 'm4a', modo: 'tal cual' };
  if (codec === 'flac' && en(/^flac$/)) return { formato: 'flac', modo: 'tal cual' };
  if (codec === 'aac') return { formato: 'm4a', modo: 'reempaquetado', args: ['-c:a', 'copy', '-f', 'ipod'] };
  if (codec === 'flac') return { formato: 'flac', modo: 'reempaquetado', args: ['-c:a', 'copy', '-f', 'flac'] };
  if (codec.startsWith('pcm_') || codec === 'alac')
    return { formato: 'flac', modo: 'sin pérdida', args: ['-c:a', 'flac', '-compression_level', '8', '-f', 'flac'] };
  return { formato: 'mp3', modo: 'convertido', args: ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3', '-f', 'mp3'] };
}

export const TIPOS = { mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac' };

/** Convierte o reempaqueta el audio según el plan (con las etiquetas; la portada va aparte). */
export async function convertirAudio(entrada, salida, plan, etiquetasEnPista = false) {
  const meta = etiquetasEnPista ? '0:s:a:0' : '0';
  await run('ffmpeg', ['-v', 'error', '-y', '-i', entrada, '-map', '0:a:0', '-map_metadata', meta, '-vn', ...plan.args, salida], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
}

/** Nombre corto del formato como se subió: "wav", "wma", "ogg"… (para el panel). */
export function nombreFormato(nombreArchivo, { codec, contenedor }) {
  const ext = extname(nombreArchivo ?? '').slice(1).toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  return (contenedor.split(',')[0] || codec || 'audio').toLowerCase();
}

/**
 * Deja el archivo listo para STREAMING sin tocar el sonido (no se recodifica):
 * - MP3: saca la carátula incrustada (la app usa la que el servidor guarda aparte). Así el primer sonido está al
 *   principio del archivo y no detrás de cientos de KB de imagen.
 * - M4A: además pone el índice al principio (faststart), para que suene sin tener que pedir el final primero.
 * Devuelve true si el archivo cambió. Si algo falla, el archivo queda como estaba.
 */
export async function aligerar(ruta, formato) {
  if (formato !== 'mp3' && formato !== 'm4a') return false;
  if (formato === 'mp3') {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=index', '-of', 'csv=p=0', ruta]);
    if (!stdout.trim()) return false; // ya no trae carátula
  }
  const tmp = `${ruta}.ligero`;
  const args = formato === 'mp3' ? ['-id3v2_version', '3', '-f', 'mp3'] : ['-movflags', '+faststart', '-f', 'ipod'];
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', ruta, '-map', '0:a:0', '-map_metadata', '0', '-vn', '-c:a', 'copy', ...args, tmp], {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });
    await rename(tmp, ruta);
    return true;
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
