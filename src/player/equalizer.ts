import { create } from 'zustand';
import { audio, beforePlay, elementHooks } from './player';
import { PULTEC_DEFAULT, PULTEC_TYPES, pultecSpecs, type PultecSettings } from './pultec';

/**
 * Ecualizador con Web Audio, en dos modos:
 *   - Bandas: 5 bandas (400 Hz–16 kHz) + control de Graves aparte, todo ±10 dB.
 *   - Pultec: modelo del EQP-1A (ver pultec.ts).
 *   <audio> → 5 bandas → Graves → 5 filtros Pultec → salida → altavoces
 * Ambos están siempre en la cadena; el modo que no se usa queda en 0 dB (transparente).
 * El circuito solo se crea la primera vez que activas el ecualizador: así, si nunca lo usas,
 * el audio sale directo como siempre (lo más seguro para la reproducción en segundo plano).
 */

export const BANDS = [400, 1000, 2500, 6300, 16000];
export const MAX_DB = 10;
/** Posición del control de Graves dentro de `gains` (va después de las 5 bandas). */
export const BASS = BANDS.length;
const BASS_FREQ = 100;
/** Largo de `gains`: 5 bandas + Graves. */
const N = BANDS.length + 1;

export interface Preset {
  id: string;
  name: string;
  gains: number[];
}

/** Única base fija: Plano. El resto son los ajustes que guardes tú con el botón +. */
export const FLAT: Preset = { id: 'flat', name: 'Plano', gains: [0, 0, 0, 0, 0, 0] };

const clamp = (v: number) => Math.max(-MAX_DB, Math.min(MAX_DB, Math.round(v * 2) / 2));

/**
 * Convierte un ajuste del ecualizador anterior (10 bandas de 31 Hz a 16 kHz) a las 5 bandas + Graves,
 * tomando la banda vieja más cercana a cada nueva; Graves es el promedio de 31, 62 y 125 Hz.
 */
function migrate(g: unknown): number[] | null {
  if (!Array.isArray(g)) return null;
  const v = g.map(Number);
  if (v.length === N) return v.map(clamp);
  if (v.length !== 10) return null;
  return [v[4], v[5], v[6], v[8], v[9], (v[0] + v[1] + v[2]) / 3].map(clamp);
}

export type EqMode = 'bands' | 'pultec';

interface EqState {
  enabled: boolean;
  mode: EqMode;
  pultec: PultecSettings;
  setMode: (m: EqMode) => void;
  setPultec: (patch: Partial<PultecSettings>) => void;
  gains: number[];
  /** 'flat', id de un ajuste guardado, o 'custom' si las barras no coinciden con ninguno. */
  preset: string;
  /** Ajustes guardados por ti. */
  saved: Preset[];
  /** Últimas barras "Personalizado", para volver a ellas tras probar otro ajuste. */
  lastCustom: number[];
  setEnabled: (v: boolean) => void;
  setBand: (i: number, db: number) => void;
  applyPreset: (id: string) => void;
  /** Guarda la posición actual de las barras con un nombre. */
  savePreset: (name: string) => void;
  deletePreset: (id: string) => void;
}

const KEY = 'eq';

export function allPresets(saved: Preset[]) {
  return [FLAT, ...saved];
}

/** Qué ajuste coincide con estas barras (o 'custom'). */
function presetFor(gains: number[], saved: Preset[]) {
  return allPresets(saved).find((p) => p.gains.every((g, k) => g === gains[k]))?.id ?? 'custom';
}

