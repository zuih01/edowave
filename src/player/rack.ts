import { create } from 'zustand';
import { trackBpm } from '../reco/store';
import { audioGraphHooks, ensureAudioGraph } from './equalizer';
import { usePlayer } from './player';

/**
 * Rack de efectos. Por ahora tiene un eco inspirado en el Ursa Major Space Station SST-282 (1978):
 *
 * El original era una sola línea de retardo con varias "cabezas" de lectura (como una grabadora de
 * varios cabezales): una cabeza vuelve a la entrada (las repeticiones) y otras se suman en pares
 * izquierda/derecha. Entre sus 16 programas había "slaps", racimos de retardos ("fatty" y "cloud")
 * y "space repeats". Su sonido: ancho de banda de ~7 kHz, un poco de grano y tiempos que se mueven
 * levemente (modulación).
 *
 * Versión simplificada para la app: 4 modos (Slap, Fatty, Space, Cloud), cantidad y tiempo en
 * figuras musicales (1/16, 1/8, 1/4, 1/2) sincronizado con el tempo de la canción que suena.
 *
 *   salida del ecualizador ─┬─────────────────────────────── seco ──────┬─→ altavoces
 *                           └→ envío → paso-alto → saturación → línea ──┤
 *                                línea ─→ 8 cabezas (tiempo, nivel, lado) → filtro 7 kHz → mojado ┘
 *                                línea ─→ cabeza de realimentación → filtro → (difusión) → vuelve a la línea
 */

export type EchoMode = 0 | 1 | 2 | 3;
export const ECHO_MODES = ['SLAP', 'FATTY', 'SPACE', 'CLOUD'] as const;
export type Division = 16 | 8 | 4 | 2;

interface Tap {
  t: number; // en múltiplos del tiempo elegido (1 = una figura)
  g: number; // nivel
  pan: number; // -1 izquierda … 1 derecha
}

interface ModeDef {
  taps: Tap[];
  fbT: number; // dónde está la cabeza que vuelve a la entrada
  fbGain: number; // cuánto vuelve (más = más repeticiones)
  fbTone: number; // filtro de la realimentación (cada vuelta más oscura)
  diffuse: boolean; // difusión en la realimentación (nube)
  mod: number; // modulación de los tiempos (segundos)
}

const MODES: ModeDef[] = [
  // SLAP: una repetición seca, casi sin cola
  { taps: [{ t: 1, g: 1, pan: 0 }], fbT: 1, fbGain: 0.12, fbTone: 6000, diffuse: false, mod: 0.0004 },
  // FATTY: racimo de 4 cabezas muy juntas, abiertas en estéreo → repeticiones gruesas
  {
    taps: [
      { t: 1, g: 0.8, pan: -0.6 },
      { t: 1.035, g: 0.72, pan: 0.6 },
      { t: 1.07, g: 0.6, pan: -0.3 },
      { t: 1.11, g: 0.55, pan: 0.35 },
    ],
    fbT: 1,
    fbGain: 0.32,
    fbTone: 5500,
    diffuse: false,
    mod: 0.0007,
  },
  // SPACE: repeticiones en 1, 2 y 3 figuras, rebotando de lado a lado y oscureciéndose
  {
    taps: [
      { t: 1, g: 0.9, pan: -0.75 },
      { t: 2, g: 0.75, pan: 0.75 },
      { t: 3, g: 0.55, pan: -0.4 },
    ],
    fbT: 3,
    fbGain: 0.5,
    fbTone: 4200,
    diffuse: false,
    mod: 0.0012,
  },
  // CLOUD: 8 cabezas irregulares + difusión en la realimentación → una nube de eco
  {
    taps: [
      { t: 0.5, g: 0.55, pan: -0.8 },
      { t: 0.73, g: 0.5, pan: 0.8 },
      { t: 0.92, g: 0.48, pan: -0.5 },
      { t: 1.17, g: 0.45, pan: 0.6 },
      { t: 1.38, g: 0.42, pan: -0.7 },
      { t: 1.66, g: 0.38, pan: 0.4 },
      { t: 1.89, g: 0.34, pan: -0.3 },
      { t: 2.21, g: 0.3, pan: 0.7 },
    ],
    fbT: 2.21,
    fbGain: 0.55,
    fbTone: 3800,
    diffuse: true,
    mod: 0.0025,
  },
];

