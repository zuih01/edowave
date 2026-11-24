import { create } from 'zustand';
import { matchChart, type BillboardHit, type Chart, type ChartEntry } from './chart';
export { matchChart, type BillboardHit, type ChartEntry };
import { useLibrary } from './store';

/**
 * Billboard Hot 100 de esta semana (uso interno, sin interfaz).
 * Billboard no tiene API pública y su web bloquea a otras apps, así que usamos la copia pública
 * que el proyecto github.com/mhollingshead/billboard-hot-100 actualiza cada semana.
 * El algoritmo (fase 5) usará `rank` como señal de "lo que suena ahora".
 */
const URL_RECENT = 'https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json';
const CACHE_KEY = 'billboard';
const RETRY_MS = 6 * 60 * 60 * 1000; // si el viernes todavía no sale la nueva, reintentamos cada 6 h
const CHECK_EVERY_MS = 60 * 60 * 1000; // con la app abierta, revisa cada hora si ya es viernes

/** Medianoche del viernes más reciente (hoy, si hoy es viernes). */
export function lastFriday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7));
  return d.getTime();
}

/**
 * Se actualiza cada viernes: descarga si la última descarga fue antes del viernes más reciente.
 * Si ese viernes la copia pública aún tiene la lista anterior, reintenta cada 6 h hasta que cambie.
 */
function shouldFetch(c: Chart | null, now = Date.now()) {
  if (!c) return true;
  if (c.fetchedAt < lastFriday(new Date(now))) return true;
  return !!c.waitingNew && now - c.fetchedAt > RETRY_MS;
}

interface BillboardState {
  chart: Chart | null;
  /** trackId → su posición en el Hot 100 de esta semana. Solo canciones de tu biblioteca. */
  hits: Map<string, BillboardHit>;
}

export const useBillboard = create<BillboardState>(() => ({ chart: null, hits: new Map() }));

function readCache(): Chart | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Chart) : null;
  } catch {
    return null;
  }
}

function rematch() {
  const { chart } = useBillboard.getState();
  if (!chart) return;
  useBillboard.setState({ hits: matchChart(useLibrary.getState().tracks, chart) });
}

/** Descarga la lista nueva los viernes. Sin internet, se queda con la última guardada. */
export async function refreshBillboard() {
  let chart = readCache();
  if (shouldFetch(chart)) {
    try {
      const res = await fetch(URL_RECENT, { cache: 'no-cache' });
      if (res.ok) {
        const json = (await res.json()) as { date: string; data: ChartEntry[] };
        if (Array.isArray(json.data) && json.data.length) {
          const prev = chart;
          // Si la primera descarga del viernes trae la misma lista de antes, seguimos esperando la nueva.
          const sameAsBefore = !!prev && prev.date === json.date && prev.fetchedAt < lastFriday();
          chart = {
            date: json.date,
            fetchedAt: Date.now(),
            data: json.data,
            waitingNew: sameAsBefore || (!!prev?.waitingNew && prev.date === json.date),
          };
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(chart));
          } catch {
            /* sin espacio: seguimos con la lista en memoria */
          }
        }
      }
    } catch {
      /* sin conexión: usamos la guardada si existe */
    }
  }
  if (chart) {
    useBillboard.setState({ chart });
    rematch();
  }
}

// Con la app abierta mucho tiempo (por ejemplo, sonando toda la noche), también se actualiza al llegar el viernes.
setInterval(() => void refreshBillboard(), CHECK_EVERY_MS);

// Si cambia la biblioteca (importaciones, datos completados), se vuelve a cruzar con la lista.
useLibrary.subscribe((s, prev) => {
  if (s.tracks !== prev.tracks) rematch();
});
