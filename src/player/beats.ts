import { getAudio } from '../db';
import { diag } from '../diag';
import { useLibrary } from '../library/store';
import { useAutomix } from './automixStore';
import { usePlayer } from './player';
import { esDelServidor, ritmoServidor } from '../server/biblioteca';

/**
 * Análisis de ritmo para el Automix (una vez por canción, en segundo plano, queda guardado):
 *
 *  1. Envolvente de "golpes": cuánto sube de golpe la energía en graves (bombo), en todo el espectro y en
 *     agudos (caja, hi-hat), 100 veces por segundo.
 *  2. Tempo: el intervalo que más se repite (autocorrelación), prefiriendo tempos normales (~120 BPM).
 *  3. Rejilla de golpes: el período exacto y dónde cae el primer golpe (se prueba cuál calza mejor con
 *     todos los golpes de la canción). Así el BPM sale con decimales y las mezclas no se desfasan.
 *  4. ¿Tempo constante? Se revisa tramo a tramo que los golpes sigan cayendo en la rejilla (grabaciones en
 *     vivo o antiguas se desfasan y no se mezclan).
 *  5. Compases y puntos de mezcla: dónde empieza cada compás (el bombo pesa más en el "1"), el último tramo
 *     con ritmo antes del final (salida) y el primero con ritmo al comienzo (entrada).
 */

export interface Beats {
  v: number;
  bpm: number;
  period: number; // segundos por golpe
  phase: number; // segundo del golpe 0
  steady: boolean; // tempo constante y golpes claros
  conf: number; // qué tan marcados están los golpes (1 = nada)
  out: [number, number] | null; // tramo de salida: empieza y termina (segundos)
  inAt: number | null; // donde entra la canción al mezclarse (segundos)
  dur: number;
}

const VERSION = 1;
const FS = 22050;
const HOP = 220; // ~100 cuadros por segundo
const FPS = FS / HOP;
export const MIX_BEATS = 16; // 4 compases

const KEY = 'beats';
function read(): Record<string, Beats> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    for (const k of Object.keys(all)) if (all[k]?.v !== VERSION) delete all[k];
    return all;
  } catch {
    return {};
  }
}
const store = read();
useAutomix.setState({ analyzed: Object.keys(store).length });

/** Ritmo de una canción: el medido en el aparato o, si es del servidor, el que midió el servidor. */
export const getBeats = (id: string | undefined): Beats | undefined => {
  if (!id) return undefined;
  if (store[id]) return store[id];
  const r = ritmoServidor(id) as Beats | undefined;
  return r?.v === VERSION ? r : undefined;
};

function save(id: string, b: Beats) {
  store[id] = b;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* sin espacio */
  }
  useAutomix.setState({ analyzed: Object.keys(store).length });
  listeners.forEach((fn) => fn(id));
}
const listeners = new Set<(id: string) => void>();
export const onBeats = (fn: (id: string) => void) => listeners.add(fn);

// ---------------- Análisis ----------------

function biquad(type: 'lp' | 'hp', f: number) {
  const w = (2 * Math.PI * f) / FS;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * 0.7071);
  const a0 = 1 + alpha;
  const b = type === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Golpes por cuadro: total (`odf`) y solo graves (`low`, para encontrar el "1" del compás). */