const MAX_TAPS = 8;
const MAX_DELAY = 8; // segundos (Space en 1/2 con tempos lentos llega a ~4 s)
const DEFAULT_BPM = 120;

interface EchoSettings {
  on: boolean;
  mode: EchoMode;
  division: Division;
  amount: number; // 0–10
}

/**
 * Compresor estilo nivelador óptico (inspirado en el LA-2A): solo "reducción de picos", "ganancia"
 * y un selector comprimir/limitar. Respuesta suave y lenta, como una célula óptica.
 */
interface CompSettings {
  on: boolean;
  peak: number; // reducción de picos 0–10 (en la perilla se lee 0–100)
  gain: number; // ganancia de salida 0–10 (5 = sin cambio)
  limit: boolean; // false = COMP (suave), true = LIMIT (más firme)
}

/**
 * Flanger de "dos vinilos": el mismo disco sonando dos veces a la vez, y uno de los dos tocadiscos con
 * el pitch movido ±1–2 % y a pulso (inestable). Las dos copias se desfasan unos milisegundos, se acercan
 * y se alejan sin un patrón fijo, y aparece el barrido de "avión que pasa" (jet).
 */
interface FlangerSettings {
  on: boolean;
  amount: number; // 0–10: mezcla (0 = solo el disco original; 10 = los dos discos al mismo nivel)
}

interface RackState {
  /** Rack activado (desde Configuración o el interruptor de la pantalla del rack). */
  enabled: boolean;
  echo: EchoSettings;
  comp: CompSettings;
  flanger: FlangerSettings;
  setEnabled: (v: boolean) => void;
  setFlanger: (patch: Partial<FlangerSettings>) => void;
  setEcho: (patch: Partial<EchoSettings>) => void;
  setComp: (patch: Partial<CompSettings>) => void;
}

const KEY = 'rack';
const ECHO_DEFAULT: EchoSettings = { on: true, mode: 1, division: 8, amount: 4 };
const COMP_DEFAULT: CompSettings = { on: false, peak: 4, gain: 5, limit: false };
const FLANGER_DEFAULT: FlangerSettings = { on: false, amount: 6 };

function load(): Pick<RackState, 'enabled' | 'echo' | 'comp' | 'flanger'> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s)
      return {
        enabled: !!s.enabled,
        echo: { ...ECHO_DEFAULT, ...(s.echo ?? {}) },
        comp: { ...COMP_DEFAULT, ...(s.comp ?? {}) },
        flanger: { ...FLANGER_DEFAULT, ...(s.flanger ?? {}) },
      };
  } catch {
    /* nada guardado */
  }
  return { enabled: false, echo: { ...ECHO_DEFAULT }, comp: { ...COMP_DEFAULT }, flanger: { ...FLANGER_DEFAULT } };
}

export const useRack = create<RackState>((set, get) => ({
  ...load(),
  setEnabled(enabled) {
    if (enabled) ensureAudioGraph(); // viene de un toque: el navegador permite crear el audio
    set({ enabled });
  },
  setEcho(patch) {
    if (patch.on || (get().enabled && get().echo.on)) ensureAudioGraph();
    set({ echo: { ...get().echo, ...patch } });
  },
  setComp(patch) {
    if (patch.on || (get().enabled && get().comp.on)) ensureAudioGraph();
    set({ comp: { ...get().comp, ...patch } });
  },
  setFlanger(patch) {
    if (patch.on || (get().enabled && get().flanger.on)) ensureAudioGraph();
    set({ flanger: { ...get().flanger, ...patch } });
  },
}));

useRack.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: s.enabled, echo: s.echo, comp: s.comp, flanger: s.flanger }));
  } catch {
    /* sin espacio */
  }
  apply();
});

