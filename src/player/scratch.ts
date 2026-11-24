import { create } from 'zustand';
import { getAudio } from '../db';
import { diag } from '../diag';
import { ensureAudioGraph, getAudioGraph, setElementLevel } from './equalizer';
import { useAutomix } from './automixStore';
import { getMeasure, levelGainDb, levelHooks, reapplyLevel, useLeveler } from './loudness';
import { addListened, audio, deckHooks, onMixAdvance, onTrackEnd, startAudio, streamActualCargado, trackById, usePlayer } from './player';
import { useCuenta } from '../server/cuenta';

/**
 * Tocadiscos del modo vinilo (inspirado en una Technics SL-1200).
 *
 * En modo vinilo TODO el sonido sale de este motor: tiene la canción decodificada en memoria (estéreo,
 * calidad completa) y la lee a la velocidad y en la dirección en que gira el disco. No hay intercambio
 * con el reproductor normal al tocar o soltar el disco, así que no hay pausas.
 *
 * El <audio> normal sigue sonando en silencio (volumen 0 dentro del circuito) solo para que el iPhone
 * mantenga la sesión de audio, la pantalla de bloqueo y los controles del sistema.
 *
 * Comportamiento tipo SL-1200:
 *  - Arranque (play): el plato llega a velocidad en ~0,7 s (tracción directa, mucho torque).
 *  - Parada (pausa): freno electrónico, el disco se detiene en ~1 s bajando el tono.
 *  - Dedo encima: el disco se frena (el plato sigue girando debajo del slipmat).
 *  - Al soltar: el disco recupera la velocidad casi al instante, arrastrado por el plato.
 *
 * El cálculo del sonido va en el HILO DE AUDIO (AudioWorklet), así no compite con la pantalla.
 * Si el navegador no lo permite (página sin https), el modo vinilo solo frena el reproductor normal.
 */

/** Tiempos (constante de tiempo en segundos; el cambio queda completo en ~3 veces este valor). */
export const TAU = {
  start: 0.22, // play: ~0,7 s hasta la velocidad
  stop: 0.32, // pausa: ~1 s hasta detenerse
  hold: 0.03, // dedo encima: frenada brusca (~0,1 s)
  release: 0.06, // al soltar: vuelve a velocidad en ~0,2 s (slipmat)
};

/**
 * El modo vinilo está en pruebas: por ahora solo lo puede usar la cuenta "zuih". Para los demás aparece como
 * "Próximamente" y no se puede encender. Para abrirlo a todos: que esto devuelva siempre true.
 */
export const viniloDisponible = () => {
  const c = useCuenta.getState();
  return !!c.token && c.nombre?.trim().toLowerCase() === 'zuih';
};

/** Ajuste "Modo vinilo" (se recuerda entre sesiones). */
export const useVinyl = create<{ on: boolean; set: (v: boolean) => void }>((set) => ({
  on: (() => {
    try {
      return viniloDisponible() && localStorage.getItem('vinyl') === 'on';
    } catch {
      return false;
    }
  })(),
  set(on) {
    if (on && !viniloDisponible()) return;
    set({ on });
    try {
      localStorage.setItem('vinyl', on ? 'on' : 'off');
    } catch {
      /* sin espacio */
    }
  },
}));

// Al entrar o salir de una cuenta: el modo vinilo se apaga para quien no lo tiene, y vuelve como lo dejó "zuih".
useCuenta.subscribe(() => {
  let guardado = false;
  try {
    guardado = localStorage.getItem('vinyl') === 'on';
  } catch {
    /* sin almacenamiento */
  }
  const on = viniloDisponible() && guardado;
  if (useVinyl.getState().on !== on) useVinyl.setState({ on });
});

// ---------------- Motor en el hilo de audio ----------------

