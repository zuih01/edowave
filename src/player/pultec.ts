/**
 * Modelo del ecualizador pasivo Pultec EQP-1A con filtros de Web Audio.
 *
 * Controles del original:
 *   GRAVES  · frecuencia 20/30/60/100 Hz · BOOST 0–10 (hasta +13.5 dB) · ATTEN 0–10 (hasta −17.5 dB)
 *   AGUDOS  · frecuencia 3–16 kHz · BANDWIDTH (agudo ↔ ancho) · BOOST 0–10 (campana, hasta +18 dB)
 *   ATTEN AGUDOS · 5/10/20 kHz · ATTEN 0–10 (estante, hasta −16 dB)
 *
 * El "truco Pultec": BOOST y ATTEN de graves a la vez en la misma frecuencia. El estante de ATTEN es más
 * ancho que el de BOOST y, como en el circuito pasivo real, ambos interactúan: el resultado sube los
 * subgraves y deja una caída justo encima (por ejemplo, a 60 Hz con 10/10: +4 dB abajo, −3.6 dB hacia 150–200 Hz).
 * Los valores se ajustaron midiendo la respuesta con getFrequencyResponse.
 */

export const LOW_FREQS = [20, 30, 60, 100];
export const HIGH_FREQS = [3000, 4000, 5000, 8000, 10000, 12000, 16000];
export const ATTEN_FREQS = [5000, 10000, 20000];

export interface PultecSettings {
  lowFreq: number;
  lowBoost: number; // 0–10
  lowAtten: number; // 0–10
  highFreq: number;
  bandwidth: number; // 0 = agudo (estrecho), 10 = ancho
  highBoost: number; // 0–10
  attenFreq: number;
  highAtten: number; // 0–10
}

export const PULTEC_DEFAULT: PultecSettings = {
  lowFreq: 60,
  lowBoost: 0,
  lowAtten: 0,
  highFreq: 10000,
  bandwidth: 5,
  highBoost: 0,
  attenFreq: 20000,
  highAtten: 0,
};

export interface FilterSpec {
  type: BiquadFilterType;
  frequency: number;
  gain: number;
  Q: number;
}

/** Siempre 5 filtros, en el mismo orden y tipo (el circuito no se reconecta, solo cambian valores). */
export const PULTEC_TYPES: BiquadFilterType[] = ['lowshelf', 'lowshelf', 'lowshelf', 'peaking', 'highshelf'];

export function pultecSpecs(p: PultecSettings): FilterSpec[] {
  const F = p.lowFreq;
  // Ancho de banda: Q de 2.2 (agudo) a 0.35 (ancho), en escala logarítmica para que el giro se sienta parejo.
  const q = 2.2 * Math.pow(0.35 / 2.2, p.bandwidth / 10);
  return [
    // BOOST graves: estante empinado
    { type: 'lowshelf', frequency: F * 1.3, gain: 1.35 * p.lowBoost, Q: 1 },
    // ATTEN graves: estante ancho en dos tramos; su parte baja se suaviza cuando hay BOOST (interacción del circuito pasivo)
    { type: 'lowshelf', frequency: F * 1.5, gain: -p.lowAtten * (1.2 - 0.07 * p.lowBoost), Q: 1 },
    { type: 'lowshelf', frequency: F * 5, gain: -0.45 * p.lowAtten, Q: 1 },
    // BOOST agudos: campana
    { type: 'peaking', frequency: p.highFreq, gain: 1.8 * p.highBoost, Q: q },
    // ATTEN agudos: estante suave que empieza antes de la frecuencia elegida
    { type: 'highshelf', frequency: p.attenFreq * 0.5, gain: -1.6 * p.highAtten, Q: 1 },
  ];
}

// ---------------- Curva de respuesta (para dibujar y para evitar distorsión) ----------------

let offline: OfflineAudioContext | null = null;
const probes = new Map<BiquadFilterType, BiquadFilterNode>();

function probe(type: BiquadFilterType) {
  offline ??= new OfflineAudioContext(1, 128, 48000);
  let n = probes.get(type);
  if (!n) {
    n = offline.createBiquadFilter();
    n.type = type;
    probes.set(type, n);
  }
  return n;
}

/** N frecuencias en escala logarítmica de 20 Hz a 20 kHz. */
export function logFreqs(n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 20 * Math.pow(1000, i / (n - 1));
  return out;
}

/** Respuesta total en dB de una cadena de filtros, medida con el mismo motor que suena. */
export function responseDb(specs: FilterSpec[], freqs: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const total = new Float32Array(freqs.length);
  const mag = new Float32Array(freqs.length);
  const phase = new Float32Array(freqs.length);
  for (const s of specs) {
    if (s.gain === 0) continue;
    const n = probe(s.type);
    n.frequency.value = s.frequency;
    n.gain.value = s.gain;
    n.Q.value = s.Q;
    n.getFrequencyResponse(freqs, mag, phase);
    for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(mag[i]);
  }
  return total;
}
