import { create } from 'zustand';

/**
 * Historial del buscador, como en YT Music:
 *  - `queries`: lo que escribiste (el texto tal cual), lo último primero.
 *  - `tracks`: las canciones que tocaste desde el buscador (se muestran con su portada).
 */
const KEY = 'searchHistory';
const MAX_QUERIES = 12;
const MAX_TRACKS = 12;

interface HistoryState {
  queries: string[];
  tracks: string[];
  addQuery: (q: string) => void;
  addTrack: (id: string) => void;
  removeQuery: (q: string) => void;
  clear: () => void;
}

function read(): Pick<HistoryState, 'queries' | 'tracks'> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s) return { queries: s.queries ?? [], tracks: s.tracks ?? [] };
  } catch {
    /* nada guardado */
  }
  return { queries: [], tracks: [] };
}

export const useSearchHistory = create<HistoryState>((set, get) => ({
  ...read(),
  addQuery(q) {
    const clean = q.trim();
    if (!clean) return;
    const low = clean.toLowerCase();
    set({ queries: [clean, ...get().queries.filter((x) => x.toLowerCase() !== low)].slice(0, MAX_QUERIES) });
  },
  addTrack(id) {
    set({ tracks: [id, ...get().tracks.filter((x) => x !== id)].slice(0, MAX_TRACKS) });
  },
  removeQuery(q) {
    set({ queries: get().queries.filter((x) => x !== q) });
  },
  clear() {
    set({ queries: [], tracks: [] });
  },
}));

useSearchHistory.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ queries: s.queries, tracks: s.tracks }));
  } catch {
    /* sin espacio */
  }
});
