import { create } from 'zustand';
import { getAllTracks, hasCover, patchTracks } from '../db';
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, type Track } from '../types';
import { hashString } from './importer';
import {
  fetchCover,
  getRecordingDetail,
  getReleaseGroup,
  OfflineError,
  searchRecordings,
  searchReleaseGroups,
  type MbRecording,
  type MbRelease,
  type MbReleaseGroup,
} from './musicbrainz';
import { useLibrary } from './store';
import { creditosServidor } from '../server/biblioteca';

/**
 * Completa lo que le falta a cada canción (álbum, año, portada, número de pista, género)
 * buscando en MusicBrainz. Nunca reemplaza datos que ya venían en el archivo.
 */

interface EnrichState {
  running: boolean;
  done: number;
  total: number;
  /** Canciones a las que se les completó algo en la última pasada. */
  updated: number;
  /** Resultado para mostrar al terminar (null = nada que avisar). */
  result: { updated: number } | null;
  dismiss: () => void;
}

export const useEnrich = create<EnrichState>((set) => ({
  running: false,
  done: 0,
  total: 0,
  updated: 0,
  result: null,
  dismiss: () => set({ result: null }),
}));

import { sameArtist, sameTitle } from './titulos';
export { sameArtist, sameTitle };

function yearOf(date?: string) {
  const y = date ? parseInt(date.slice(0, 4), 10) : NaN;
  return y > 1000 ? y : undefined;
}

function topTags(tags?: { name: string; count: number }[]) {
  return (tags ?? [])
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((t) => t.name);
}

/** Prioridad: álbum de estudio oficial > single/EP > recopilatorios y en vivo. Ante empate, el más antiguo. */
function rankRelease(r: MbRelease) {
  const rg = r['release-group'];
  const studio = !rg?.['secondary-types']?.length;
  const type = rg?.['primary-type'];
  return (r.status === 'Official' ? 0 : 10) + (type === 'Album' && studio ? 0 : (type === 'Single' || type === 'EP') && studio ? 3 : 6);
}

function rankGroup(g: MbReleaseGroup) {
  const studio = !g['secondary-types']?.length;
  const type = g['primary-type'];
  return type === 'Album' && studio ? 0 : (type === 'Single' || type === 'EP') && studio ? 1 : 2;
}

const albumCoverId = (albumArtist: string, album: string) => `a:${hashString(`${albumArtist}|${album}`.toLowerCase())}`;

const rgYearCache = new Map<string, number | undefined>();
async function releaseGroupYear(id: string) {
  if (!rgYearCache.has(id)) rgYearCache.set(id, yearOf((await getReleaseGroup(id))?.['first-release-date']));
  return rgYearCache.get(id);
}

/** Descarga la portada si todavía no la tenemos guardada. */
async function coverFor(coverId: string, releaseGroupId: string): Promise<{ id: string; blob: Blob } | 'exists' | null> {
  if (await hasCover(coverId)) return 'exists';
  const blob = await fetchCover(releaseGroupId);
  return blob ? { id: coverId, blob } : null;
}

const FIELDS = ['album', 'albumArtist', 'year', 'trackNo', 'genres', 'coverId'] as const;

/** Anota en la canción qué datos vinieron de internet. */
function markFilled(before: Track, after: Track): Track {
  const filled = new Set(after.mbFilled ?? []);
  for (const f of FIELDS) {
    const changed = Array.isArray(after[f]) ? JSON.stringify(after[f]) !== JSON.stringify(before[f]) : after[f] !== before[f];
    if (changed) filled.add(f);
  }
  return filled.size ? { ...after, mbFilled: [...filled] } : after;
}

/** Guarda solo lo que cambió respecto a `before` (sin pisar otros cambios recientes). */
function save(pairs: [Track, Track][], cover?: { id: string; blob: Blob }) {
  const patches = pairs.map(([before, after]) => {
    const patch: Partial<Track> = {};
    for (const k of Object.keys(after) as (keyof Track)[]) {
      if (after[k] !== before[k]) (patch as Record<string, unknown>)[k] = after[k];
    }
    return { id: after.id, patch };
  });
  return patchTracks(patches, cover);
}

function needsData(t: Track) {
  return t.album === UNKNOWN_ALBUM || !t.coverId || !t.year || t.genres.length === 0;
}

