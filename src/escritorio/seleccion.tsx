import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { showSnack, guardarEnPlaylist } from '../components/PlaylistSheets';
import { openSeleccionMenu, openTrackMenu } from '../components/TrackMenu';
import { LIKED_ID, usePlaylists } from '../library/playlists';
import { usePlayer } from '../player/player';
import type { Track } from '../types';
import { registrarElegidas } from './atajos';
import { autoDesplazar, contenedorScroll, destinoEn, marcarDestino, type DestinoOrden } from '../components/ordenar';

/**
 * Selección de canciones en PC (como Spotify):
 * clic = una · Ctrl + clic = agregar o quitar · Shift + clic = un tramo · Shift + ↑ ↓ = alargar o acortar el tramo ·
 * ↑ ↓ = mover · Ctrl + A = todas · Enter = reproducir · Esc o clic afuera = soltar.
 * Mientras hay algo elegido, ↑ ↓ mueven la selección (no el volumen).
 * Las filas llevan `data-fila={i}` y van dentro del elemento `raiz` (que lleva `data-seleccion`).
 */
export function useSeleccion(total: number, tocarUna: (i: number) => void, tocarVarias: (is: number[]) => void, tracks?: Track[]) {
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const ancla = useRef<number | null>(null);
  const cursor = useRef<number | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const acciones = useRef({ tocarUna, tocarVarias });
  acciones.current = { tocarUna, tocarVarias };
  const elegidasRef = useRef(elegidas);
  elegidasRef.current = elegidas;

  const tramo = (a: number, b: number) => {
    const s = new Set<number>();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) s.add(i);
    return s;
  };
  const elegirSolo = (i: number) => {
    ancla.current = cursor.current = i;
    setElegidas(new Set([i]));
  };
  const soltar = () => {
    ancla.current = cursor.current = null;
    setElegidas((s) => (s.size ? new Set() : s));
  };
  const clic = (i: number, e: React.MouseEvent) => {
    if (e.shiftKey && ancla.current !== null) {
      cursor.current = i;
      setElegidas(tramo(ancla.current, i));
    } else if (e.ctrlKey || e.metaKey) {
      ancla.current = cursor.current = i;
      setElegidas((s) => {
        const n = new Set(s);
        if (n.has(i)) n.delete(i);
        else n.add(i);
        return n;
      });
    } else elegirSolo(i);
  };

  // Si la lista cambia de largo (se quitaron o agregaron canciones), se suelta la selección.
  useEffect(() => {
    setElegidas(new Set());
    ancla.current = cursor.current = null;
  }, [total]);

  const hay = elegidas.size > 0;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  // Mientras hay elegidas, los atajos (P = guardar en playlist, Alt + Shift + B = me gusta) actúan sobre ellas.
  useEffect(() => {
    if (!hay || !tracksRef.current) return;
    const obtener = () =>
      [...elegidasRef.current]
        .sort((a, b) => a - b)
        .map((i) => tracksRef.current?.[i])
        .filter((t): t is Track => !!t);
    registrarElegidas(obtener);
    return () => registrarElegidas(null, obtener);
  }, [hay]);
  useEffect(() => {
    if (!hay) return;
    const tecla = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('.sheet-backdrop, .eq-screen')) return; // hay un menú o ventana encima
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation(); // no cambia el volumen
        const desde = cursor.current ?? 0;
        const n = Math.max(0, Math.min(total - 1, desde + (e.key === 'ArrowDown' ? 1 : -1)));
        cursor.current = n;
        if (e.shiftKey && ancla.current !== null) setElegidas(tramo(ancla.current, n));
        else {
          ancla.current = n;
          setElegidas(new Set([n]));
        }
        raiz.current?.querySelector(`[data-fila="${n}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (e.key === 'Escape') {
        soltar();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const is = [...elegidasRef.current].sort((a, b) => a - b);
        if (is.length === 1) acciones.current.tocarUna(is[0]);
        else if (is.length) acciones.current.tocarVarias(is);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        ancla.current = 0;
        cursor.current = total - 1;
        setElegidas(tramo(0, total - 1));
      }
    };
    const afuera = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.sheet-backdrop, .snack')) return;
      if (raiz.current && t?.closest?.('[data-seleccion]') === raiz.current) return;
      soltar();
    };
    document.addEventListener('keydown', tecla);
    document.addEventListener('pointerdown', afuera);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('pointerdown', afuera);
    };
  }, [hay, total]);

  /** Índices elegidos, en orden; si la fila `i` no está entre ellos, solo `[i]` (y queda elegida sola). */
  const paraFila = (i: number) => {
    if (elegidasRef.current.has(i) && elegidasRef.current.size > 1) return [...elegidasRef.current].sort((a, b) => a - b);
    elegirSolo(i);
    return [i];
  };
  /** Lo que se arrastra desde la fila `i`: la selección si la fila está en ella; si no, solo esa (sin cambiar la selección). */
  const arrastrables = (i: number) =>
    elegidasRef.current.has(i) && elegidasRef.current.size > 1 ? [...elegidasRef.current].sort((a, b) => a - b) : [i];

  return { elegidas, clic, elegirSolo, soltar, paraFila, arrastrables, raiz };
}

export type Seleccion = ReturnType<typeof useSeleccion>;

/** Clases de una fila elegida ("sigue": la de arriba también está elegida, se ven unidas). */
export const clasesFila = (sel: Seleccion, i: number) => `${sel.elegidas.has(i) ? 'elegida' : ''} ${sel.elegidas.has(i) && sel.elegidas.has(i - 1) ? 'sigue' : ''}`;

// ---------------------------------------------------------------- Listas de TrackRow (mixes, historial, álbumes…)

type CtxLista = { sel: Seleccion; tracks: Track[] };
const ListaCtx = createContext<CtxLista | null>(null);
export const useListaSeleccion = () => useContext(ListaCtx);

/**
 * Envuelve una lista de `TrackRow` para que en PC se puedan elegir varias (cada fila pasa `fila={i}`, su posición
 * en `tracks`). En el teléfono no cambia nada.
 */
export function ListaSeleccionable({
  tracks,
  tocar,
  className = 'list',
  children,
}: {
  tracks: Track[];
  tocar?: (i: number) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const sel = useSeleccion(
    tracks.length,
    (i) => (tocar ? tocar(i) : usePlayer.getState().playTracks(tracks, i, { shuffle: false })),
    (is) => usePlayer.getState().playTracks(is.map((i) => tracks[i]), 0, { shuffle: false }),
    tracks,
  );
  return (
    <ListaCtx.Provider value={{ sel, tracks }}>
      <div ref={sel.raiz} className={className} data-seleccion="">
        {children}
      </div>
    </ListaCtx.Provider>
  );
}

/** Menú de la fila `i` (clic derecho o ⋮): el de varias si está dentro de una selección, si no el de esa canción. */
export function menuDeFila(sel: Seleccion, tracks: Track[], i: number, playlist?: { id: string; index: number }) {
  const is = sel.paraFila(i);
  if (is.length === 1) return openTrackMenu(tracks[i], playlist ? { playlist } : {});
  openSeleccionMenu({ tracks: is.map((n) => tracks[n]) });
}

// ---------------------------------------------------------------- Arrastrar canciones a una playlist de la barra

const UMBRAL = 6; // píxeles que hay que mover el mouse para que empiece a arrastrar

/**
 * Empieza (si el mouse se mueve) a arrastrar canciones. Al soltarlas sobre una playlist de la barra izquierda
 * (`data-soltar="<id>"`) se guardan ahí; sobre "Música que te gustó", reciben "me gusta".
 * Hecho con eventos del puntero (no con arrastrar nativo), así funciona igual en la web y en la app de PC.
 */
export function empezarArrastre(
  e: React.PointerEvent,
  obtener: () => Track[],
  /** En una playlist propia: soltar sobre otra fila de la misma lista las cambia de lugar. */
  orden?: { raiz: HTMLElement | null; mover: (tracks: Track[], d: DestinoOrden) => void },
) {
  if (e.button !== 0 || e.pointerType === 'touch') return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let fantasma: HTMLDivElement | null = null;
  let tracks: Track[] = [];
  let destino: HTMLElement | null = null;
  let enLista: DestinoOrden | null = null;
  let auto: ReturnType<typeof autoDesplazar> | null = null;

  const evitarNativo = (ev: Event) => ev.preventDefault();
  const marcar = (el: HTMLElement | null) => {
    if (el === destino) return;
    destino?.classList.remove('soltar-aqui');
    destino = el;
    destino?.classList.add('soltar-aqui');
    if (fantasma) {
      const donde = fantasma.querySelector('.arrastre-donde')!;
      donde.textContent = destino ? `Soltar en «${destino.getAttribute('aria-label') ?? ''}»` : '';
    }
  };
  const mover = (ev: PointerEvent) => {
    if (!fantasma) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < UMBRAL) return;
      tracks = obtener();
      if (!tracks.length) return terminar();
      fantasma = document.createElement('div');
      fantasma.className = 'arrastre-fantasma';
      const titulo = document.createElement('div');
      titulo.className = 'arrastre-titulo';
      titulo.textContent = tracks.length === 1 ? `${tracks[0].title} • ${tracks[0].artist}` : `${tracks.length} canciones`;
      const donde = document.createElement('div');
      donde.className = 'arrastre-donde';
      fantasma.append(titulo, donde);
      document.body.append(fantasma);
      document.body.classList.add('arrastrando');
      window.getSelection()?.removeAllRanges();
      if (orden?.raiz) auto = autoDesplazar(contenedorScroll(orden.raiz));
    }
    fantasma.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
    const bajo = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    marcar((bajo?.closest('[data-soltar]') as HTMLElement | null) ?? null);
    if (orden) {
      auto?.mover(ev.clientY);
      const d = destino ? null : destinoEn(ev.clientX, ev.clientY, orden.raiz);
      enLista = d;
      marcarDestino(orden.raiz, d);
      if (!destino) fantasma.querySelector('.arrastre-donde')!.textContent = d ? 'Mover aquí' : '';
    }
  };
  const tecla = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      marcar(null);
      terminar();
    }
  };
  const terminar = () => {
    auto?.parar();
    if (orden) marcarDestino(orden.raiz, null);
    window.removeEventListener('pointermove', mover);
    window.removeEventListener('pointerup', alSoltar);
    window.removeEventListener('pointercancel', terminar);
    window.removeEventListener('keydown', tecla, true);
    window.removeEventListener('dragstart', evitarNativo, true);
    if (fantasma) {
      fantasma.remove();
      document.body.classList.remove('arrastrando');
      // El clic que llega al soltar no debe tocar ni elegir la fila.
      const tragar = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', tragar, true);
      setTimeout(() => window.removeEventListener('click', tragar, true), 0);
    }
  };
  const alSoltar = () => {
    const id = destino?.dataset.soltar;
    const d = enLista;
    marcar(null);
    terminar();
    if (id && tracks.length) void soltarEn(id, tracks);
    else if (d && orden && tracks.length) orden.mover(tracks, d);
  };
  window.addEventListener('pointermove', mover);
  window.addEventListener('pointerup', alSoltar);
  window.addEventListener('pointercancel', terminar);
  window.addEventListener('keydown', tecla, true);
  window.addEventListener('dragstart', evitarNativo, true);
}

async function soltarEn(id: string, tracks: Track[]) {
  if (id === LIKED_ID) {
    const p = usePlayer.getState();
    const nuevas = tracks.filter((t) => p.ratings[t.id] !== 1);
    nuevas.forEach((t) => usePlayer.getState().rate(t.id, 1));
    if (tracks.length === 1) showSnack(nuevas.length ? 'Guardada en Música que te gustó' : 'Ya está en Música que te gustó');
    else showSnack(nuevas.length ? `${nuevas.length} canciones en Música que te gustó` : 'Ya estaban todas en Música que te gustó');
    return;
  }
  if (!usePlaylists.getState().list.some((x) => x.id === id)) return;
  await guardarEnPlaylist(id, tracks);
}