function onsetEnvelope(x: Float32Array) {
  const n = Math.floor(x.length / HOP);
  const eL = new Float64Array(n), eA = new Float64Array(n), eH = new Float64Array(n);
  const lp = biquad('lp', 150), hp = biquad('hp', 3000);
  let l1 = 0, l2 = 0, ly1 = 0, ly2 = 0, h1 = 0, h2 = 0, hy1 = 0, hy2 = 0;
  for (let f = 0; f < n; f++) {
    let sl = 0, sa = 0, sh = 0;
    for (let i = f * HOP, end = i + HOP; i < end; i++) {
      const v = x[i];
      const yl = lp.b0 * v + lp.b1 * l1 + lp.b2 * l2 - lp.a1 * ly1 - lp.a2 * ly2;
      l2 = l1; l1 = v; ly2 = ly1; ly1 = yl;
      const yh = hp.b0 * v + hp.b1 * h1 + hp.b2 * h2 - hp.a1 * hy1 - hp.a2 * hy2;
      h2 = h1; h1 = v; hy2 = hy1; hy1 = yh;
      sl += yl * yl; sa += v * v; sh += yh * yh;
    }
    eL[f] = sl; eA[f] = sa; eH[f] = sh;
  }
  const flux = (e: Float64Array) => {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += e[i];
    mean = mean / n || 1;
    const out = new Float64Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.log(1 + (10 * e[i]) / mean);
      out[i] = Math.max(0, c - prev);
      prev = c;
    }
    return out;
  };
  const fL = flux(eL), fA = flux(eA), fH = flux(eH);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = 0.45 * fL[i] + 0.3 * fA[i] + 0.25 * fH[i];
  // Se le resta el promedio del último segundo: quedan solo los golpes.
  const odf = new Float64Array(n);
  const W = Math.round(FPS);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += raw[i];
    if (i >= W) acc -= raw[i - W];
    odf[i] = Math.max(0, raw[i] - acc / Math.min(i + 1, W));
  }
  return { odf, low: fL, energy: eA, n };
}

const at = (a: Float64Array, x: number) => {
  const k = Math.floor(x);
  if (k < 0 || k >= a.length - 1) return 0;
  return a[k] + (a[k + 1] - a[k]) * (x - k);
};
/** Lo más fuerte cerca de `x` (±1,5 cuadros = ±15 ms). */
const peakNear = (a: Float64Array, x: number) => Math.max(at(a, x - 1.5), at(a, x - 0.75), at(a, x), at(a, x + 0.75), at(a, x + 1.5));

