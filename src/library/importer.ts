import { parseBlob } from 'music-metadata';
import { hasCover, hasTrack, saveTrack } from '../db';
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, type Track } from '../types';

export const SUPPORTED_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus'];

export interface ImportProgress {
  done: number;
  total: number;
  current?: string;
  added: number;
  skipped: number;
  failed: string[];
}

/** Hash rápido y estable (cyrb53). No usamos crypto.subtle porque no existe fuera de https/localhost. */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function isSupported(file: File) {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(file.name));
}

/**
 * Si el archivo no trae etiquetas, intentamos sacar artista y título del nombre:
 *   "01 - Artista - Título.mp3", "Artista - Título.mp3", "01. Título.mp3"
 */
export function guessFromFileName(fileName: string): { artist?: string; title: string; trackNo?: number } {
  let base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  let trackNo: number | undefined;
  const num = base.match(/^(\d{1,3})\s*[-.)]\s*/);
  if (num) {
    trackNo = parseInt(num[1], 10);
    base = base.slice(num[0].length);
  }
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), trackNo };
  }
  return { title: base, trackNo };
}

/** Duración exacta usando el decodificador del navegador (solo lee la cabecera, es casi instantáneo). */
function durationFromAudio(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let finished = false;
    const done = (d: number) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(Number.isFinite(d) ? d : 0);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 5000);
    audio.src = url;
  });
}

async function importOne(file: File): Promise<'added' | 'skipped'> {
  const id = hashString(`${file.name}|${file.size}`);
  if (await hasTrack(id)) return 'skipped';

  const guess = guessFromFileName(file.name);
  let meta: Awaited<ReturnType<typeof parseBlob>> | undefined;
  try {
    // Sin `duration: true`: esa opción recorre el archivo entero y es lentísima en mp3 largos.
    meta = await parseBlob(file, { skipPostHeaders: true });
  } catch {
    // Archivo sin etiquetas legibles: seguimos solo con el nombre.
  }
  const c = meta?.common;

  const artist = c?.artist?.trim() || c?.albumartist?.trim() || guess.artist || UNKNOWN_ARTIST;
  const album = c?.album?.trim() || UNKNOWN_ALBUM;
  const albumArtist = c?.albumartist?.trim() || artist;

  let cover: { id: string; blob: Blob } | undefined;
  let coverId: string | undefined;
  const pic = c?.picture?.[0];
  if (pic) {
    // Una portada por álbum; si la canción no tiene álbum, la portada es suya.
    coverId = album === UNKNOWN_ALBUM ? `t:${id}` : `a:${hashString(`${albumArtist}|${album}`.toLowerCase())}`;
    if (!(await hasCover(coverId))) {
      cover = { id: coverId, blob: new Blob([pic.data as BlobPart], { type: pic.format || 'image/jpeg' }) };
    }
  }

  const track: Track = {
    id,
    fileName: file.name,
    format: extensionOf(file.name),
    size: file.size,
    title: c?.title?.trim() || guess.title,
    artist,
    album,
    albumArtist,
    year: c?.year,
    genres: c?.genre?.flatMap((g) => g.split(/[;/,]/)).map((g) => g.trim()).filter(Boolean) ?? [],
    trackNo: c?.track?.no ?? guess.trackNo,
    duration: (await durationFromAudio(file)) || meta?.format.duration || 0,
    coverId,
    addedAt: Date.now(),
  };

  // Copiamos el audio a la base de datos de la app: así la biblioteca no depende de la carpeta original.
  await saveTrack(track, file, cover);
  return 'added';
}

export async function importFiles(files: File[], onProgress: (p: ImportProgress) => void): Promise<ImportProgress> {
  const audio = files.filter(isSupported);
  const p: ImportProgress = { done: 0, total: audio.length, added: 0, skipped: 0, failed: [] };
  onProgress({ ...p });
  for (const file of audio) {
    p.current = file.name;
    onProgress({ ...p });
    try {
      const r = await importOne(file);
      if (r === 'added') p.added++;
      else p.skipped++;
    } catch (e) {
      console.error('No se pudo importar', file.name, e);
      p.failed.push(file.name);
    }
    p.done++;
    onProgress({ ...p });
  }
  p.current = undefined;
  onProgress({ ...p });
  return p;
}
