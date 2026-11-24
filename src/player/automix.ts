import { diag } from '../diag';
import { radioHooks } from '../reco/engine';
import { useAutomix } from './automixStore';
import { getBeats, onBeats, type Beats } from './beats';
import { deckHooks, usePlayer } from './player';
import { deckArm, deckDisarm, deckMixing, deckPrepare, onDeckReady } from './scratch';
import { useVinyl } from './Vinyl';

/**
 * Automix (experimental): mezcla sola cada canción con la siguiente, como un DJ, SOLO si la mezcla es
 * coherente. Si no, la canción termina normal y la siguiente empieza desde su inicio.
 *
 * Reglas para mezclar:
 *  - Las dos tienen tempo constante y golpes claros (ver beats.ts).
 *  - La que termina tiene un final con ritmo y la que entra una intro con ritmo.
 *  - El tempo calza moviendo el pitch como máximo ±6 % (también vale medio o doble tempo: 87 con 174).
 *
 * El usuario no maneja la mezcla: solo play/pausa, siguiente (corta la que se va) y anterior (cancela).
 */

export const MAX_PITCH = 0.06;

export interface MixPlan {
  outStart: number;
  outEnd: number;
  inAt: number;
  ratio: number; // velocidad de la que entra (1,03 = +3 %)
}

/** ¿Se pueden mezclar? Devuelve el plan o el motivo por el que no. */
export function mixPlan(a: Beats | undefined, b: Beats | undefined): MixPlan | string {
  if (!a || !b) return 'falta analizar el ritmo';
  if (!a.steady) return `la actual no tiene tempo constante (${a.bpm} BPM)`;
  if (!b.steady) return `la siguiente no tiene tempo constante (${b.bpm} BPM)`;
  if (!a.out) return 'la actual no termina con ritmo';
  if (b.inAt === null) return 'la siguiente no empieza con ritmo';
  let ratio = 0;
  for (const k of [1, 2, 0.5]) {
    const v = b.period / (k * a.period);
    if (Math.abs(v - 1) <= MAX_PITCH && (!ratio || Math.abs(v - 1) < Math.abs(ratio - 1))) ratio = v;
  }
  if (!ratio) {
    const pct = ((a.bpm / b.bpm - 1) * 100).toFixed(1);
    return `${a.bpm} → ${b.bpm} BPM: haría falta ${Number(pct) > 0 ? '+' : ''}${pct} % de pitch`;
  }
  const len = a.out[1] - a.out[0];
  if (b.inAt + len * ratio > b.dur - 30) return 'la siguiente es muy corta';
  return { outStart: a.out[0], outEnd: a.out[1], inAt: b.inAt, ratio };
}

// ---------------- Preparar la mezcla de la canción actual ----------------

let armedKey = '';
/** Transición que el usuario canceló con "anterior": esa no se vuelve a mezclar. */
let cancelledKey = '';
let lastReason = '';
let planning = 0;

async function plan() {
  const token = ++planning;
  const p = usePlayer.getState();
  const cur = p.queue[p.index];
  const next = p.queue[p.index + 1];
  const key = `${cur}>${next}`;
  if (!useAutomix.getState().on || useVinyl.getState().on || p.repeat === 'one' || !cur || !next || key === cancelledKey) {
    if (armedKey && !deckMixing()) deckDisarm();
    armedKey = '';
    return;
  }
  if (deckMixing()) return; // la mezcla ya está sonando
  const r = mixPlan(getBeats(cur), getBeats(next));
  if (typeof r === 'string') {
    if (armedKey) deckDisarm();
    armedKey = '';
    if (lastReason !== key + r) {
      lastReason = key + r;
      diag('automix: sin mezcla', { motivo: r });
    }
    return;
  }
  if (!(await deckPrepare(next)) || token !== planning) return;
  const k = `${key}|${r.outStart}|${r.ratio}`;
  if (k === armedKey) return;
  armedKey = k;
  deckArm({ id: next, ...r });
  diag('automix: mezcla preparada', { desde: Math.round(r.outStart), pitch: `${((r.ratio - 1) * 100).toFixed(1)} %` });
}

const replan = () => void plan();
onDeckReady(() => {
  armedKey = ''; // el motor cambió de canción: lo preparado ya no vale
  replan();
});
onBeats(replan);
usePlayer.subscribe((s, old) => {
  if (s.index !== old.index) cancelledKey = '';
  if (s.queue !== old.queue || s.index !== old.index || s.repeat !== old.repeat) replan();
});
useAutomix.subscribe(replan);
useVinyl.subscribe(replan);

/** "Anterior" en mitad de la mezcla: se cancela y esta transición ya no se mezcla. */
const baseCancel = deckHooks.cancelMix;
deckHooks.cancelMix = () => {
  const p = usePlayer.getState();
  cancelledKey = `${p.queue[p.index]}>${p.queue[p.index + 1]}`;
  armedKey = '';
  baseCancel?.();
};

// La radio automática prefiere, entre las parecidas, las que se pueden mezclar con la anterior.
radioHooks.bonus = (prevId, id) => {
  if (!useAutomix.getState().on) return 0;
  return typeof mixPlan(getBeats(prevId), getBeats(id)) === 'string' ? 0 : 0.06;
};
