import { create } from 'zustand';
import { getAllTracks, requestPersistentStorage } from '../db';
import type { Album, Artist, Track } from '../types';
import { importFiles, type ImportProgress } from './importer';
import { esperarListaGuardada, olvidarServidor, refrescarServidor, tracksServidor } from '../server/biblioteca';
import { useCuenta } from '../server/cuenta';

interface LibraryState {
  loaded: boolean;
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  /** id de canción → clave de su álbum (los OST y recopilaciones juntan canciones de varios artistas). */
  albumDe: Map<string, string>;
  importing: ImportProgress | null;
  lastImport: ImportProgress | null;
  load: () => Promise<void>;
  importFiles: (files: File[]) => Promise<void>;
  dismissImportResult: () => void;
}

const queue: File[] = [];
let running: Promise<void> | null = null;

import { groupLibrary } from './group';
export { groupLibrary };

/** Clave del álbum de una canción (para abrirlo). */
export function claveAlbum(t: Track) {
  return useLibrary.getState().albumDe.get(t.id) ?? `${t.albumArtist}|${t.album}`.toLowerCase();
}

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  tracks: [],
  albums: [],
  artists: [],
  albumDe: new Map(),
  importing: null,
  lastImport: null,

  async load() {
    // Música local (importada en este aparato) + la del servidor (si hay sesión).
    await esperarListaGuardada();
    const tracks = [...(await getAllTracks()), ...tracksServidor()];
    set({ loaded: true, ...groupLibrary(tracks) });
  },

  async importFiles(files) {
    // Si ya hay una importación en curso, encolamos en vez de descartar.
    queue.push(...files);
    if (running) return running;
    running = (async () => {
      await requestPersistentStorage();
      const total: ImportProgress = { done: 0, total: 0, added: 0, skipped: 0, failed: [] };
      while (queue.length) {
        const batch = queue.splice(0);
        const base = { ...total };
        const r = await importFiles(batch, (p) =>
          set({ importing: { ...p, done: base.done + p.done, total: base.total + p.total + queue.length } }),
        );
        total.done += r.done;
        total.total += r.total;
        total.added += r.added;
        total.skipped += r.skipped;
        total.failed.push(...r.failed);
        await get().load(); // se ven las canciones nuevas sin esperar al final
      }
      set({ importing: null, lastImport: total });
      // Con las canciones ya guardadas, buscamos en internet lo que les falte.
      if (total.added > 0) import('./enrich').then((m) => m.enrichLibrary());
    })().finally(() => {
      running = null;
    });
    return running;
  },

  dismissImportResult() {
    set({ lastImport: null });
  },
}));

// ---------------- Servidor de música ----------------

/** Actualiza la lista del servidor y, si cambió, la biblioteca. */
export async function sincronizarBiblioteca(forzar = false) {
  if (await refrescarServidor(forzar)) await useLibrary.getState().load();
}

// Al entrar o salir de la cuenta, aparece o desaparece la música del servidor.
useCuenta.subscribe((c, antes) => {
  if (c.token === antes.token) return;
  if (c.token) void sincronizarBiblioteca(true).then(() => useLibrary.getState().load());
  else void olvidarServidor().then(() => useLibrary.getState().load());
});

// Al volver a la app (por ejemplo, después de subir canciones en el panel), se buscan las nuevas.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizarBiblioteca();
  });
}
