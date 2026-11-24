import { create } from 'zustand';
import type { Track } from '../types';
import { sincronizarBiblioteca, useLibrary } from '../library/store';
import { marcarRadio, radioProvider, usePlayer } from '../player/player';
import { api, useCuenta } from '../server/cuenta';
import { rasgosServidor } from '../server/biblioteca';
import { alCambiarEscuchas } from '../server/datosCuenta';
import { foldBpm } from './bpm';
import { MOODS, type MoodId } from './engine';

/**
 * Las recomendaciones las calcula el SERVIDOR con los datos de tu cuenta (mismo algoritmo de siempre), así el
 * feed es igual en el teléfono, la tablet o el PC. Aquí solo se piden y se guardan en memoria para mostrarlas.
 *
 * Se vuelven a pedir cuando escuchas algo, das "me gusta", vuelves a la app, entras a tu cuenta o pasan 20 min
 * (la hora del día cuenta).
 */

interface RecoState {
  /** Ya llegó el feed del servidor. */
  ready: boolean;
  shortcuts: string[];
  rediscover: string[];
  moods: Record<MoodId, string[]>;
  /** Cuántas canciones escuchaste de verdad (o te gustaron). Pocas = usuario nuevo. */
  heard: number;
  /** Tus álbumes (claves) y tus artistas (nombres), en orden de lo que más va contigo. */
  albums: string[];
  artists: string[];
  /** Para "Aleatorio": tu música (o el Billboard si eres nuevo). */
  shuffle: string[];
  /** "Para ti": mixes según lo que escuchas (Anime Now, Mix Reggaeton, Essential 90's / 2000's), ya ordenados. */
  paraTi: { id: string; titulo: string; ids: string[]; portada?: string }[];
  /** Avance del análisis de audio (lo hace el servidor; aquí solo se cuenta). */
  analyzed: number;
  total: number;
}

const emptyMoods = () => Object.fromEntries(MOODS.map((m) => [m.id, [] as string[]])) as Record<MoodId, string[]>;

export const useReco = create<RecoState>(() => ({
  ready: false,
  shortcuts: [],
  rediscover: [],
  moods: emptyMoods(),
  heard: 0,
  albums: [],
  artists: [],
  shuffle: [],
  paraTi: [],
  analyzed: 0,
  total: 0,
}));

/** Tempo de una canción según el análisis del servidor (llevado a 90–180 BPM), o null si aún no se analizó. */
let bpms = new Map<string, number>();
export function trackBpm(trackId: string): number | null {
  return bpms.get(trackId) ?? null;
}
function contarAnalisis() {
  const r = rasgosServidor() as { trackId: string; bpm?: number; silent?: boolean; failed?: boolean }[];
  bpms = new Map(r.filter((f) => f.bpm && !f.silent && !f.failed).map((f) => [f.trackId, foldBpm(f.bpm!)]));
  useReco.setState({ analyzed: r.length, total: useLibrary.getState().tracks.length });
}

type Feed = Omit<RecoState, 'ready' | 'analyzed' | 'total'>;

let pidiendo = false;
let otraVez = false;
async function refresh() {
  if (!useCuenta.getState().token) return;
  if (pidiendo) {
    otraVez = true;
    return;
  }
  pidiendo = true;
  try {
    const f = await api<Feed>('/api/feed');
    useReco.setState({ ...f, moods: { ...emptyMoods(), ...f.moods }, paraTi: f.paraTi ?? [], ready: true });
  } catch {
    /* sin conexión: se queda el último feed */
  } finally {
    pidiendo = false;
    if (otraVez) {
      otraVez = false;
      void refresh();
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Vuelve a pedir el feed un momento después (agrupa varios cambios seguidos en una sola consulta). */
export function refreshSoon(ms = 1200) {
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), ms);
}

let started = false;
export async function startReco() {
  if (started) return;
  started = true;
  contarAnalisis();
  await refresh();
  useLibrary.subscribe((s, prev) => s.tracks !== prev.tracks && (contarAnalisis(), refreshSoon()));
  usePlayer.subscribe((s, prev) => s.ratings !== prev.ratings && refreshSoon(1500));
  alCambiarEscuchas(() => refreshSoon(1500));
  useCuenta.subscribe((s, prev) => {
    if (s.token === prev.token) return;
    if (!s.token) useReco.setState({ ready: false, shortcuts: [], rediscover: [], moods: emptyMoods(), heard: 0, albums: [], artists: [], shuffle: [], paraTi: [] });
    else refreshSoon(0);
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refreshSoon(300));
  setInterval(() => void refresh(), 20 * 60_000);
}

// ---------------- Radio: la decide el servidor ----------------

radioProvider.next = async (queue, index, n = 5) => {
  const r = await api<{ ids: string[] }>('/api/radio', {
    method: 'POST',
    // La primera semilla es el "ancla" (lo que manda en estilo y época): en una radio, la canción con que
    // empezó; en un álbum o playlist, la que está sonando.
    body: { semillas: [usePlayer.getState().colaNombre ? queue[0] : queue[index], ...queue.slice(Math.max(0, index - 9), index + 1)], excluir: queue.slice(-300), n: Math.min(30, n) },
  });
  // Si la radio eligió canciones recién subidas que este aparato todavía no tiene en su lista, se actualiza la
  // biblioteca antes (si no, se descartaban y la radio se cortaba).
  const conocidas = new Set(useLibrary.getState().tracks.map((t) => t.id));
  if (r.ids.some((id) => !conocidas.has(id))) await sincronizarBiblioteca(true).catch(() => {});
  return r.ids;
};

/**
 * Tocas una canción: suena YA, y su radio (canciones parecidas, elegidas por el servidor) se agrega detrás en
 * cuanto llega (un instante).
 */
export function playSongRadio(id: string, _fallback?: Track[]) {
  const byId = new Map(useLibrary.getState().tracks.map((t) => [t.id, t]));
  const seed = byId.get(id);
  if (!seed) return;
  usePlayer.getState().playTracks([seed], 0, { shuffle: false });
  usePlayer.setState({ colaNombre: `Mix de ${seed.title}` });
  void api<{ ids: string[] }>('/api/radio', { method: 'POST', body: { desde: id, n: 20 } }).then(
    (r) => {
      const p = usePlayer.getState();
      // Ya pusiste otra cosa. (Si mientras tanto la radio ya agregó algunas, igual se suman las que falten.)
      if (p.queue[0] !== id || usePlayer.getState().colaNombre !== `Mix de ${seed.title}`) return;
      const ya = new Set(p.queue);
      marcarRadio(r.ids);
      for (const x of r.ids) {
        const t = byId.get(x);
        if (t && !ya.has(x)) usePlayer.getState().addToQueue(t);
      }
    },
    () => {},
  );
}
