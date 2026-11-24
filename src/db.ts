import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { audioServidor, esDelServidor, esPortadaServidor, portadaServidor, rasgosServidor } from './server/biblioteca';
import type { Track } from './types';

/**
 * Base de datos local (IndexedDB). En el navegador y en Android (Capacitor) es la misma.
 * - tracks: metadatos de cada canción
 * - files:  el audio en bruto (copiado al importar)
 * - covers: portadas, compartidas entre canciones del mismo álbum
 */
interface MusicDB extends DBSchema {
  tracks: { key: string; value: Track; indexes: { byAddedAt: number } };
  files: { key: string; value: Blob };
  covers: { key: string; value: Blob };
  /** Cada vez que suena una canción: cuánto se escuchó y si se saltó. Base del algoritmo. */
  plays: { key: number; value: PlayEvent; indexes: { byTrack: string; byStartedAt: number } };
  /** Me gusta (1) / No me gusta (-1). */
  ratings: { key: string; value: Rating };
  /** Playlists que creas tú. */
  playlists: { key: string; value: Playlist };
  /** Rasgos del audio de cada canción (energía, ritmo…), medidos una vez en el teléfono. */
  features: { key: string; value: AudioFeatures };
}

export interface AudioFeatures {
  trackId: string;
  /** Volumen medio (dB, de -60 a 0): qué tan "fuerte" suena. */
  energy: number;
  /** Variación del volumen (dB): canciones con subidas y bajadas vs. parejas. */
  dynamics: number;
  /** Tempo estimado en pulsos por minuto. */
  bpm: number;
  /** Qué tan marcado es el pulso (0–1). */
  beat: number;
  /** Actividad: cuántos golpes/ataques tiene el sonido (no se confunde con el doble o la mitad del tempo). */
  activity: number;
  /** Brillo del sonido (más agudos / platillos → más alto). */
  brightness: number;
  /** Casi sin sonido (por ejemplo, archivos de prueba). */
  silent: boolean;
  /** No se pudo leer el audio. */
  failed?: boolean;
  analyzedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Última vez que la pusiste a sonar (para "Actividad reciente"). */
  playedAt?: number;
  /** Pública: la ven tus amigos y sale en "De la comunidad" (por defecto, privada). */
  public?: boolean;
  /** Cuenta dueña (se guarda en su cuenta del servidor). Sin cuenta: es solo de este aparato por ahora. */
  cuenta?: string;
  /** Foto propia (archivo en el servidor, /api/playlist-fotos/…). Sin foto: mosaico de carátulas. */
  foto?: string;
  /** Importada de Spotify: el enlace de la playlist original. */
  origen?: string;
  /** Importada: cuántas canciones de Spotify todavía no están en el servidor (se agregan solas al subirse). */
  faltan?: number;
  /** Fijada arriba en la barra: cuándo se fijó (la que se fijó primero va primero). */
  pinnedAt?: number;
}

export interface PlayEvent {
  id?: number;
  trackId: string;
  startedAt: number;
  listened: number; // segundos realmente escuchados
  duration: number;
  completed: boolean; // llegó al final (o casi)
  skipped: boolean; // la cambiaste antes de tiempo
  /** Canción anterior en la sesión: sirve para aprender qué escuchas seguido de qué. */
  prevTrackId?: string;
  /** Estadísticas: desde dónde se puso (accesos, búsqueda, radio…), en qué aparato y con qué versión. */
  origen?: string;
  aparato?: string;
  version?: string;
}

export interface Rating {
  trackId: string;
  value: 1 | -1;
  at: number;
}

let dbPromise: Promise<IDBPDatabase<MusicDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<MusicDB>('reproductor', 4, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
          tracks.createIndex('byAddedAt', 'addedAt');
          db.createObjectStore('files');
          db.createObjectStore('covers');
        }
        if (oldVersion < 2) {
          const plays = db.createObjectStore('plays', { keyPath: 'id', autoIncrement: true });
          plays.createIndex('byTrack', 'trackId');
          plays.createIndex('byStartedAt', 'startedAt');
          db.createObjectStore('ratings', { keyPath: 'trackId' });
        }
        if (oldVersion < 3) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (oldVersion < 4) {
          db.createObjectStore('features', { keyPath: 'trackId' });
        }
      },
    });
  }
  return dbPromise;
}

export async function addPlay(e: PlayEvent) {
  await (await getDB()).add('plays', e);
}

export async function getAllPlays(): Promise<PlayEvent[]> {
  return (await getDB()).getAll('plays');
}

export async function getAllRatings(): Promise<Rating[]> {
  return (await getDB()).getAll('ratings');
}

export async function setRating(trackId: string, value: 1 | -1 | 0) {
  const db = await getDB();
  if (value === 0) await db.delete('ratings', trackId);
  else await db.put('ratings', { trackId, value, at: Date.now() });
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  return (await getDB()).getAll('playlists');
}

export async function putPlaylist(p: Playlist) {
  await (await getDB()).put('playlists', p);
}

export async function deletePlaylist(id: string) {
  await (await getDB()).delete('playlists', id);
}

export async function getAllFeatures(): Promise<AudioFeatures[]> {
  // Las canciones del servidor ya vienen analizadas por el servidor.
  return [...(await (await getDB()).getAll('features')), ...(rasgosServidor() as AudioFeatures[])];
}

export async function putFeatures(f: AudioFeatures) {
  await (await getDB()).put('features', f);
}

export async function getAllTracks(): Promise<Track[]> {
  return (await getDB()).getAll('tracks');
}

export async function hasTrack(id: string): Promise<boolean> {
  return (await (await getDB()).getKey('tracks', id)) !== undefined;
}

export async function hasCover(id: string): Promise<boolean> {
  return (await (await getDB()).getKey('covers', id)) !== undefined;
}

export async function saveTrack(track: Track, audio: Blob, cover?: { id: string; blob: Blob }) {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'files', 'covers'], 'readwrite');
  await Promise.all([
    tx.objectStore('files').put(audio, track.id),
    cover ? tx.objectStore('covers').put(cover.blob, cover.id) : Promise.resolve(),
    tx.objectStore('tracks').put(track),
    tx.done,
  ]);
}

/**
 * Cambia solo algunos campos, leyendo la versión guardada dentro de la misma transacción.
 * Así nunca se pisa con una copia vieja lo que otra parte de la app acaba de guardar.
 */
export async function patchTracks(patches: { id: string; patch: Partial<Track> }[], cover?: { id: string; blob: Blob }) {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'covers'], 'readwrite');
  const store = tx.objectStore('tracks');
  if (cover) tx.objectStore('covers').put(cover.blob, cover.id);
  for (const { id, patch } of patches) {
    const cur = await store.get(id);
    if (cur) await store.put({ ...cur, ...patch });
  }
  await tx.done;
}

/** El audio de una canción: local (guardado al importar) o del servidor (se descarga y queda guardado). */
export async function getAudio(id: string): Promise<Blob | undefined> {
  if (esDelServidor(id)) return audioServidor(id);
  return (await getDB()).get('files', id);
}

export async function getCover(id: string): Promise<Blob | undefined> {
  if (esPortadaServidor(id)) return portadaServidor(id);
  return (await getDB()).get('covers', id);
}

export async function deleteTrack(id: string) {
  const db = await getDB();
  const tx = db.transaction(['tracks', 'files'], 'readwrite');
  await Promise.all([tx.objectStore('tracks').delete(id), tx.objectStore('files').delete(id), tx.done]);
}

/** Pide al navegador que no borre los datos si falta espacio. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* sin soporte: no pasa nada */
  }
}
