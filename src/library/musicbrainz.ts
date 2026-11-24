/**
 * Cliente mínimo de MusicBrainz (datos) y Cover Art Archive (portadas). Ambos gratis y sin cuenta.
 * MusicBrainz pide como máximo 1 consulta por segundo: todas pasan por una cola.
 */
const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';
const GAP_MS = 1100;

export class OfflineError extends Error {}

let last = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Espera su turno para respetar el límite de MusicBrainz. */
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      last = Date.now();
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

async function mbGet<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await throttle(() => fetch(`${MB}${path}${path.includes('?') ? '&' : '?'}fmt=json`));
    } catch {
      throw new OfflineError('Sin conexión');
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return null;
    // 503 = vamos demasiado rápido; esperamos y reintentamos.
    if (res.status === 503 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    return null;
  }
  return null;
}

/** Escapa comillas y caracteres especiales de la sintaxis de búsqueda (Lucene). */
function q(s: string) {
  return s.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
}

export interface MbReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
}

export interface MbRelease {
  id: string;
  title: string;
  date?: string;
  status?: string;
  'release-group'?: MbReleaseGroup;
  'artist-credit'?: { name: string }[];
  media?: { track?: { number?: string }[] }[];
}

export interface MbRecording {
  id: string;
  score: number;
  title: string;
  length?: number;
  disambiguation?: string;
  'artist-credit'?: { name: string }[];
  releases?: MbRelease[];
  tags?: { name: string; count: number }[];
}

export async function searchRecordings(title: string, artist: string): Promise<MbRecording[]> {
  const query = encodeURIComponent(`recording:"${q(title)}" AND artist:"${q(artist)}"`);
  const r = await mbGet<{ recordings?: MbRecording[] }>(`/recording?query=${query}&limit=25`);
  return r?.recordings ?? [];
}

interface MbArtistRel {
  type: string;
  'target-type': string;
  artist?: { name: string };
  attributes?: string[];
}

export interface MbRecordingDetail {
  id: string;
  title: string;
  'artist-credit'?: { name: string }[];
  relations?: (MbArtistRel & { work?: { title: string; relations?: MbArtistRel[] } })[];
}

/** Grabación con sus relaciones: quién produjo, quién compuso la obra, músicos… */
export async function getRecordingDetail(id: string): Promise<MbRecordingDetail | null> {
  return mbGet<MbRecordingDetail>(`/recording/${id}?inc=artist-rels+work-rels+work-level-rels+artist-credits`);
}

export async function searchReleaseGroups(album: string, artist: string): Promise<(MbReleaseGroup & { score: number; 'artist-credit'?: { name: string }[] })[]> {
  const query = encodeURIComponent(`releasegroup:"${q(album)}" AND artist:"${q(artist)}"`);
  const r = await mbGet<{ 'release-groups'?: (MbReleaseGroup & { score: number })[] }>(`/release-group?query=${query}&limit=10`);
  return r?.['release-groups'] ?? [];
}

export async function getReleaseGroup(id: string): Promise<MbReleaseGroup | null> {
  return mbGet<MbReleaseGroup>(`/release-group/${id}`);
}

/** Portada frontal (500 px). Devuelve null si el álbum no tiene portada subida. */
export async function fetchCover(releaseGroupId: string): Promise<Blob | null> {
  try {
    const res = await fetch(`${CAA}/release-group/${releaseGroupId}/front-500`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith('image/') || blob.size > 1000 ? blob : null;
  } catch {
    throw new OfflineError('Sin conexión');
  }
}
