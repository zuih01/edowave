import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { api } from '../server/cuenta';
import { esDelServidor } from '../server/biblioteca';
import type { Track } from '../types';
import { playerPos } from './player';

/**
 * Letras (vienen del servidor, que las busca en LRCLIB). Aquí: leer el formato LRC, guardar lo ya pedido, saber qué
 * línea está sonando y si la letra está abierta.
 */

export interface Linea {
  /** Segundo en que empieza. */
  t: number;
  texto: string;
  /** Pausa instrumental ("• • •"). */
  pausa?: boolean;
}

interface RespuestaLetra {
  estado: 'sincronizada' | 'normal' | 'instrumental' | 'sin_letra' | 'error' | 'pendiente';
  lrc?: string | null;
  texto?: string | null;
  desfase?: number;
}

export interface Letra {
  /** cargando: pidiéndola · ok: hay letra (con tiempos o sin ellos) · instrumental · sin: no hay · error: sin conexión */
  estado: 'cargando' | 'ok' | 'instrumental' | 'sin' | 'error';
  lineas: Linea[];
  sincronizada: boolean;
  texto: string[];
}

/** Una pausa más larga que esto (sin letra entre dos líneas) se muestra como "• • •". */
const PAUSA_MIN = 6;

/** Lee un archivo LRC: `[01:23.45] texto`, con varios tiempos en una línea y la etiqueta `[offset:±ms]`. */
export function leerLrc(lrc: string, desfaseMs = 0): Linea[] {
  let offset = 0;
  const crudas: { t: number; texto: string }[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    const tiempos: number[] = [];
    let resto = raw;
    for (let m = /^\s*\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(resto); m; m = /^\s*\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(resto)) {
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      tiempos.push(Number(m[1]) * 60 + Number(m[2]) + frac);
      resto = resto.slice(m[0].length);
    }
    if (!tiempos.length) continue; // metadatos ([ar:], [ti:]…) y líneas sueltas
    const texto = resto.replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').trim(); // marcas por palabra: se ignoran
    for (const t of tiempos) crudas.push({ t, texto });
  }
  crudas.sort((a, b) => a.t - b.t);
  const mover = (offset + desfaseMs) / 1000;
  const lineas: Linea[] = [];
  for (let i = 0; i < crudas.length; i++) {
    const { t, texto } = crudas[i];
    const sig = crudas[i + 1]?.t ?? Infinity;
    if (texto) lineas.push({ t: Math.max(0, t - mover), texto });
    else if (sig - t >= PAUSA_MIN) lineas.push({ t: Math.max(0, t - mover), texto: '', pausa: true });
  }
  // Intro larga antes de la primera línea
  if (lineas.length && !lineas[0].pausa && lineas[0].t >= PAUSA_MIN) lineas.unshift({ t: 0, texto: '', pausa: true });
  return lineas;
}

const cache = new Map<string, Letra>();

function armar(r: RespuestaLetra): Letra {
  if (r.estado === 'instrumental') return { estado: 'instrumental', lineas: [], sincronizada: false, texto: [] };
  if (r.estado === 'sincronizada' && r.lrc) {
    const lineas = leerLrc(r.lrc, r.desfase ?? 0);
    if (lineas.length) return { estado: 'ok', lineas, sincronizada: true, texto: [] };
  }
  if (r.texto) return { estado: 'ok', lineas: [], sincronizada: false, texto: r.texto.split(/\r?\n/) };
  return { estado: 'sin', lineas: [], sincronizada: false, texto: [] };
}

const VACIA: Letra = { estado: 'cargando', lineas: [], sincronizada: false, texto: [] };

/** La letra de una canción (solo las del servidor tienen). Se pide una vez y queda guardada mientras la app esté abierta. */
export function useLetra(track: Track | undefined): Letra {
  const id = track && esDelServidor(track.id) ? track.id : undefined;
  const [, rehacer] = useState(0);
  useEffect(() => {
    if (!id || cache.has(id)) return;
    let vivo = true;
    let intentos = 0;
    const pedir = async () => {
      try {
        const r = await api<RespuestaLetra>(`/api/letras/${encodeURIComponent(id.slice(2))}`);
        if (r.estado === 'pendiente' && intentos++ < 3) {
          setTimeout(() => vivo && void pedir(), 4000);
          return;
        }
        cache.set(id, armar(r));
      } catch {
        cache.set(id, { estado: 'error', lineas: [], sincronizada: false, texto: [] });
        setTimeout(() => cache.get(id)?.estado === 'error' && cache.delete(id), 20_000); // se reintenta más tarde
      }
      if (vivo) rehacer((n) => n + 1);
    };
    void pedir();
    return () => {
      vivo = false;
    };
  }, [id]);
  if (!id) return { estado: 'sin', lineas: [], sincronizada: false, texto: [] };
  return cache.get(id) ?? VACIA;
}

/** Quita lo guardado de una canción (el panel la cambió). */
export const olvidarLetra = (id: string) => cache.delete(id);

/** Índice de la línea que suena ahora (-1 antes de la primera). Mira la posición ~60 veces por segundo solo mientras `activo`. */
export function useLineaActual(lineas: Linea[], activo: boolean): number {
  const [i, setI] = useState(-1);
  const ref = useRef(lineas);
  ref.current = lineas;
  useEffect(() => {
    if (!activo || !lineas.length) {
      setI(-1);
      return;
    }
    let raf = 0;
    const AVANCE = 0.15; // la línea se enciende justo antes de cantarse
    const tick = () => {
      const l = ref.current;
      const p = playerPos() + AVANCE;
      let lo = 0;
      let hi = l.length - 1;
      let r = -1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (l[m].t <= p) {
          r = m;
          lo = m + 1;
        } else hi = m - 1;
      }
      setI((a) => (a === r ? a : r));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activo, lineas]);
  return i;
}

/** ¿Está abierta la letra? (en el teléfono sube como hoja; en PC ocupa el centro). */
export const useLetraUi = create<{ abierta: boolean; abrir: () => void; cerrar: () => void; alternar: () => void }>((set) => ({
  abierta: false,
  abrir: () => set({ abierta: true }),
  cerrar: () => set({ abierta: false }),
  alternar: () => set((s) => ({ abierta: !s.abierta })),
}));