function loadSaved(): Pick<EqState, 'enabled' | 'gains' | 'preset' | 'saved' | 'lastCustom' | 'mode' | 'pultec'> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const gains = s && migrate(s.gains);
    if (gains) {
      const saved: Preset[] = Array.isArray(s.saved)
        ? s.saved.flatMap((p: Preset) => {
            const g = p && typeof p.name === 'string' ? migrate(p.gains) : null;
            return g ? [{ id: String(p.id), name: p.name, gains: g }] : [];
          })
        : [];
      const lastCustom = migrate(s.lastCustom) ?? gains;
      const mode: EqMode = s.mode === 'pultec' ? 'pultec' : 'bands';
      const pultec: PultecSettings = { ...PULTEC_DEFAULT, ...(s.pultec ?? {}) };
      return { enabled: !!s.enabled, gains, saved, preset: presetFor(gains, saved), lastCustom, mode, pultec };
    }
  } catch {
    /* nada guardado */
  }
  return {
    enabled: false,
    gains: [...FLAT.gains],
    preset: 'flat',
    saved: [],
    lastCustom: [...FLAT.gains],
    mode: 'bands',
    pultec: { ...PULTEC_DEFAULT },
  };
}

/**
 * Volumen de la app (0 a 1), se recuerda. Va al final de la cadena (después del ecualizador y el rack), así
 * regula igual el reproductor normal y el tocadiscos. Se hace con el circuito de audio y no con audio.volume
 * porque en el iPhone ese no se puede cambiar.
 */
/**
 * iPhone / iPad (solo llega por la web): el volumen lo manejan los botones del teléfono. La app no muestra su barra
 * de volumen, lo deja siempre al 100% y no lo sincroniza con la cuenta (antes, bajar el volumen en el PC lo bajaba
 * también aquí, sin forma de subirlo).
 */
export const volumenDelSistema =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const useVolumen = create<{ v: number; set: (v: number) => void }>((set) => ({
  v: (() => {
    if (volumenDelSistema) return 1;
    try {
      const x = Number(localStorage.getItem('volumen'));
      return localStorage.getItem('volumen') !== null && x >= 0 && x <= 1 ? x : 1;
    } catch {
      return 1;
    }
  })(),
  set(v) {
    v = Math.max(0, Math.min(1, v));
    set({ v });
    try {
      localStorage.setItem('volumen', String(v));
    } catch {
      /* sin espacio */
    }
    if (v < 1) ensureGraph(); // se llama desde el toque en la barra
    apply();
  },
}));
// El oído siente el volumen en escala logarítmica: con el cuadrado la barra se siente pareja de 0 a 100%.
const gananciaVolumen = () => useVolumen.getState().v ** 2;

export const useEq = create<EqState>((set, get) => ({
  ...loadSaved(),
  setEnabled(enabled) {
    if (enabled) ensureGraph(); // se llama desde un toque: el navegador permite crear el audio
    set({ enabled });
  },
  setMode: (mode) => set({ mode }),
  setPultec: (patch) => set({ pultec: { ...get().pultec, ...patch } }),
  setBand(i, db) {
    const gains = [...get().gains];
    gains[i] = clamp(db);
    const preset = presetFor(gains, get().saved);
    set(preset === 'custom' ? { gains, preset, lastCustom: gains } : { gains, preset });
  },
  applyPreset(id) {
    if (id === 'custom') {
      const gains = [...get().lastCustom];
      set({ gains, preset: presetFor(gains, get().saved) });
      return;
    }
    const p = allPresets(get().saved).find((x) => x.id === id);
    if (p) set({ gains: [...p.gains], preset: id });
  },
  savePreset(name) {
    const clean = name.trim().slice(0, 30);
    if (!clean) return;
    const p: Preset = { id: `u${Date.now().toString(36)}`, name: clean, gains: [...get().gains] };
    set({ saved: [...get().saved, p], preset: p.id });
  },
  deletePreset(id) {
    const saved = get().saved.filter((p) => p.id !== id);
    set({ saved, preset: presetFor(get().gains, saved) });
  },
}));

// ---------------- Circuito de audio ----------------

let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = []; // 5 bandas + Graves
let pultecNodes: BiquadFilterNode[] = [];
let preamp: GainNode | null = null;
let mainIn: GainNode | null = null;
/** Volumen del reproductor normal dentro del circuito (en modo vinilo queda en 0: suena el tocadiscos). */
let elementGain: GainNode | null = null;

