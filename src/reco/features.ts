import { getAllFeatures, getAudio, putFeatures, type AudioFeatures } from '../db';
import type { Track } from '../types';

/**
 * Análisis del audio de cada canción, hecho en el propio teléfono (nada sale a internet).
 * Se decodifica un tramo de 60 s del medio de la canción a 22 kHz mono y se mide:
 *   - energía: volumen medio            - dinámica: cuánto varía el volumen
 *   - tempo: pulsos por minuto          - pulso: qué tan marcado es el ritmo
 *   - brillo: cantidad de agudos (cruces por cero de la onda)
 * Con esto se arman los mixes de ánimo (Actívate, Relajación…) y se buscan canciones que suenan parecido.
 */

const RATE = 22050;
const FRAME = 1024;
const HOP = 512;
const FPS = RATE / HOP; // ~43 cuadros por segundo

let decoder: OfflineAudioContext | null = null;

async function decode(blob: Blob): Promise<AudioBuffer> {
  decoder ??= new OfflineAudioContext(1, 2, RATE);
  return decoder.decodeAudioData(await blob.arrayBuffer());
}

/** Lleva el tempo al rango 90–180 para que el doble y la mitad cuenten igual. */
export { foldBpm } from './bpm';

export function analyzeBuffer(buf: AudioBuffer): Omit<AudioFeatures, 'trackId' | 'analyzedAt'> {
  // Mono: promedio de canales, tramo de 60 s desde el 25 % de la canción.
  const total = buf.length;
  const start = Math.floor(total * 0.25);
  const len = Math.min(total - start, RATE * 60);
  const x = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++) x[i] += ch[start + i] / buf.numberOfChannels;
  }

  const frames = Math.max(0, Math.floor((len - FRAME) / HOP));
  const rmsDb = new Float32Array(frames);
  let zcrSum = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    let zc = 0;
    const o = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      const v = x[o + i];
      sum += v * v;
      if (i && (v >= 0) !== (x[o + i - 1] >= 0)) zc++;
    }
    rmsDb[f] = 10 * Math.log10(sum / FRAME + 1e-10);
    zcrSum += zc / FRAME;
  }
  if (!frames) return { energy: -60, dynamics: 0, bpm: 0, beat: 0, activity: 0, brightness: 0, silent: true };

  let mean = 0;
  for (const v of rmsDb) mean += v;
  mean /= frames;
  let varSum = 0;
  for (const v of rmsDb) varSum += (v - mean) ** 2;
  const silent = mean < -55;

  // Envolvente de ataques: subidas de volumen de un cuadro al siguiente.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, rmsDb[f] - rmsDb[f - 1]);
  let om = 0;
  for (const v of onset) om += v;
  om /= frames;
  for (let f = 0; f < frames; f++) onset[f] -= om;

  // Tempo: autocorrelación de los ataques entre 60 y 180 BPM, favoreciendo tempos cercanos a 120.
  let r0 = 0;
  for (const v of onset) r0 += v * v;
  let best = 0;
  let bestScore = -Infinity;
  let bestRaw = 0;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * FPS;
    const l0 = Math.floor(lag);
    const frac = lag - l0;
    let r = 0;
    for (let f = 0; f + l0 + 1 < frames; f++) r += onset[f] * (onset[f + l0] * (1 - frac) + onset[f + l0 + 1] * frac);
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = r * weight;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
      bestRaw = r;
    }
  }

  return {
    energy: Math.max(-60, mean),
    dynamics: Math.sqrt(varSum / frames),
    bpm: silent ? 0 : best,
    beat: silent || r0 <= 0 ? 0 : Math.max(0, Math.min(1, bestRaw / r0)),
    activity: silent ? 0 : om,
    brightness: zcrSum / frames,
    silent,
  };
}

let running: Promise<void> | null = null;

/**
 * Analiza en segundo plano las canciones que aún no tienen rasgos. Va de una en una, con pausas,
 * para no trabar la app. `onProgress` avisa cuando hay rasgos nuevos.
 */
export function analyzeLibrary(tracks: Track[], onProgress: (f: AudioFeatures) => void): Promise<void> {
  if (running) return running;
  running = (async () => {
    const done = new Set((await getAllFeatures()).map((f) => f.trackId));
    for (const t of tracks) {
      if (done.has(t.id) || t.server) continue; // las del servidor las analiza el servidor
      // Espera a que la app esté desocupada para no competir con la música ni con la pantalla.
      await new Promise((r) => setTimeout(r, 120));
      let f: AudioFeatures;
      try {
        const blob = await getAudio(t.id);
        if (!blob) continue;
        f = { trackId: t.id, ...analyzeBuffer(await decode(blob)), analyzedAt: Date.now() };
      } catch {
        f = { trackId: t.id, energy: -60, dynamics: 0, bpm: 0, beat: 0, activity: 0, brightness: 0, silent: true, failed: true, analyzedAt: Date.now() };
      }
      await putFeatures(f);
      onProgress(f);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
