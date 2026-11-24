import type { Track } from '../types';
import { normalize } from './fuzzy';
import { core, sameArtist } from './titulos';

export interface ChartEntry {
  song: string;
  artist: string;
  this_week: number;
  last_week: number | null;
  peak_position: number;
  weeks_on_chart: number;
}

export interface Chart {
  date: string; // fecha de la lista, AAAA-MM-DD
  fetchedAt: number;
  data: ChartEntry[];
  /** Ya es viernes pero la lista descargada sigue siendo la de la semana pasada. */
  waitingNew?: boolean;
}

export interface BillboardHit {
  rank: number;
  lastWeek: number | null;
  peak: number;
  weeks: number;
  chartDate: string;
}

/** "Bad Bunny Featuring Drake & J Balvin" → ["Bad Bunny", "Drake", "J Balvin"] */
function splitArtists(s: string) {
  return s
    .split(/\s+(?:featuring|feat\.?|ft\.?|with|x|&|\+|and)\s+|,\s*/i)
    .map((name) => ({ name: name.trim() }))
    .filter((a) => a.name);
}

/**
 * Marca las canciones que estuvieron en un chart de fin de año ([año, puesto, título, artista]). Las de meme,
 * anime y OST no se marcan: sus mixes siguen funcionando exactamente igual. Devuelve cuántas se marcaron.
 */
export function marcarExitos(tracks: Track[], filas: [number, number, string, string][]) {
  const porTitulo = new Map<string, Track[]>();
  for (const t of tracks) {
    if (t.categorias?.length) continue;
    const k = core(t.title);
    if (k) porTitulo.set(k, [...(porTitulo.get(k) ?? []), t]);
  }
  const vistos = new Map<string, { anio: number; puesto: number; anios: Set<number> }>();
  for (const [anio, puesto, titulo, artista] of filas) {
    const credito = [{ name: artista }, ...splitArtists(artista)];
    // Los singles dobles vienen como: Uno" / "Dos
    for (const parte of titulo.split(/["”]?\s+\/\s+["“]?/)) {
      for (const t of porTitulo.get(core(parte)) ?? []) {
        if (!sameArtist(t.artist, credito)) continue;
        const v = vistos.get(t.id) ?? { anio, puesto, anios: new Set<number>() };
        if (puesto < v.puesto) Object.assign(v, { anio, puesto });
        v.anios.add(anio);
        vistos.set(t.id, v);
      }
    }
  }
  for (const t of tracks) {
    const v = vistos.get(t.id);
    // Todo el chart ya es un gran éxito: va de 0,6 (puesto 100) a 1 (puesto 1).
    if (v) t.exito = { anio: Math.min(...v.anios), puesto: v.puesto, anios: v.anios.size, valor: 0.6 + (0.4 * (100 - v.puesto)) / 99 };
  }
  return vistos.size;
}

/**
 * Mismo resultado que comparar cada entrada con cada canción usando `sameTitle`, pero los títulos se normalizan
 * una sola vez y se buscan en un índice (antes eran 100 × 15 000 comparaciones: 4 s con el servidor bloqueado).
 */
export function matchChart(tracks: Track[], chart: Chart): Map<string, BillboardHit> {
  const hits = new Map<string, BillboardHit>();
  const porCore = new Map<string, number[]>();
  const porNorm = new Map<string, number[]>();
  const agregar = (m: Map<string, number[]>, k: string, i: number) => {
    const l = m.get(k);
    if (l) l.push(i);
    else m.set(k, [i]);
  };
  tracks.forEach((t, i) => {
    const c = core(t.title);
    if (!c) return; // sameTitle exige que ambos títulos tengan algo
    agregar(porCore, c, i);
    agregar(porNorm, normalize(t.title), i);
  });
  for (const e of chart.data) {
    const c = core(e.song);
    if (!c) continue;
    const credit = [{ name: e.artist }, ...splitArtists(e.artist)];
    const ids = [...new Set([...(porCore.get(c) ?? []), ...(porNorm.get(normalize(e.song)) ?? [])])].sort((a, b) => a - b);
    for (const i of ids) {
      const t = tracks[i];
      if (!sameArtist(t.artist, credit)) continue;
      hits.set(t.id, {
        rank: e.this_week,
        lastWeek: e.last_week,
        peak: e.peak_position,
        weeks: e.weeks_on_chart,
        chartDate: chart.date,
      });
    }
  }
  return hits;
}