const WORKLET_SRC = `
const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const filt = () => ({ lx: 0, ly: 0, rx: 0, ry: 0, l1: 0, l2: 0, r1: 0, r2: 0 });
class VinylDeck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tracks = new Map(); this.cur = null; this.id = null;
    this.pos = 0; this.vel = 0; this.mode = 'rate'; this.targetRate = 0; this.tau = 0.1; this.target = 0;
    this.gain = 0; this.gainTarget = 0; this.jumpTo = null; this.endSent = false; this.off = false;
    this.vg = 1; // volumen propio de la canción (nivelador, en Automix)
    this.f = filt(); this.blocks = 0; this.oL = 0; this.oR = 0; this.A = 0;
    this.mix = null; // Automix: la siguiente canción, preparada o entrando
    this.tail = null; // canción anterior apagándose en unos milisegundos (corte sin "clic")
    this.port.onmessage = (e) => this.onMsg(e.data);
  }
  onMsg(m) {
    if (m.t === 'load') this.tracks.set(m.id, { pcm: m.pcm, rate: m.rate, frames: m.pcm.length / 2 });
    else if (m.t === 'drop') { if (m.id !== this.id && !(this.mix && this.mix.id === m.id)) this.tracks.delete(m.id); }
    else if (m.t === 'select') {
      // Saltar en mitad de una mezcla: queda sonando la que estaba entrando, desde donde iba.
      if (m.promote && this.mix && this.mix.started && !this.mix.kill && this.mix.id === m.id) { this.promote(); return; }
      const tr = this.tracks.get(m.id);
      if (!tr) return;
      if (m.xf && this.cur && this.gain > 0.01) this.tail = { tr: this.cur, pos: this.pos, vel: this.vel, f: this.f, g: this.gain * this.vg };
      this.cur = tr; this.id = m.id; this.pos = m.at; this.target = m.at; this.vel = m.v;
      this.mode = 'rate'; this.targetRate = m.rate; this.tau = m.tau; this.f = filt(); this.vg = m.g ?? 1;
      this.endSent = false; this.off = false; this.jumpTo = null; this.gain = 0; this.gainTarget = 1; this.mix = null;
    }
    else if (m.t === 'rate') { this.mode = 'rate'; this.targetRate = m.r; this.tau = m.tau; }
    else if (m.t === 'nudge') {
      if (!this.cur) return;
      if (this.mode !== 'follow') { this.mode = 'follow'; this.target = this.pos; }
      this.target = Math.max(0, Math.min(this.cur.frames / this.cur.rate, this.target + m.sec));
    }
    else if (m.t === 'jump') { this.jumpTo = m.pos; this.gainTarget = 0; if (this.mix && this.mix.started) this.mix.kill = true; }
    else if (m.t === 'off') { this.off = true; this.gainTarget = 0; }
    else if (m.t === 'vg') this.vg = m.g;
    else if (m.t === 'arm') {
      const tr = this.tracks.get(m.id);
      if (!tr || m.forId !== this.id || (this.mix && this.mix.started)) return;
      this.mix = { id: m.id, tr, outStart: m.outStart, outEnd: m.outEnd, inAt: m.inAt, ratio: m.ratio, vg: m.g ?? 1,
        started: false, kill: false, kg: 1, pos: m.inAt, f: filt(), gOut: 1 };
    }
    else if (m.t === 'disarm') {
      if (!this.mix) return;
      if (this.mix.started) this.mix.kill = true; else this.mix = null;
    }
  }
  /** La canción que entraba pasa a ser la principal. */
  promote() {
    const mx = this.mix;
    this.tail = { tr: this.cur, pos: this.pos, vel: this.vel, f: this.f, g: this.gain * this.vg * mx.gOut };
    this.cur = mx.tr; this.id = mx.id; this.pos = mx.pos; this.target = mx.pos; this.vel = this.vel * mx.ratio;
    this.mode = 'rate'; this.targetRate = 1; this.tau = 0.5; // el pitch vuelve a 0 % en ~1,5 s
    this.f = mx.f; this.vg = mx.vg; this.endSent = false; this.mix = null;
    this.port.postMessage({ t: 'promoted', id: this.id, pos: this.pos });
  }
  /** Lee una canción en \`pos\` (con interpolación) y deja la muestra en oL/oR. \`bass\` 0–1: cuánto bajo deja. */
  read(tr, pos, f, bass) {
    const x = pos * tr.rate, k = Math.floor(x), p = tr.pcm;
    let l = 0, r = 0;
    if (k >= 0 && k < tr.frames - 1) {
      const fr = x - k, j = 2 * k;
      l = (p[j] + (p[j + 2] - p[j]) * fr) / 32768;
      r = (p[j + 1] + (p[j + 3] - p[j + 1]) * fr) / 32768;
    }
    // Paso-alto muy bajo (~4 Hz): sin él, el disco quieto dejaría un "golpe" de corriente continua.
    const yl = l - f.lx + 0.9995 * f.ly; f.lx = l; f.ly = yl;
    const yr = r - f.rx + 0.9995 * f.ry; f.rx = r; f.ry = yr;
    // Graves (bajo ~200 Hz) por separado, para intercambiarlos en la mezcla como un DJ.
    const A = this.A;
    f.l1 += A * (yl - f.l1); f.l2 += A * (f.l1 - f.l2);
    f.r1 += A * (yr - f.r1); f.r2 += A * (f.r1 - f.r2);
    this.oL = yl - f.l2 * (1 - bass);
    this.oR = yr - f.r2 * (1 - bass);
  }
  process(_inputs, outputs) {
    const o = outputs[0];
    const L = o[0], R = o[1] || o[0];
    if (!L) return true;
    if (!this.cur && !this.tail) { L.fill(0); if (R !== L) R.fill(0); return true; }
    const sr = sampleRate;
    const aRate = 1 - Math.exp(-1 / (this.tau * sr));
    const aFollow = 1 - Math.exp(-1 / (0.012 * sr));
    const aGain = 1 - Math.exp(-1 / (0.004 * sr));
    const aFast = 1 - Math.exp(-1 / (0.008 * sr));
    this.A = 1 - Math.exp((-2 * Math.PI * 200) / sr);
    for (let i = 0; i < L.length; i++) {
      let outL = 0, outR = 0;
      const tl = this.tail;
      if (tl) {
        tl.pos += tl.vel / sr;
        tl.g -= tl.g * aFast;
        this.read(tl.tr, tl.pos, tl.f, 1);
        outL += this.oL * tl.g; outR += this.oR * tl.g;
        if (tl.g < 1e-4) this.tail = null;
      }
      const tr = this.cur;
      if (tr) {
        const dur = tr.frames / tr.rate;
        if (this.jumpTo !== null && this.gain < 0.002) {
          this.pos = this.target = this.jumpTo; this.jumpTo = null; this.endSent = false;
          if (!this.off) this.gainTarget = 1;
        }
        if (this.mode === 'follow') {
          const want = Math.max(-6, Math.min(6, (this.target - this.pos) / 0.025));
          this.vel += (want - this.vel) * aFollow;
        } else {
          this.vel += (this.targetRate - this.vel) * aRate;
        }
        const prev = this.pos;
        this.pos += this.vel / sr;
        if (this.pos < 0) this.pos = 0; else if (this.pos > dur) this.pos = dur;
        this.gain += (this.gainTarget - this.gain) * aGain;
        let gOut = 1, bOut = 1, comp = 1;
        const mx = this.mix;
        if (mx) {
          if (!mx.started && this.mode === 'rate' && this.vel > 0.3 && prev < mx.outStart && this.pos >= mx.outStart) {
            mx.started = true;
            this.port.postMessage({ t: 'mixstart', id: mx.id });
          }
          if (mx.started) {
            // Mezcla: la que entra va amarrada a los golpes de la que sale (misma rejilla, pitch ajustado).
            const p = (this.pos - mx.outStart) / (mx.outEnd - mx.outStart);
            mx.pos = mx.inAt + mx.ratio * (this.pos - mx.outStart);
            let gIn = smooth(p / 0.4); // entra sin graves, subiendo
            const bIn = smooth((p - 0.5) / 0.0625); // a la mitad se intercambian los graves (en 1 golpe)
            bOut = 1 - bIn;
            gOut = 1 - smooth((p - 0.55) / 0.45); // y la que sale se va apagando
            if (mx.kill) {
              mx.kg -= mx.kg * aFast;
              gIn *= mx.kg;
              gOut += (1 - gOut) * (1 - mx.kg);
              bOut += (1 - bOut) * (1 - mx.kg);
            }
            mx.gOut = gOut;
            comp = 1 - 0.25 * gIn * gOut; // las dos a la vez: un poco más bajo para no saturar
            this.read(mx.tr, mx.pos, mx.f, mx.kill ? bIn * mx.kg : bIn);
            const g = gIn * mx.vg * comp * this.gain;
            outL += this.oL * g; outR += this.oR * g;
          }
        }
        this.read(tr, this.pos, this.f, bOut);
        const g = this.gain * this.vg * gOut * comp;
        outL += this.oL * g; outR += this.oR * g;
        if (mx && mx.started) {
          if (mx.kill && mx.kg < 1e-4) { this.mix = null; this.port.postMessage({ t: 'mixcancel' }); }
          else if (!mx.kill && (this.pos - mx.outStart) >= (mx.outEnd - mx.outStart)) {
            // Terminó la mezcla: la que entró es ahora la principal; su pitch vuelve a 0 % de a poco (~15 s).
            this.cur = mx.tr; this.id = mx.id; this.pos = mx.pos; this.target = mx.pos; this.vel = this.vel * mx.ratio;
            this.mode = 'rate'; this.targetRate = 1; this.tau = 5; this.f = mx.f; this.vg = mx.vg;
            this.endSent = false; this.mix = null;
            this.port.postMessage({ t: 'swapped', id: this.id, pos: this.pos });
          }
        }
      }
      L[i] = outL;
      if (R !== L) R[i] = outR;
    }
    if (this.off && this.gain < 1e-4 && this.cur) {
      this.cur = null; this.id = null; this.mix = null;
      this.port.postMessage({ t: 'pos', pos: this.pos, vel: 0, id: null });
      return true;
    }
    const cur = this.cur;
    if (cur && !this.endSent && this.mode === 'rate' && this.vel > 0.1 && this.pos >= cur.frames / cur.rate - 0.0005) {
      this.endSent = true;
      this.port.postMessage({ t: 'end', id: this.id });
    }
    if (++this.blocks % 6 === 0) {
      const mx = this.mix;
      this.port.postMessage({ t: 'pos', pos: this.pos, vel: this.vel, id: this.id, mixPos: mx && mx.started ? mx.pos : null });
    }
    return true;
  }
}
registerProcessor('vinyl-deck', VinylDeck);
`;