/** Canción sin álbum: buscamos la grabación y elegimos el álbum original donde salió. */
async function enrichLoose(t: Track): Promise<boolean> {
  const recs = (await searchRecordings(t.title, t.artist)).filter(
    (r: MbRecording) => r.score >= 90 && sameTitle(r.title, t.title) && sameArtist(t.artist, r['artist-credit']),
  );
  if (!recs.length) return false;

  const releases = recs.flatMap((r) => (r.releases ?? []).map((rel) => ({ rel, rec: r })));
  releases.sort((a, b) => rankRelease(a.rel) - rankRelease(b.rel) || (a.rel.date || '9999').localeCompare(b.rel.date || '9999'));
  const best = releases[0];
  const genres = topTags(recs.flatMap((r) => r.tags ?? []));
  const next: Track = { ...t };

  if (best?.rel['release-group']) {
    const rg = best.rel['release-group'];
    const credit = best.rel['artist-credit']?.map((c) => c.name).join(', ');
    next.album = rg.title;
    next.albumArtist = credit && credit !== 'Various Artists' ? credit : t.artist;
    next.year ??= (await releaseGroupYear(rg.id)) ?? yearOf(best.rel.date);
    const no = parseInt(best.rel.media?.[0]?.track?.[0]?.number ?? '', 10);
    if (!next.trackNo && no > 0) next.trackNo = no;
    if (!next.genres.length) next.genres = genres;

    const coverId = albumCoverId(next.albumArtist, next.album);
    let cover: { id: string; blob: Blob } | undefined;
    if (!t.coverId) {
      const c = await coverFor(coverId, rg.id);
      if (c === 'exists') next.coverId = coverId;
      else if (c) {
        next.coverId = coverId;
        cover = c;
      }
    }
    next.mbCheckedAt = Date.now();
    next.mbRecordingId = best.rec.id;
    await save([[t, markFilled(t, next)]], cover);
    return true;
  }
  if (!next.genres.length && genres.length) {
    next.genres = genres;
    next.mbCheckedAt = Date.now();
    next.mbRecordingId = recs[0].id;
    await save([[t, markFilled(t, next)]]);
    return true;
  }
  return false;
}

/** Álbum conocido: una sola búsqueda para todas sus canciones (año, portada, género). */
async function enrichAlbum(tracks: Track[]): Promise<number> {
  const { album, albumArtist, artist } = tracks[0];
  // Varias ediciones pueden llamarse igual: preferimos el álbum de estudio original (el más antiguo).
  const pick = (groups: Awaited<ReturnType<typeof searchReleaseGroups>>, who: string) =>
    groups
      .filter((g) => g.score >= 85 && sameTitle(g.title, album) && sameArtist(who, g['artist-credit']))
      .sort(
        (a, b) =>
          rankGroup(a) - rankGroup(b) || (a['first-release-date'] || '9999').localeCompare(b['first-release-date'] || '9999'),
      )[0];
  let match = pick(await searchReleaseGroups(album, albumArtist), albumArtist);
  if (!match && artist !== albumArtist) match = pick(await searchReleaseGroups(album, artist), artist);
  if (!match) return 0;

  const year = yearOf(match['first-release-date']);
  const genres = topTags((match as { tags?: { name: string; count: number }[] }).tags);
  const coverId = albumCoverId(albumArtist, album);
  let cover: { id: string; blob: Blob } | undefined;
  let haveCover = tracks.some((t) => t.coverId === coverId);
  if (tracks.some((t) => !t.coverId)) {
    const c = await coverFor(coverId, match.id);
    if (c === 'exists') haveCover = true;
    else if (c) {
      cover = c;
      haveCover = true;
    }
  }

  let changed = 0;
  const updated = tracks.map((t): [Track, Track] => {
    const n: Track = { ...t, mbCheckedAt: Date.now() };
    if (!n.year && year) n.year = year;
    if (!n.genres.length && genres.length) n.genres = genres;
    if (!n.coverId && haveCover) n.coverId = coverId;
    if (n.year !== t.year || n.genres !== t.genres || n.coverId !== t.coverId) changed++;
    return [t, markFilled(t, n)];
  });
  await save(updated, cover);
  return changed;
}

let running: Promise<void> | null = null;
let again = false;

/** Recorre la biblioteca y completa lo que falte. Si ya está corriendo, repite al terminar (por si llegaron canciones nuevas). */
export function enrichLibrary(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await run();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function run() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const all = await getAllTracks();
  // Sin artista no buscamos: los resultados serían de otra canción con el mismo nombre.
  const pending = all.filter((t) => !t.mbCheckedAt && t.artist !== UNKNOWN_ARTIST && needsData(t));
  if (!pending.length) return;

  const loose = pending.filter((t) => t.album === UNKNOWN_ALBUM);
  const albums = new Map<string, Track[]>();
  for (const t of pending) {
    if (t.album === UNKNOWN_ALBUM) continue;
    const k = `${t.albumArtist}|${t.album}`.toLowerCase();
    albums.set(k, [...(albums.get(k) ?? []), t]);
  }

  const set = useEnrich.setState;
  const total = loose.length + [...albums.values()].reduce((n, a) => n + a.length, 0);
  set({ running: true, done: 0, total, updated: 0, result: null });
  let done = 0;
  let updated = 0;
  const reload = () => useLibrary.getState().load();

  // Si una búsqueda no encuentra nada, la marcamos igual para no repetirla en cada arranque.
  const markChecked = (ts: Track[]) => patchTracks(ts.map((t) => ({ id: t.id, patch: { mbCheckedAt: Date.now() } })));

  try {
    for (const group of albums.values()) {
      const n = await enrichAlbum(group);
      if (n === 0) await markChecked(group);
      updated += n;
      done += group.length;
      set({ done, updated });
      if (n) await reload();
    }
    for (const t of loose) {
      const ok = await enrichLoose(t);
      if (!ok) await markChecked([t]);
      else updated++;
      done++;
      set({ done, updated });
      if (ok) await reload();
    }
  } catch (e) {
    // Sin internet: lo que falte se intentará en el próximo arranque.
    if (!(e instanceof OfflineError)) console.error('Error completando datos', e);
  } finally {
    set({ running: false, result: updated > 0 ? { updated } : null });
    await reload();
  }
}

