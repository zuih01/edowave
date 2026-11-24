import { create } from 'zustand';
import { audioGraphHooks, ensureAudioGraph, setLevelGain, setLimitador } from './equalizer';
import { usePlayer } from './player';
import { volumenServidor } from '../server/biblioteca';

/**
 * Nivelador de volumen, sencillo: al activarlo, cada canción suena a -14 LUFS (el estándar de Spotify y YouTube).
 *  - Las fuertes bajan y las bajitas SUBEN (hasta +12 dB): así todo suena parecido.
 *  - Para que al subir una canción no sature, detrás va un limitador (equalizer.ts) que solo actúa en los picos
 *    que pasarían de -1 dBFS; con el nivelador apagado, el limitador no hace nada.
 *  - El volumen de cada canción ya lo midió el servidor al subirla: no se escanea nada en el aparato.
 *    (Las canciones importadas al teléfono que se midieron con la versión anterior también sirven; las demás,
 *    suenan tal cual.)
 */

export const TARGET_LUFS = -14;

interface Measure {
  lufs: number;
  peak: number; // dBFS (pico de muestra)
}

const KEY = 'leveler';
const MKEY = 'loudness';

/** Mediciones de canciones importadas en este aparato (de la versión anterior del nivelador). */
const measures: Record<string, Measure> = (() => {
  try {
    return JSON.parse(localStorage.getItem(MKEY) ?? '{}');
  } catch {
    return {};
  }
})();

export const useLeveler = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: (() => {
    try {
      return localStorage.getItem(KEY) === 'on';
    } catch {
      return false;
    }
  })(),
  set(on) {
    set({ on });
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* sin espacio */
    }
  },
}));

/** Volumen medido de una canción: el del servidor (o, si es importada, el medido antes en el aparato). */
export const getMeasure = (id: string): Measure | undefined => volumenServidor(id) ?? measures[id];

/** Ganancia (dB) para llevar una canción a -14 LUFS. Subir no satura: el limitador cuida los picos. */
export function levelGainDb(m: Measure) {
  return Math.max(-20, Math.min(12, TARGET_LUFS - m.lufs));
}

// ---------------- Aplicar ----------------

/**
 * En Automix suenan dos canciones a la vez dentro del motor: cada una lleva su propio volumen ahí
 * (scratch.ts llena estos ganchos) y el circuito general queda en 0 dB.
 */
export const levelHooks: { engine?: () => boolean; setVoice?: (gain: number) => void } = {};

/** Pone la ganancia de la canción actual (o 0 dB si el nivelador está apagado o la canción no tiene medida). */
function apply() {
  const { on } = useLeveler.getState();
  setLimitador(on);
  const p = usePlayer.getState();
  const m = on ? getMeasure(p.queue[p.index]) : undefined;
  const db = m ? levelGainDb(m) : 0;
  if (levelHooks.engine?.()) {
    setLevelGain(0);
    levelHooks.setVoice?.(Math.pow(10, db / 20));
  } else setLevelGain(db);
}
export const reapplyLevel = () => apply();

// El circuito de audio tiene que existir para poder ajustar el volumen.
const prevNeeded = audioGraphHooks.needed;
audioGraphHooks.needed = () => !!prevNeeded?.() || useLeveler.getState().on;

useLeveler.subscribe((s, old) => {
  if (s.on === old.on) return;
  if (s.on) ensureAudioGraph(); // viene de un toque en Configuración
  apply();
});

usePlayer.subscribe((s, old) => {
  if (s.queue[s.index] !== old.queue[old.index]) apply();
});

// Al abrir la app con el nivelador ya activado.
setTimeout(apply, 3000);