let node: AudioWorkletNode | null = null;
let nodeCtx: AudioContext | null = null;
let nodeLoading: Promise<void> | null = null;
let unsupported = false;

/** Último aviso del motor: posición y velocidad (1 = velocidad normal, 0 = quieto, negativo = hacia atrás). */
let st = { pos: 0, vel: 0, id: null as string | null, at: 0 };

/** Canción principal dentro del motor (la que suena, o la que entró con una mezcla). */
let engineCur: string | null = null;
/** Automix: mezcla preparada (`started` = ya está sonando la que entra) y dónde va la que entra. */
let mixInfo: { id: string; forId: string; started: boolean } | null = null;
let mixPos: number | null = null;
/** Canción que acaba de entrar con una mezcla (el reproductor todavía tiene que pasar a ella). */
let swappedTo: string | null = null;

function onMessage(e: MessageEvent) {
  const m = e.data;
  if (m.t === 'pos') {
    st = { pos: m.pos, vel: m.vel, id: m.id, at: performance.now() };
    mixPos = m.mixPos ?? null;
  } else if (m.t === 'end' && owner && m.id === owner) {
    diag('vinilo: canción terminada (motor)');
    onTrackEnd();
  } else if (m.t === 'mixstart') {
    if (mixInfo && mixInfo.id === m.id) mixInfo.started = true;
    diag('automix: empieza la mezcla');
  } else if (m.t === 'mixcancel') {
    mixInfo = null;
  } else if (m.t === 'swapped' || m.t === 'promoted') {
    engineCur = m.id;
    mixInfo = null;
    mixPos = null;
    st = { pos: m.pos, vel: st.vel, id: m.id, at: performance.now() };
    if (m.t === 'swapped') {
      swappedTo = m.id;
      diag('automix: mezcla terminada', { pos: m.pos });
      onMixAdvance(m.id, m.pos);
    }
  }
}