export function analyzeSamples(x: Float32Array): Beats | null {
  const dur = x.length / FS;
  if (dur < 30) return null;
  const { odf, low, energy, n } = onsetEnvelope(x);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += odf[i];
  mean /= n;
  if (mean <= 0) return null;

  // 2) Tempo aproximado: autocorrelación entre 60 y 200 BPM, prefiriendo ~120.
  const minLag = Math.floor((FPS * 60) / 200), maxLag = Math.ceil((FPS * 60) / 60);
  const ac = new Float64Array(maxLag + 2);
  for (let L = minLag - 1; L <= maxLag + 1; L++) {
    let s = 0;
    for (let i = 0; i + L < n; i++) s += (odf[i] - mean) * (odf[i + L] - mean);
    ac[L] = s / (n - L);
  }
  let best = minLag, bestScore = -Infinity;
  for (let L = minLag; L <= maxLag; L++) {
    const bpm = (FPS * 60) / L;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = ac[L] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = L;
    }
  }
  // Interpolación para afinar el intervalo con decimales.
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const den = y0 - 2 * y1 + y2;
  let P0 = best + (den < 0 ? (0.5 * (y0 - y2)) / den : 0);
  let bpm0 = (FPS * 60) / P0;
  while (bpm0 < 70) { bpm0 *= 2; P0 /= 2; }
  while (bpm0 > 180) { bpm0 /= 2; P0 *= 2; }

  // 3) Rejilla: período exacto (±1 %) y dónde cae el primer golpe.
  const comb = (P: number, phi: number, from = 0, to = Infinity) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, Math.ceil((from - phi) / P)); ; k++) {
      const t = phi + k * P;
      if (t >= n - 2 || t > to) break;
      s += at(odf, t);
      c++;
    }
    return c ? s / c : 0;
  };
  let bP = P0, bPhi = 0, bS = -1;
  for (let j = -25; j <= 25; j++) {
    const P = P0 * (1 + j * 0.0004);
    for (let phi = 0; phi < P; phi += 0.5) {
      const s = comb(P, phi);
      if (s > bS) { bS = s; bP = P; bPhi = phi; }
    }
  }
  // Afinar la fase con más detalle.
  for (let phi = bPhi - 0.5; phi <= bPhi + 0.5; phi += 0.1) {
    const s = comb(bP, phi);
    if (s > bS) { bS = s; bPhi = phi; }
  }
  // Afinado final: en cada tramo de 16 golpes se mide cuánto se adelanta o atrasa la rejilla, y con una
  // recta (desfase según el número de golpe) se corrigen el período y la fase. Dos pasadas.
  const segOffsets = (P: number, phi: number) => {
    const pts: { c: number; d: number; w: number }[] = [];
    const total = Math.floor((n - 2 - phi) / P);
    for (let s = 0; s + 16 <= total; s += 16) {
      let bd = 0, bv = -1, sum = 0;
      for (let d = -P / 4; d <= P / 4; d += 0.25) {
        let v = 0;
        for (let k = s; k < s + 16; k++) v += at(odf, phi + k * P + d);
        sum += v;
        if (v > bv) { bv = v; bd = d; }
      }
      const avg = sum / (Math.floor(P / 2 / 0.25) + 1);
      if (bv > 1.5 * avg) pts.push({ c: s + 8, d: bd, w: bv });
    }
    return pts;
  };
  for (let pass = 0; pass < 2; pass++) {
    const pts = segOffsets(bP, bPhi);
    if (pts.length < 4) break;
    let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) { sw += p.w; sx += p.w * p.c; sy += p.w * p.d; sxx += p.w * p.c * p.c; sxy += p.w * p.c * p.d; }
    const det = sw * sxx - sx * sx;
    if (!det) break;
    const slope = (sw * sxy - sx * sy) / det;
    const icpt = (sy - slope * sx) / sw;
    bP += slope;
    bPhi += icpt;
  }
  bPhi = ((bPhi % bP) + bP) % bP;
  bS = comb(bP, bPhi);
  const conf = bS / mean;

  // Golpes de la rejilla.
  const beats: number[] = [];
  for (let t = bPhi; t < n - 2; t += bP) beats.push(t);
  const nb = beats.length;
  const strength = beats.map((t) => peakNear(odf, t));
  const beatEnergy = beats.map((t) => {
    let s = 0;
    for (let i = Math.floor(t), end = Math.min(n, Math.floor(t + bP)); i < end; i++) s += energy[i];
    return s;
  });
  const sortedE = [...beatEnergy].sort((a, b) => a - b);
  const medianE = sortedE[Math.floor(sortedE.length / 2)] || 1;

  // ¿Este golpe está en un tramo con ritmo? (golpes marcados y algo de volumen, en ±4 golpes)
  const rhythmic = beats.map((_, k) => {
    const a = Math.max(0, k - 4), b = Math.min(nb, k + 4);
    let on = 0, e = 0;
    for (let j = a; j < b; j++) { on += strength[j]; e += beatEnergy[j]; }
    on /= b - a;
    e /= b - a;
    let m = 0;
    const fa = Math.floor(beats[a]), fb = Math.min(n, Math.floor(beats[b - 1] + bP));
    for (let i = fa; i < fb; i++) m += odf[i];
    m /= Math.max(1, fb - fa);
    return on > 1.6 * m && e > 0.25 * medianE;
  });

  // 4) ¿Tempo constante? Cada tramo de 16 golpes debería calzar con la rejilla (±20 ms).
  let strong = 0, aligned = 0;
  const devs: number[] = [];
  for (let s = 0; s + 16 <= nb; s += 16) {
    let r = 0;
    for (let k = s; k < s + 16; k++) if (rhythmic[k]) r++;
    if (r < 12) continue;
    strong++;
    let bd = 0, bv = -1;
    for (let d = -bP / 4; d <= bP / 4; d += 0.25) {
      let v = 0;
      for (let k = s; k < s + 16; k++) v += at(odf, beats[k] + d);
      if (v > bv) { bv = v; bd = d; }
    }
    devs.push(Math.abs(bd));
    if (Math.abs(bd) <= 2) aligned++;
  }
  devs.sort((a, b) => a - b);
  const steady = strong >= 3 && aligned / strong >= 0.8 && (devs[Math.floor(devs.length / 2)] ?? 99) <= 1.5 && conf > 1.8;

  // 5) El "1" de cada compás: donde el bombo pesa más.
  const bar = [0, 0, 0, 0];
  for (let k = 0; k < nb; k++) if (rhythmic[k]) bar[k % 4] += peakNear(low, beats[k]);
  const down = bar.indexOf(Math.max(...bar));
  const sec = (k: number) => beats[k] / FPS;
  const okRun = (from: number) => {
    let r = 0;
    for (let k = from; k < from + MIX_BEATS; k++) if (rhythmic[k]) r++;
    return r >= MIX_BEATS - 2;
  };

  // Salida: el último tramo de 4 compases con ritmo, que termine en un "1" (a lo más 40 s antes del final).
  let out: [number, number] | null = null;
  for (let k = nb - 1; k >= MIX_BEATS; k--) {
    if ((k - down) % 4 !== 0) continue;
    if (dur - sec(k) > 40 || sec(k - MIX_BEATS) < dur * 0.4) break;
    if (okRun(k - MIX_BEATS)) {
      out = [sec(k - MIX_BEATS), sec(k)];
      break;
    }
  }
  // Entrada: el primer "1" desde donde hay 4 compases con ritmo (a lo más 20 s desde el inicio).
  let inAt: number | null = null;
  for (let k = 0; k + MIX_BEATS < nb && sec(k) <= 20; k++) {
    if ((((k - down) % 4) + 4) % 4 !== 0) continue;
    if (okRun(k)) {
      inAt = sec(k);
      break;
    }
  }

  return {
    v: VERSION,
    bpm: Math.round(((FPS * 60) / bP) * 100) / 100,
    period: bP / FPS,
    phase: bPhi / FPS,
    steady,
    conf: Math.round(conf * 100) / 100,
    out,
    inAt,
    dur,
  };
}

