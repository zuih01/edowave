import { create } from 'zustand';

export type Tab = 'home' | 'search' | 'library';
export type Page = { type: 'album'; key: string } | { type: 'artist'; name: string } | { type: 'playlist'; id: string } | { type: 'history' }
  | { type: 'settings' }
  | { type: 'amigos' }
  | { type: 'usuario'; id: number }
  | { type: 'comunidad'; id: string }
  /** PC: resultados completos de una búsqueda (al presionar Enter en el buscador de arriba). */
  | { type: 'resultados'; q: string }
  /** Un mix de "Para ti" (Anime Now, Essential 90's…): sus canciones vienen del feed (useReco().paraTi). */
  | { type: 'mix'; id: string }
  /** Lista armada por el buscador ("80s", "reggaetón viejo"…). */
  | { type: 'lista'; q: string };

interface NavState {
  tab: Tab;
  stack: Page[];
  setTab: (t: Tab) => void;
  push: (p: Page) => void;
  back: () => void;
  /** Páginas de las que volviste con "atrás" (para la flecha "adelante" de PC). */
  adelante: Page[];
  forward: () => void;
}

/** Navegación simple: una pestaña activa + una pila de páginas de detalle encima. */
export const useNav = create<NavState>((set) => ({
  tab: 'home',
  stack: [],
  adelante: [],
  setTab: (tab) => set({ tab, stack: [], adelante: [] }),
  push: (p) => {
    // Si ya estás en esa misma pantalla (tocar Configuración o la misma playlist otra vez), no se abre de nuevo:
    // si no, "atrás" había que apretarlo una vez por cada toque.
    const arriba = useNav.getState().stack.at(-1);
    if (arriba && JSON.stringify(arriba) === JSON.stringify(p)) return;
    history.pushState(null, '');
    set((s) => ({ stack: [...s.stack, p], adelante: [] }));
  },
  back: () =>
    set((s) => (s.stack.length ? { stack: s.stack.slice(0, -1), adelante: [...s.adelante, s.stack[s.stack.length - 1]] } : {})),
  forward: () =>
    set((s) => {
      const p = s.adelante[s.adelante.length - 1];
      if (!p) return {};
      history.pushState(null, '');
      return { stack: [...s.stack, p], adelante: s.adelante.slice(0, -1) };
    }),
}));

/**
 * Capas encima de todo (reproductor completo, menús). El botón "atrás" del teléfono
 * cierra primero la capa de arriba, luego las páginas de detalle.
 */
const overlays: (() => void)[] = [];

export function openOverlay(close: () => void) {
  history.pushState(null, '');
  overlays.push(close);
}

/** Cerrar una capa desde un botón de la app (pasa por el historial para que quede consistente). */
export function closeOverlay() {
  if (overlays.length) history.back();
}

/** Cierra todas las capas abiertas y después ejecuta `then` (por ejemplo, ir a un álbum). */
let afterCloseAll: (() => void) | null = null;
export function closeAllOverlaysThen(then: () => void) {
  const n = overlays.length;
  if (!n) return then();
  while (overlays.length) overlays.pop()!();
  afterCloseAll = then;
  history.go(-n);
}

window.addEventListener('popstate', () => {
  if (afterCloseAll) {
    const fn = afterCloseAll;
    afterCloseAll = null;
    fn();
    return;
  }
  const close = overlays.pop();
  if (close) close();
  else if (useNav.getState().stack.length) useNav.getState().back();
});

export function goBack() {
  history.back();
}
