/**
 * Rasgos del audio para el algoritmo (energía, dinámica, tempo, pulso, actividad, brillo). Recibe la canción
 * completa en mono a 22 050 Hz.
 *
 * COPIA de src/reco/features.ts de la app: si se cambia allá, hay que cambiarlo aquí también.
 */

const RATE = 22050;
const FRAME = 1024;
const HOP = 512;
const FPS = RATE / HOP; // ~43 cuadros por segundo

/** Lleva el tempo al rango 90–180 para que el doble y la mitad cuenten igual. */
export function foldBpm(bpm) {
  if (!bpm) return 0;
  while (bpm < 90) bpm *= 2;
  while (bpm >= 180) bpm /= 2;
  return bpm;
}

export function analizarRasgos(mono) {
  // Tramo de 60 s desde el 25 % de la canción (igual que en la app).
  const total = mono.length;
  const start = Math.floor(total * 0.25);
  const len = Math.min(total - start, RATE * 60);
  const x = mono.subarray(start, start + len);

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