let decoder: OfflineAudioContext | null = null;

export async function analyzeTrack(id: string): Promise<Beats | null> {
  const blob = await getAudio(id);
  if (!blob) return null;
  decoder ??= new OfflineAudioContext(1, 1, FS);
  const buf = await decoder.decodeAudioData(await blob.arrayBuffer());
  const n = buf.length;
  const x = new Float32Array(n);
  const ch = Math.min(2, buf.numberOfChannels);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += d[i] / ch;
  }
  return analyzeSamples(x);
}

// ---------------- En segundo plano ----------------

let running = false;
const failed = new Set<string>();

/** Analiza las que faltan: primero la que suena y las dos siguientes, después el resto. */
export async function analyzeMissing() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      if (!useAutomix.getState().on) return;
      const p = usePlayer.getState();
      const lib = useLibrary.getState().tracks;
      const order = [p.queue[p.index], p.queue[p.index + 1], p.queue[p.index + 2], ...lib.map((t) => t.id)];
      const id = order.find((x) => x && !esDelServidor(x) && !store[x] && !failed.has(x));
      if (!id) return;
      try {
        const t0 = performance.now();
        const b = await analyzeTrack(id);
        if (b) {
          save(id, b);
          diag('automix: ritmo analizado', { bpm: b.bpm, constante: b.steady, conf: b.conf, salida: b.out?.[0], entrada: b.inAt, ms: Math.round(performance.now() - t0) });
        } else failed.add(id);
      } catch {
        failed.add(id);
      }
      await new Promise((r) => setTimeout(r, 200)); // pausa: no trabar la app ni la música
    }
  } finally {
    running = false;
  }
}

useAutomix.subscribe((s, old) => {
  if (s.on && !old.on) void analyzeMissing();
});
usePlayer.subscribe((s, old) => {
  if (s.queue !== old.queue || s.index !== old.index) if (useAutomix.getState().on) void analyzeMissing();
});
useLibrary.subscribe((s, old) => {
  if (s.tracks !== old.tracks && useAutomix.getState().on) void analyzeMissing();
});
setTimeout(() => {
  if (useAutomix.getState().on) void analyzeMissing();
}, 3500);