// ---------------- Circuito de audio ----------------

let ctx: AudioContext | null = null;
let send: GainNode;
let line: GainNode;
let taps: { delay: DelayNode; gain: GainNode; pan: StereoPannerNode }[] = [];
let fbDelay: DelayNode;
let fbFilter: BiquadFilterNode;
let fbGain: GainNode;
let diffusers: BiquadFilterNode[] = [];
let diffuseIn: GainNode;
let directFb: GainNode;
let modDepths: GainNode[] = [];
let wet: GainNode;
// Compresor
let comp: DynamicsCompressorNode;
let compPath: GainNode; // camino comprimido (con su ganancia de salida)
let compBypass: GainNode; // camino directo cuando el compresor está apagado
let makeup: GainNode;
// Flanger
let flWet: GainNode;
let flOut: GainNode;
let flFeedback: GainNode;
let flDepth: GainNode;
let flWander: ConstantSourceNode;

/** Saturación suave (cinta/conversores de la época), sin endurecer el sonido. */
function softClip(amount = 1.6) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

/** Calidez de válvula: igual nivel en señales normales (pendiente 1), solo redondea los picos. */
function warmCurve(k: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / k;
  }
  return curve;
}

/*
 * Movimiento del flanger, medido el 21-11-2026 con "Sam" en dos decks de rekordbox (pitch ±6 %,
 * fader del DDJ-400 a mano; ver analisis-flanger/). En la parte buena de la toma:
 *  - toques que alternan casi siempre (arriba, abajo, arriba…), con pausas en 0 % de 0,4–1,1 s
 *    (a veces hasta 6 s);
 *  - toques cortos de 0,5–1,5 s llegando a 0,1–0,3 %, o largos de 3–7 s apenas movidos (0,04–0,11 %);
 *  - el fader se mueve a ~1–3 % por segundo, y cada toque corre el desfase 1–4 ms.
 * El retardo es la integral del pitch: un pitch de 0,2 % durante 1 s = 2 ms de desfase.
 */
const FL_CENTER = 0.006; // s
const FL_MIN = -0.0045; // el retardo no baja de ~1,5 ms…
const FL_MAX = 0.005; // …ni pasa de ~11 ms
const FL_STEP = 0.01; // resolución de la curva (s)

const between = (a: number, b: number) => a + Math.random() * (b - a);

/** Pausa con el fader en 0 % antes del próximo toque. */
function flangerRest() {
  return Math.random() < 0.1 ? between(2, 6) : between(0.4, 1.2);
}

/**
 * Un toque de pitch: sube a su punto, se queda y vuelve a 0 %. Devuelve el desplazamiento del retardo
 * (s, respecto del centro) cada FL_STEP, partiendo de `pos`. Si se saldría del rango, va al otro lado.
 */
function flangerPush(pos: number, sign: number): Float32Array {
  const long = Math.random() < 0.4;
  const dur = long ? between(2.5, 7) : between(0.5, 1.6);
  const peak = long ? between(0.0004, 0.0011) : between(0.0011, 0.0032);
  const rate = between(0.012, 0.03); // velocidad del fader (fracción de pitch por segundo)
  const ramp = Math.min(peak / rate, dur / 2);
  const top = Math.min(peak, ramp * rate);
  const n = Math.max(2, Math.round(dur / FL_STEP));
  const pitch = (i: number) => {
    const t = i * FL_STEP;
    return top * Math.min(1, t / ramp, (dur - t) / ramp);
  };
  let shift = 0;
  for (let i = 0; i < n; i++) shift += pitch(i) * FL_STEP;
  if (pos + sign * shift > FL_MAX || pos + sign * shift < FL_MIN) sign = -sign;
  const k = Math.min(1, (sign > 0 ? FL_MAX - pos : pos - FL_MIN) / shift); // nunca se pasa del borde
  const curve = new Float32Array(n + 1);
  curve[0] = pos;
  for (let i = 0; i < n; i++) curve[i + 1] = curve[i] + sign * k * pitch(i) * FL_STEP;
  return curve;
}