async function ensureNode(): Promise<boolean> {
  if (node) return true;
  if (unsupported) return false;
  ensureAudioGraph();
  const g = getAudioGraph();
  if (!g || !g.ctx.audioWorklet) {
    unsupported = true;
    diag('vinilo: este navegador no permite el motor (sin https)');
    return false;
  }
  nodeLoading ??= (async () => {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await g.ctx.audioWorklet.addModule(url);
      const n = new AudioWorkletNode(g.ctx, 'vinyl-deck', { numberOfInputs: 0, outputChannelCount: [2] });
      n.port.onmessage = onMessage;
      n.connect(g.input); // entra al ecualizador y al rack, igual que el reproductor normal
      node = n;
      nodeCtx = g.ctx;
    } catch {
      unsupported = true;
    }
  })();
  await nodeLoading;
  return !!node;
}

const send = (m: Record<string, unknown>, transfer?: Transferable[]) => node?.port.postMessage(m, transfer ?? []);

// ---------------- Canciones decodificadas (viven en el hilo de audio) ----------------

const decoded = new Map<string, { frames: number; rate: number; used: number }>();
const decoding = new Map<string, Promise<boolean>>();
const MAX_KEEP = 3; // la que suena, la siguiente y una más
const MAX_MINUTES = 15; // las más largas suenan con el reproductor normal (memoria del celular)