// ---------------- Créditos de una canción ----------------

export interface Credit {
  name: string;
  roles: string[];
}

export interface Credits {
  recordingId: string;
  performers: Credit[];
  writers: Credit[];
  production: Credit[];
}

const ROLE_ES: Record<string, string> = {
  composer: 'Compositor',
  lyricist: 'Letrista',
  writer: 'Autor',
  arranger: 'Arreglos',
  producer: 'Productor',
  engineer: 'Ingeniería de sonido',
  'audio engineer': 'Ingeniería de sonido',
  mix: 'Mezcla',
  mastering: 'Masterización',
  recording: 'Grabación',
  programming: 'Programación',
  vocal: 'Voz',
  performer: 'Intérprete',
  'performing orchestra': 'Orquesta',
  conductor: 'Director',
};

const WRITER_TYPES = new Set(['composer', 'lyricist', 'writer', 'arranger', 'librettist', 'translator']);
const PERFORMER_TYPES = new Set(['vocal', 'instrument', 'performer', 'performing orchestra', 'conductor', 'chorus master']);

function roleName(type: string, attrs?: string[]) {
  if (type === 'instrument' && attrs?.length) return attrs.join(', ');
  if (type === 'vocal' && attrs?.length) return `Voz (${attrs.join(', ')})`;
  return ROLE_ES[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function addCredit(list: Credit[], name: string | undefined, role: string) {
  if (!name) return;
  const c = list.find((x) => x.name === name);
  if (!c) list.push({ name, roles: [role] });
  else if (!c.roles.includes(role)) c.roles.push(role);
}

/** Elige la grabación más parecida a nuestro archivo: mismo álbum, versión de estudio y duración similar. */
async function findRecordingId(t: Track): Promise<string | null> {
  if (t.mbRecordingId) return t.mbRecordingId;
  if (t.artist === UNKNOWN_ARTIST) return null;
  const recs = (await searchRecordings(t.title, t.artist)).filter(
    (r) => r.score >= 85 && sameTitle(r.title, t.title) && sameArtist(t.artist, r['artist-credit']),
  );
  if (!recs.length) return null;
  const score = (r: MbRecording) => {
    let s = 0;
    const rels = r.releases ?? [];
    if (t.album !== UNKNOWN_ALBUM && rels.some((x) => sameTitle(x['release-group']?.title ?? x.title, t.album))) s += 4;
    if (rels.some((x) => rankRelease(x) === 0)) s += 2;
    if (/live|en vivo|demo|remix|acoustic/i.test(r.disambiguation ?? '')) s -= 3;
    if (r.length && t.duration > 30) s -= Math.min(3, Math.abs(r.length / 1000 - t.duration) / 10);
    return s;
  };
  const best = recs.sort((a, b) => score(b) - score(a))[0];
  await patchTracks([{ id: t.id, patch: { mbRecordingId: best.id } }]);
  return best.id;
}

const creditsCache = new Map<string, Credits | null>();

/** Descarga los créditos (compositores, productores, músicos). null = no se encontró la canción en MusicBrainz. */
export async function fetchCredits(t: Track): Promise<Credits | null> {
  // Canción del servidor: los créditos ya los buscó el servidor.
  if (t.server) return (creditosServidor(t.id) as Credits | null) ?? null;
  if (creditsCache.has(t.id)) return creditsCache.get(t.id)!;
  const id = await findRecordingId(t);
  if (!id) {
    creditsCache.set(t.id, null);
    return null;
  }
  const d = await getRecordingDetail(id);
  if (!d) return null;
  const c: Credits = { recordingId: id, performers: [], writers: [], production: [] };
  for (const a of d['artist-credit'] ?? []) addCredit(c.performers, a.name, 'Artista');
  for (const rel of d.relations ?? []) {
    if (rel['target-type'] === 'work') {
      for (const w of rel.work?.relations ?? []) {
        if (w['target-type'] === 'artist' && WRITER_TYPES.has(w.type)) addCredit(c.writers, w.artist?.name, roleName(w.type));
      }
    } else if (rel['target-type'] === 'artist') {
      const list = PERFORMER_TYPES.has(rel.type) ? c.performers : WRITER_TYPES.has(rel.type) ? c.writers : c.production;
      addCredit(list, rel.artist?.name, roleName(rel.type, rel.attributes));
    }
  }
  creditsCache.set(t.id, c);
  return c;
}