const prevNeeded = audioGraphHooks.needed; // otros módulos (nivelador) también pueden necesitar el circuito
audioGraphHooks.needed = () => {
  const s = useRack.getState();
  return !!prevNeeded?.() || (s.enabled && (s.echo.on || s.comp.on || s.flanger.on));
};

audioGraphHooks.build = (c, input, output) => {
  ctx = c;

  // 1) Compresor (va primero, como en un estudio): directo o comprimido, con un cruce suave al cambiar.
  const mid = c.createGain();
  compBypass = c.createGain();
  compPath = c.createGain();
  compPath.gain.value = 0;
  comp = c.createDynamicsCompressor();
  // Tiempos de una célula óptica: ataca rápido pero sin brusquedad y suelta despacio.
  comp.attack.value = 0.012;
  comp.release.value = 0.45;
  makeup = c.createGain();
  const warmth = c.createWaveShaper(); // un toque de calidez de válvula, casi imperceptible
  warmth.curve = warmCurve(0.6);
  input.connect(compBypass).connect(mid);
  input.connect(comp).connect(makeup).connect(warmth).connect(compPath).connect(mid);

  // 2) Flanger de dos vinilos: el disco original + una copia que se adelanta y atrasa unos milisegundos.
  //    El pitch de la copia va y viene entre -1 % y +1 %, a una velocidad que cambia sola → avión.
  flOut = c.createGain();
  mid.connect(flOut); // disco 1 (original)
  const flDelay = c.createDelay(0.05);
  flDelay.delayTime.value = FL_CENTER; // centro del vaivén (de ~1,5 a ~11 ms)
  flWet = c.createGain();
  flWet.gain.value = 0;
  flFeedback = c.createGain(); // un poquito de realimentación: el barrido "silba" como un jet
  flFeedback.gain.value = 0;
  mid.connect(flDelay).connect(flWet).connect(flOut); // disco 2 (con el pitch inestable)
  flDelay.connect(flFeedback).connect(flDelay);
  flDepth = c.createGain(); // con el flanger apagado no se mueve nada
  flDepth.gain.value = 0;
  flDepth.connect(flDelay.delayTime);
  // El retardo del disco 2 lo mueven "toques" de pitch como los de una persona en el DDJ (ver
  // flangerPush): se programan con anticipación en el reloj del audio, así siguen sonando bien
  // aunque la pestaña o la app estén en segundo plano.
  const wander = (flWander = c.createConstantSource());
  wander.offset.value = 0;
  wander.connect(flDepth);
  wander.start();
  let planUntil = c.currentTime + 0.5;
  let pos = 0; // desplazamiento actual respecto del centro (s)
  let sign = Math.random() < 0.5 ? 1 : -1;
  const plan = () => {
    const now = c.currentTime;
    if (planUntil < now + 0.2) planUntil = now + 0.2; // el reloj se adelantó (pausa, suspensión)
    while (planUntil < now + 30) {
      planUntil += flangerRest();
      const curve = flangerPush(pos, sign);
      wander.offset.setValueCurveAtTime(curve, planUntil, curve.length * FL_STEP);
      planUntil += curve.length * FL_STEP + 0.02;
      pos = curve[curve.length - 1];
      if (Math.random() < 0.95) sign = -sign; // casi siempre alterna: un toque arriba, el otro abajo
    }
  };
  plan();
  setInterval(plan, 2000);

  // 3) Señal seca (ya comprimida y con flanger si toca) a los altavoces; el eco se alimenta de aquí.
  flOut.connect(output);

  send = c.createGain();
  send.gain.value = 0;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 140; // el eco sin graves no embarra
  const sat = c.createWaveShaper();
  sat.curve = softClip();
  sat.oversample = '2x';
  line = c.createGain();
  flOut.connect(send).connect(hp).connect(sat).connect(line);

  // Salida mojada: suma de cabezas → filtro de 7 kHz (ancho de banda del original) → cantidad
  const wetSum = c.createGain();
  const bw = c.createBiquadFilter();
  bw.type = 'lowpass';
  bw.frequency.value = 7000;
  bw.Q.value = 0.6;
  wet = c.createGain();
  wet.gain.value = 0;
  wetSum.connect(bw).connect(wet).connect(output);

  // Modulación lenta de los tiempos (dos osciladores a ritmos distintos)
  const lfos = [0.37, 0.53].map((hz) => {
    const o = c.createOscillator();
    o.frequency.value = hz;
    o.start();
    return o;
  });
  modDepths = lfos.map((o) => {
    const g = c.createGain();
    g.gain.value = 0;
    o.connect(g);
    return g;
  });

  taps = Array.from({ length: MAX_TAPS }, (_, i) => {
    const delay = c.createDelay(MAX_DELAY);
    const gain = c.createGain();
    gain.gain.value = 0;
    const pan = c.createStereoPanner();
    line.connect(delay).connect(gain).connect(pan).connect(wetSum);
    modDepths[i % 2].connect(delay.delayTime);
    return { delay, gain, pan };
  });

  // Realimentación: cabeza propia → filtro (cada vuelta más oscura) → [difusión] → nivel → vuelve a la línea
  fbDelay = c.createDelay(MAX_DELAY);
  fbFilter = c.createBiquadFilter();
  fbFilter.type = 'lowpass';
  fbGain = c.createGain();
  fbGain.gain.value = 0;
  modDepths[0].connect(fbDelay.delayTime);
  line.connect(fbDelay).connect(fbFilter);
  // Camino directo o difuso (para Cloud): 3 filtros "pasa-todo" que desparraman la fase
  directFb = c.createGain();
  diffuseIn = c.createGain();
  diffusers = [420, 1100, 2600].map((f) => {
    const a = c.createBiquadFilter();
    a.type = 'allpass';
    a.frequency.value = f;
    a.Q.value = 0.7;
    return a;
  });
  fbFilter.connect(directFb).connect(fbGain);
  fbFilter.connect(diffuseIn);
  diffusers.reduce<AudioNode>((prev, a) => prev.connect(a), diffuseIn).connect(fbGain);
  fbGain.connect(line);

  apply();
};