function decode(id: string): Promise<boolean> {
  const have = decoded.get(id);
  if (have) {
    have.used = Date.now();
    return Promise.resolve(true);
  }
  const running = decoding.get(id);
  if (running) return running;
  const p = (async () => {
    try {
      if (!(await ensureNode()) || !nodeCtx) return false;
      const t = trackById(id);
      if (t && t.duration > MAX_MINUTES * 60) return false;
      const blob = await getAudio(id);
      if (!blob) return false;
      const t0 = performance.now();
      const off = new OfflineAudioContext(2, 1, nodeCtx.sampleRate);
      const buf = await off.decodeAudioData(await blob.arrayBuffer());
      const n = buf.length;
      const l = buf.getChannelData(0);
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
      const pcm = new Int16Array(n * 2);
      // Por tramos, soltando la pantalla entre uno y otro: así la app no se traba mientras se prepara.
      const TRAMO = 1 << 19;
      for (let desde = 0; desde < n; desde += TRAMO) {
        const hasta = Math.min(n, desde + TRAMO);
        for (let i = desde; i < hasta; i++) {
          pcm[2 * i] = Math.max(-1, Math.min(1, l[i])) * 32767;
          pcm[2 * i + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
        }
        if (hasta < n) await new Promise((r2) => setTimeout(r2));
      }
      send({ t: 'load', id, pcm, rate: buf.sampleRate }, [pcm.buffer]); // se pasa, no se copia
      decoded.set(id, { frames: n, rate: buf.sampleRate, used: Date.now() });
      trim();
      diag('vinilo: canción preparada', { seg: n / buf.sampleRate, hz: buf.sampleRate, ms: performance.now() - t0 });
      return true;
    } catch {
      diag('vinilo: no se pudo preparar la canción');
      return false;
    } finally {
      decoding.delete(id);
    }
  })();
  decoding.set(id, p);
  return p;
}

/** Libera las canciones viejas para no llenar la memoria del celular. */
function trim() {
  const s = usePlayer.getState();
  const keep = new Set([owner, pending, s.queue[s.index], s.queue[s.index + 1]]);
  const old = [...decoded.entries()].filter(([id]) => !keep.has(id)).sort((a, b) => a[1].used - b[1].used);
  while (decoded.size > MAX_KEEP && old.length) {
    const [id] = old.shift()!;
    decoded.delete(id);
    send({ t: 'drop', id });
  }
}

/** Prepara la siguiente de la cola, así el cambio de canción es inmediato y sin hueco. */
function predecodeNext() {
  setTimeout(() => {
    const s = usePlayer.getState();
    const next = s.queue[s.index + 1];
    if (next && engineWanted()) void decode(next);
  }, 1500);
}

// ---------------- Quién suena ----------------

/** El motor se usa en modo vinilo y en Automix (nunca los dos a la vez). */
/**
 * Escuchando con un amigo que tiene el modo vinilo: el tocadiscos se usa también aquí (sin mostrar el disco
 * si este aparato no tiene el modo vinilo), para poder oír su scratch.
 */
export const useMotorJuntos = create<{ on: boolean }>(() => ({ on: false }));

const engineWanted = () => useVinyl.getState().on || useAutomix.getState().on || useMotorJuntos.getState().on;

/** Volumen propio de una canción dentro del motor (nivelador en Automix; si no, lo pone el circuito). */
function voiceGain(id: string) {
  if (!useAutomix.getState().on || !useLeveler.getState().on) return 1;
  const m = getMeasure(id);
  return m ? Math.pow(10, levelGainDb(m) / 20) : 1;
}

/** Canción que está sonando por el motor (null = suena el reproductor normal). */
let owner: string | null = null;
/** Canción que el motor está preparando para sonar (mientras, el reproductor normal queda en silencio). */
let pending: string | null = null;
/** El tocadiscos se prepara "por detrás": mientras tanto manda el reproductor normal (barra, pausa…). */
let pendingTakeover = false;

const currentId = () => {
  const s = usePlayer.getState();
  return s.queue[s.index] ?? null;
};

/** El motor tiene el control del sonido de la canción actual. */
export function deckOwns() {
  const id = currentId();
  return !!id && owner === id;
}

/** Posición estimada (el motor avisa cada ~15 ms). */
export function deckPos() {
  const dt = Math.min(0.12, Math.max(0, (performance.now() - st.at) / 1000));
  return Math.max(0, st.pos + st.vel * dt);
}

export const deckVel = () => st.vel;

/** Va a sonar la canción `id` desde `at`. `takeover` = se activó el modo vinilo con la canción ya sonando. */
async function claim(id: string, at: number, autoplay: boolean, takeover: boolean) {
  // Automix: la mezcla ya dejó esta canción sonando en el motor; solo se toma el control.
  if (!takeover && node && swappedTo === id && engineCur === id) {
    swappedTo = null;
    pending = null;
    owner = id;
    audio.loop = true;
    setElementLevel(0, true);
    const info = decoded.get(id);
    usePlayer.setState({ playing: motorOn, position: deckPos(), duration: info ? info.frames / info.rate : usePlayer.getState().duration });
    reapplyLevel();
    readyListeners.forEach((fn) => fn());
    predecodeNext();
    return;
  }
  // Saltar en mitad de una mezcla: sigue la que estaba entrando, desde donde iba.
  swappedTo = null;
  const promote = !takeover && !!mixInfo?.started && mixInfo.id === id && mixPos !== null;
  if (promote) at = mixPos!;
  const wasRunning = !!owner && st.vel > 0.5;
  pending = id;
  pendingTakeover = takeover;
  owner = null;
  ensureAudioGraph();
  // El reproductor normal no debe "terminar" por su cuenta… salvo mientras el tocadiscos se prepara por detrás
  // (ahí es él quien suena y pasa a la siguiente si se acaba).
  if (!takeover) audio.loop = true;
  if (!takeover) setElementLevel(0, true);
  // Por detrás (la canción ya suena por streaming): primero se deja que el streaming termine de llegar y recién
  // ahí se baja y prepara la canción para el plato, sin apuro. Así el tocadiscos nunca le quita conexión a lo
  // que está sonando, y entra cuando esté listo, tarde lo que tarde.
  if (takeover && !decoded.has(id)) {
    await streamActualCargado();
    if (pending !== id || !engineWanted()) return;
  }
  const ok = takeover
    ? await decode(id)
    : await Promise.race([decode(id), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
  if (pending !== id || !engineWanted()) return;
  pending = null;
  const info = decoded.get(id);
  if (!ok || !info) {
    // No se pudo: suena el reproductor normal (el disco solo frena, sin scratch).
    audio.loop = false;
    setElementLevel(1, true);
    usePlayer.setState({ playing: !audio.paused });
    diag('vinilo: suena el reproductor normal');
    return;
  }
  // Se preparó por detrás: sigue como esté el reproductor normal (si lo pausaste mientras tanto, queda en pausa).
  const playing = takeover ? !audio.paused : autoplay || !audio.paused;
  motorOn = playing;
  usePlayer.setState({ playing });
  if (takeover) at = audio.currentTime + 0.02;
  // Seguida de otra canción del motor: sin arranque (sin hueco). Primera vez: arranca como el plato.
  // En Automix no hay plato: siempre al instante.
  const auto = useAutomix.getState().on;
  const instant = takeover || wasRunning || auto;
  send({ t: 'select', id, at, v: playing && instant ? 1 : 0, rate: playing ? 1 : 0, tau: instant ? 0.01 : TAU.start, g: voiceGain(id), xf: auto, promote });
  if (!promote) mixInfo = null;
  engineCur = id;
  owner = id;
  st = { pos: at, vel: playing && instant ? 1 : 0, id, at: performance.now() };
  if (takeover) {
    audio.loop = true;
    setElementLevel(0, false);
  }
  usePlayer.setState({ position: at, duration: info.frames / info.rate });
  diag(promote ? 'automix: salto en la mezcla, sigue la que entraba' : 'vinilo: suena el motor', { pos: at, sonando: playing, seguido: instant });
  reapplyLevel();
  readyListeners.forEach((fn) => fn());
  predecodeNext();
}

/** Avisos para el Automix: el motor ya tiene el control de la canción actual. */
const readyListeners = new Set<() => void>();
export const onDeckReady = (fn: () => void) => readyListeners.add(fn);

/**
 * La canción nueva ya la carga el reproductor normal desde su inicio: el motor solo se apaga.
 * (Sin mover el reproductor normal a mitad de canción: en el iPhone eso sonaba doble o desfasado.)
 */
function releaseForNewTrack() {
  pending = null;
  owner = null;
  engineCur = null;
  mixInfo = null;
  audio.loop = false;
  setElementLevel(1, true);
  send({ t: 'off' });
  reapplyLevel();
  diag('vinilo: vuelve el reproductor normal (canción nueva)');
}

/** Deja de usar el motor y vuelve al reproductor normal en el mismo punto (solo si falla el motor). */
function releaseDeck() {
  pending = null;
  if (!owner) {
    audio.loop = false;
    setElementLevel(1, true);
    return;
  }
  const at = deckPos();
  owner = null;
  engineCur = null;
  mixInfo = null;
  audio.loop = false;
  try {
    audio.currentTime = at;
  } catch {
    /* sin canción cargada */
  }
  setElementLevel(1, false);
  send({ t: 'off' });
  if (!motorOn) audio.pause();
  usePlayer.setState({ position: at, playing: !audio.paused });
  reapplyLevel();
}

let stopTimer: ReturnType<typeof setTimeout> | undefined;
/** El motor del plato está encendido. SOLO lo cambia el botón de play/pausa (tocar el disco no). */
let motorOn = false;

/** El motor está preparando la canción actual (unos instantes al cambiar de canción). */
export function deckBusy() {
  const id = currentId();
  return !!id && pending === id;
}

deckHooks.owns = () => {
  const id = currentId();
  return !!id && (owner === id || (pending === id && !pendingTakeover));
};
deckHooks.pos = () => (pending ? usePlayer.getState().position : deckPos());
deckHooks.onLoad = (id, at, autoplay) => {
  if (!engineWanted() || unsupported) {
    if (owner || pending) releaseForNewTrack();
    return;
  }
  // Canción que el tocadiscos todavía no tiene lista (hay que bajarla y decodificarla entera): suena YA por el
  // reproductor normal y el tocadiscos toma el control sin corte cuando termina de prepararla. Mientras tanto
  // el disco no hace scratch. (En Automix se espera, porque la mezcla necesita el motor desde el inicio.)
  if (!decoded.has(id) && !useAutomix.getState().on) {
    if (owner || pending) releaseForNewTrack();
    diag('vinilo: suena al instante; el tocadiscos se prepara por detrás');
    void claim(id, at, autoplay, true);
    return;
  }
  void claim(id, at, autoplay, false);
};
deckHooks.play = () => {
  clearTimeout(stopTimer);
  motorOn = true;
  usePlayer.setState({ playing: true });
  startAudio().catch(() => {});
  // Modo vinilo: arranca como el plato. Si ya se apagó el modo vinilo (termina la canción en el motor): al instante.
  send({ t: 'rate', r: 1, tau: useVinyl.getState().on ? TAU.start : 0.004 });
};
deckHooks.pause = () => {
  const vinyl = useVinyl.getState().on;
  // Modo vinilo: freno, el tono baja hasta detenerse. Si ya se apagó el modo vinilo: pausa normal.
  send({ t: 'rate', r: 0, tau: vinyl ? TAU.stop : 0.004 });
  motorOn = false;
  usePlayer.setState({ playing: false });
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (!motorOn) audio.pause();
  }, vinyl ? TAU.stop * 3500 : 100);
};
deckHooks.seek = (sec) => {
  send({ t: 'jump', pos: sec });
  st = { ...st, pos: sec, at: performance.now() };
};

// Posición en pantalla y tiempo escuchado (para el algoritmo), mientras suena el motor.
let lastTick = 0;
setInterval(() => {
  if (!deckOwns()) {
    lastTick = 0;
    return;
  }
  const p = deckPos();
  if (lastTick) {
    const d = p - lastTick;
    if (d > 0 && d < 1.5) addListened(d);
  }
  lastTick = p;
  usePlayer.setState({ position: p });
}, 250);

// Encender o apagar el modo vinilo o el Automix con una canción cargada. (Al pasar de uno al otro el
// motor sigue sonando: no hay cambio de reproductor.)
let wasWanted = engineWanted();
function onModeChange() {
  const on = engineWanted();
  if (on === wasWanted) return;
  wasWanted = on;
  const id = currentId();
  if (!on) {
    // La canción que suena por el motor termina en el motor (sin cambiar de reproductor a mitad de
    // canción); desde la siguiente suena el reproductor normal. Si el motor aún no sonaba, vuelve ya.
    if (!owner || owner !== id) releaseDeck();
    else diag('vinilo: apagado; esta canción termina en el motor');
  } else if (id && audio.src && owner !== id) void claim(id, audio.currentTime, false, true);
}
useVinyl.subscribe(onModeChange);
useAutomix.subscribe(onModeChange);
useMotorJuntos.subscribe(onModeChange);

// ---------------- Automix ----------------

export interface MixArm {
  id: string; // la que entra
  outStart: number;
  outEnd: number;
  inAt: number;
  ratio: number;
}

/** Prepara la mezcla de la canción actual con la siguiente (el motor la empieza justo en `outStart`). */
export function deckArm(a: MixArm) {
  const forId = currentId();
  if (!forId || owner !== forId || (mixInfo?.started && mixInfo.id === a.id)) return;
  mixInfo = { id: a.id, forId, started: false };
  send({ t: 'arm', ...a, forId, g: voiceGain(a.id) });
}
export function deckDisarm() {
  if (!mixInfo) return;
  if (!mixInfo.started) mixInfo = null;
  send({ t: 'disarm' });
}
/** La mezcla está sonando (las dos canciones a la vez). */
export const deckMixing = () => !!mixInfo?.started;
/** La canción ya está lista dentro del motor (decodificada). */
export const deckPrepare = (id: string) => decode(id);

deckHooks.mixing = deckMixing;
deckHooks.cancelMix = () => {
  diag('automix: mezcla cancelada (anterior)');
  send({ t: 'disarm' });
};

levelHooks.engine = () => useAutomix.getState().on && !!(owner || pending);
levelHooks.setVoice = (g) => send({ t: 'vg', g });

// ---------------- Dedo sobre el disco ----------------

/** El dedo se apoya: el disco se frena (el plato sigue girando debajo). */
export function deckHold() {
  send({ t: 'rate', r: 0, tau: TAU.hold });
}

/** El dedo movió el disco `sec` segundos (positivo = adelante). */
export function deckNudge(sec: number) {
  send({ t: 'nudge', sec });
}

/**
 * El dedo se levanta: como en una tornamesa, si el plato está encendido el disco vuelve a sonar al
 * instante; si se había pausado con el botón, queda quieto donde lo dejaste.
 */
export function deckRelease() {
  send({ t: 'rate', r: motorOn ? 1 : 0, tau: motorOn ? TAU.release : TAU.hold });
  if (motorOn && audio.paused) audio.play().catch(() => {});
}