function ensureGraph() {
  if (ctx) {
    // En el iPhone el audio puede quedar "suspended" o "interrupted" (llamadas, Siri, otra app): se reanuda.
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const source = ctx.createMediaElementSource(audio);
  filters = [...BANDS, BASS_FREQ].map((freq, i) => {
    const f = ctx!.createBiquadFilter();
    // Bandas como campanas anchas; la más aguda como estante; Graves como estante bajo (sube todo lo de abajo).
    f.type = i === BASS ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = freq;
    f.Q.value = 0.9;
    f.gain.value = 0;
    return f;
  });
  pultecNodes = PULTEC_TYPES.map((type) => {
    const f = ctx!.createBiquadFilter();
    f.type = type;
    f.gain.value = 0;
    return f;
  });
  preamp = ctx.createGain();
  // Entrada común de la cadena: aquí entran el reproductor normal y el motor de scratch del vinilo,
  // así los dos pasan por el ecualizador y el rack de efectos.
  mainIn = ctx.createGain();
  mainIn.gain.value = Math.pow(10, levelDb / 20); // nivelador de volumen (si está activo)
  elementGain = ctx.createGain();
  source.connect(elementGain);
  elementGain.connect(mainIn);
  let node: AudioNode = mainIn;
  for (const f of [...filters, ...pultecNodes]) {
    node.connect(f);
    node = f;
  }
  node.connect(preamp);
  // Limitador del nivelador de volumen: al subir canciones bajitas, ataja los picos para que no saturen.
  limitador = ctx.createDynamicsCompressor();
  aplicarLimitador();
  preamp.connect(limitador);
  // Después del ecualizador va el rack de efectos (si está cargado); si no, directo a los altavoces.
  if (audioGraphHooks.build) audioGraphHooks.build(ctx, limitador, ctx.destination);
  else limitador.connect(ctx.destination);
  apply();
}

let limitador: DynamicsCompressorNode | null = null;
let limitadorOn = false;
function aplicarLimitador() {
  if (!limitador) return;
  // Encendido: limitador rápido a -1 dBFS. Apagado: no toca nada (relación 1:1).
  limitador.threshold.value = limitadorOn ? -1 : 0;
  limitador.knee.value = 0;
  limitador.ratio.value = limitadorOn ? 20 : 1;
  limitador.attack.value = 0.002;
  limitador.release.value = 0.15;
}
/** El nivelador de volumen lo enciende (loudness.ts). */
export function setLimitador(on: boolean) {
  limitadorOn = on;
  aplicarLimitador();
}

/**
 * Para el rack de efectos (rack.ts) sin dependencias circulares:
 *  - `needed`: si devuelve true, el circuito de audio se crea aunque el ecualizador esté apagado.
 *  - `build`: conecta sus efectos entre la salida del ecualizador y los altavoces.
 */
export const audioGraphHooks: {
  needed?: () => boolean;
  build?: (ctx: AudioContext, input: AudioNode, output: AudioNode) => void;
} = {};

/** El circuito de audio, si ya existe: su contexto y la entrada común (antes del ecualizador). */
export function getAudioGraph(): { ctx: AudioContext; input: AudioNode } | null {
  return ctx && mainIn ? { ctx, input: mainIn } : null;
}

let levelDb = 0;
/** Nivelador de volumen (loudness.ts): ganancia de la canción actual en dB, en la entrada del circuito. */
export function setLevelGain(db: number) {
  levelDb = db;
  if (!ctx || !mainIn) return;
  mainIn.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, 0.05);
}

/** Sube o baja el reproductor normal dentro del circuito. `instant` = sin desvanecido. */
export function setElementLevel(v: number, instant: boolean) {
  if (!ctx || !elementGain) return;
  const g = elementGain.gain;
  g.cancelScheduledValues(0);
  if (instant) g.value = v;
  else g.setTargetAtTime(v, ctx.currentTime, 0.01);
}

/** Crea (o reanuda) el circuito de audio. Llamar desde un toque del usuario. */
export function ensureAudioGraph() {
  ensureGraph();
}

