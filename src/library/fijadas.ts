import { create } from 'zustand';

/**
 * Canciones fijadas en los accesos directos (desde los 3 puntitos de una canción). Van siempre primero, en el
 * orden en que se fijaron (la última, primera). Se guardan en tu cuenta (server/sincronizar.ts), así son las
 * mismas en todos tus aparatos.
 */
const MAX = 9; // una página de accesos directos

export const useFijadas = create<{ ids: string[]; alternar: (id: string) => boolean }>((set, get) => ({
  ids: [],
  /** Fija o quita la canción. Devuelve true si quedó fijada. */
  alternar(id) {
    const ya = get().ids.includes(id);
    set({ ids: ya ? get().ids.filter((x) => x !== id) : [id, ...get().ids].slice(0, MAX) });
    return !ya;
  },
}));