/** Duración de una figura (1/2, 1/4, 1/8, 1/16) según el tempo de la canción que suena. */
export function currentBpm() {
  const s = usePlayer.getState();
  const id = s.queue[s.index];
  return (id && trackBpm(id)) || DEFAULT_BPM;
}

function applyComp() {
  const { enabled, comp: cs } = useRack.getState();
  const on = enabled && cs.on;
  const t = ctx!.currentTime;
  compBypass.gain.setTargetAtTime(on ? 0 : 1, t, 0.03);
  compPath.gain.setTargetAtTime(on ? 1 : 0, t, 0.03);
  // Reducción de picos: baja el umbral (0 → no comprime, 10 → -40 dB)
  comp.threshold.setTargetAtTime(-4 * cs.peak, t, 0.05);
  // COMP: proporción suave y rodilla ancha (como el LA-2A); LIMIT: más firme
  comp.ratio.setTargetAtTime(cs.limit ? 12 : 3, t, 0.05);
  comp.knee.setTargetAtTime(cs.limit ? 8 : 24, t, 0.05);
  // Ganancia: 5 = sin cambio, de -12 a +12 dB
  makeup.gain.setTargetAtTime(Math.pow(10, ((cs.gain - 5) * 2.4) / 20), t, 0.05);
}

/** Cuánto está comprimiendo ahora mismo (dB, 0 o negativo), para el medidor de aguja. */
export function compReduction() {
  if (!ctx || !comp) return 0;
  const { enabled, comp: cs } = useRack.getState();
  return enabled && cs.on ? comp.reduction : 0;
}

const flanging = () => {
  const s = useRack.getState();
  return s.enabled && s.flanger.on && s.flanger.amount > 0;
};