function apply() {
  if (!ctx || !preamp) return;
  const { enabled, gains, mode, pultec } = useEq.getState();
  const t = ctx.currentTime;
  const bandsOn = enabled && mode === 'bands';
  const pultecOn = enabled && mode === 'pultec';
  filters.forEach((f, i) => f.gain.setTargetAtTime(bandsOn ? gains[i] : 0, t, 0.03));
  const specs = pultecSpecs(pultec);
  pultecNodes.forEach((n, i) => {
    const s = specs[i];
    n.frequency.setTargetAtTime(s.frequency, t, 0.03);
    n.Q.setTargetAtTime(s.Q, t, 0.03);
    n.gain.setTargetAtTime(pultecOn ? s.gain : 0, t, 0.03);
  });
  // Sin compensación de volumen: subir una frecuencia la sube de verdad (decisión del usuario).
  // El único ajuste aquí es el volumen de la app.
  preamp.gain.setTargetAtTime(gananciaVolumen(), t, 0.03);
}

// Cualquier toque en la pantalla reanuda el audio si iOS lo dejó en pausa (los navegadores solo lo permiten tras un toque).
if (typeof document !== 'undefined') {
  const wake = () => {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  };
  document.addEventListener('pointerdown', wake, { passive: true });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
}

/** El reproductor la llama antes de cada play (que siempre viene de un toque). */
export function resumeEq() {
  if (useEq.getState().enabled || ctx || audioGraphHooks.needed?.() || useVolumen.getState().v < 1) ensureGraph();
  if (fadedForPause && ctx && elementGain) {
    // Vuelve después de una pausa suave: entra con un desvanecido cortito (sin "clic").
    fadedForPause = false;
    const g = elementGain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + 0.02);
  }
}

/**
 * Pausa suave. Con el sonido pasando por el circuito (ecualizador/rack), lo que oyes va un poco
 * atrasado respecto a la posición del reproductor (la latencia de salida: ~50 ms en la PC, más en
 * el iPhone y con audífonos Bluetooth). Al pausar de golpe, ese pedacito se perdía y al reanudar la
 * canción daba un saltito. Ahora se desvanece en 30 ms, se pausa y se vuelve al punto que de verdad
 * escuchaste.
 */
const PAUSE_FADE = 0.03;
let fadedForPause = false;
let pausing = false;
elementHooks.pause = () => {
  if (!ctx || !elementGain || ctx.state !== 'running' || pausing || audio.paused) {
    audio.pause();
    return;
  }
  pausing = true;
  const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
  const latency = Math.min(0.5, (ctx.baseLatency || 0) + out);
  const heardAt = Math.max(0, audio.currentTime - latency);
  const g = elementGain.gain;
  const t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(0, t + PAUSE_FADE);
  fadedForPause = true;
  const src = audio.src;
  setTimeout(() => {
    pausing = false;
    if (audio.src !== src) return; // cambió de canción mientras se desvanecía
    audio.pause();
    if (Math.abs(audio.currentTime - heardAt) < 2) audio.currentTime = heardAt;
  }, PAUSE_FADE * 1000 + 10);
};

beforePlay.push(resumeEq);

useEq.subscribe((s) => {
  apply();
  try {
    localStorage.setItem(KEY, JSON.stringify({
        enabled: s.enabled,
        mode: s.mode,
        gains: s.gains,
        preset: s.preset,
        saved: s.saved,
        lastCustom: s.lastCustom,
        pultec: s.pultec,
      }),);
  } catch {
    /* sin espacio */
  }
});

/** Para pruebas: estado real del circuito de audio. */
export function eqDebug() {
  return {
    context: ctx?.state ?? 'sin crear',
    gains: filters.map((f) => Math.round(f.gain.value * 10) / 10),
    pultec: pultecNodes.map((f) => `${f.type} ${Math.round(f.frequency.value)}Hz ${Math.round(f.gain.value * 10) / 10}dB Q${Math.round(f.Q.value * 100) / 100}`),
    preamp: preamp ? Math.round(preamp.gain.value * 100) / 100 : null,
  };
}

/** Vuelve a leer el ecualizador guardado (lo usa la sincronización con tu cuenta). */
export function recargarEq() {
  useEq.setState(loadSaved());
}