function applyFlanger() {
  const { flanger: fs } = useRack.getState();
  const on = flanging();
  const t = ctx!.currentTime;
  const w = on ? fs.amount / 10 : 0; // 0 % → solo el original; 100 % → los dos discos iguales
  flWet.gain.setTargetAtTime(w, t, 0.08);
  flFeedback.gain.setTargetAtTime(on ? 0.2 : 0, t, 0.08);
  // Dos discos iguales suenan más fuerte: se compensa para que el volumen no salte.
  flOut.gain.setTargetAtTime(1 / (1 + 0.55 * w), t, 0.08);
  flDepth.gain.setTargetAtTime(on ? 1 : 0, t, 0.3);
}

function apply() {
  if (!ctx) return;
  applyComp();
  applyFlanger();
  const { enabled, echo } = useRack.getState();
  const active = enabled && echo.on;
  const t = ctx.currentTime;
  const beat = 60 / currentBpm(); // una negra
  const T = beat * (4 / echo.division); // 1/2 → 2 negras, 1/4 → 1 negra, 1/8 → media, 1/16 → un cuarto
  const m = MODES[echo.mode];
  const ramp = 0.06;

  send.gain.setTargetAtTime(active ? 1 : 0, t, ramp);
  // Cantidad: curva suave para que los primeros pasos se sientan finos
  wet.gain.setTargetAtTime(active ? Math.pow(echo.amount / 10, 1.3) * 0.9 : 0, t, 0.12);

  taps.forEach((tap, i) => {
    const d = m.taps[i];
    tap.gain.gain.setTargetAtTime(d ? d.g : 0, t, ramp);
    if (d) {
      tap.delay.delayTime.setTargetAtTime(Math.min(MAX_DELAY - 0.01, d.t * T), t, ramp);
      tap.pan.pan.setTargetAtTime(d.pan, t, ramp);
    }
  });
  fbDelay.delayTime.setTargetAtTime(Math.min(MAX_DELAY - 0.01, m.fbT * T), t, ramp);
  fbFilter.frequency.setTargetAtTime(m.fbTone, t, ramp);
  fbGain.gain.setTargetAtTime(active ? m.fbGain : 0, t, ramp);
  directFb.gain.setTargetAtTime(m.diffuse ? 0 : 1, t, ramp);
  diffuseIn.gain.setTargetAtTime(m.diffuse ? 1 : 0, t, ramp);
  modDepths.forEach((g) => g.gain.setTargetAtTime(m.mod, t, 0.2));
}

// Al cambiar de canción, el eco se ajusta a su tempo.
usePlayer.subscribe((s, prev) => {
  if (s.queue[s.index] !== prev.queue[prev.index]) apply();
});

/** Para pruebas: valores reales del circuito. */
export function rackDebug() {
  if (!ctx) return { context: 'sin crear' };
  return {
    context: ctx.state,
    comp: {
      path: +compPath.gain.value.toFixed(2),
      bypass: +compBypass.gain.value.toFixed(2),
      threshold: +comp.threshold.value.toFixed(1),
      ratio: +comp.ratio.value.toFixed(1),
      makeupDb: +(20 * Math.log10(makeup.gain.value)).toFixed(1),
      reduction: +comp.reduction.toFixed(1),
    },
    flanger: { delayMs: +((FL_CENTER + flWander.offset.value * flDepth.gain.value) * 1000).toFixed(2), wet: +flWet.gain.value.toFixed(2), out: +flOut.gain.value.toFixed(2), feedback: +flFeedback.gain.value.toFixed(2) },
    bpm: currentBpm(),
    send: +send.gain.value.toFixed(2),
    wet: +wet.gain.value.toFixed(2),
    feedback: +fbGain.gain.value.toFixed(2),
    taps: taps.filter((x) => x.gain.gain.value > 0.01).map((x) => `${Math.round(x.delay.delayTime.value * 1000)}ms g${x.gain.gain.value.toFixed(2)} pan${x.pan.pan.value.toFixed(1)}`),
  };
}

/** Vuelve a leer el rack guardado (lo usa la sincronización con tu cuenta). */
export function recargarRack() {
  useRack.setState(load());
}
