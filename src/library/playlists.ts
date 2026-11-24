import { create } from 'zustand';
import { deletePlaylist, getAllPlaylists, putPlaylist, type Playlist } from '../db';
import { cuentaActual, marcarBorrada, marcarCambio, visibleAhora } from '../server/playlistsCuenta';

export type { Playlist };

/** Id especial de la lista automática "Música que te gustó" (no se guarda: sale de tus "me gusta"). */
export const LIKED_ID = 'liked';

/**
 * Las fijadas primero (la que se fijó antes, arriba); el resto queda en el orden que traía.
 * Así una playlist fijada no se mueve aunque escuches otras.
 */
export function fijadasPrimero<T>(list: T[], pl: (x: T) => Playlist | undefined): T[] {
  const fijadas = list.filter((x) => pl(x)?.pinnedAt).sort((a, b) => pl(a)!.pinnedAt! - pl(b)!.pinnedAt!);
  return [...fijadas, ...list.filter((x) => !pl(x)?.pinnedAt)];
}

interface PlaylistsState {
  loaded: boolean;
  list: Playlist[];
  load: () => Promise<void>;
  /** Crea una playlist (opcionalmente ya con canciones) y devuelve su id. */
  create: (name: string, trackIds?: string[]) => Promise<string>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Agrega canciones al final; las que ya estaban no se repiten. Devuelve cuántas se agregaron. */
  add: (id: string, trackIds: string[]) => Promise<number>;
  /** Quita la canción en esa posición. */
  removeAt: (id: string, index: number) => Promise<void>;
  /** Mueve canciones (en su orden) antes o después de otra. Así se ordena una playlist arrastrando. */
  moveTracks: (id: string, moved: string[], targetId: string, after: boolean) => Promise<void>;
  /** Quita varias posiciones de una vez (selección múltiple en PC). */
  removeIndices: (id: string, indices: number[]) => Promise<void>;
  markPlayed: (id: string) => Promise<void>;
  /** Pública (la ven tus amigos y la comunidad) o privada. */
  setPublic: (id: string, pub: boolean) => Promise<void>;
  /** Fijar arriba en la barra (o soltarla). Se pueden fijar varias: la que se fijó primero va primero. */
  setPinned: (id: string, on: boolean) => Promise<void>;
  /** Foto propia (ya guardada en el servidor): se anota aquí sin volver a subir la playlist. */
  setFoto: (id: string, foto: string | null, actualizada: number) => Promise<void>;
  /** Lo que llega de la cuenta (otro aparato): se guarda sin volver a subirlo. */
  applyRemote: (put: Playlist[], removeIds: string[]) => Promise<void>;
}

export const usePlaylists = create<PlaylistsState>((set, get) => {
  const save = async (p: Playlist) => {
    await putPlaylist(p);
    set({ list: get().list.map((x) => (x.id === p.id ? p : x)) });
    marcarCambio(p.id); // se guarda también en tu cuenta del servidor
  };
  const find = (id: string) => get().list.find((p) => p.id === id);

  return {
    loaded: false,
    list: [],
    async load() {
      // Solo las de la cuenta abierta (y las hechas sin sesión). Las de otra cuenta se borran de este aparato:
      // están en el servidor y vuelven al entrar con esa cuenta.
      const todas = await getAllPlaylists();
      for (const p of todas) if (!visibleAhora(p)) await deletePlaylist(p.id);
      set({ loaded: true, list: todas.filter(visibleAhora) });
    },
    async create(name, trackIds = []) {
      const now = Date.now();
      const p: Playlist = {
        id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim().slice(0, 60) || 'Mi playlist',
        trackIds: [...new Set(trackIds)],
        createdAt: now,
        updatedAt: now,
        cuenta: cuentaActual() ?? undefined,
      };
      await putPlaylist(p);
      set({ list: [...get().list, p] });
      marcarCambio(p.id);
      return p.id;
    },
    async rename(id, name) {
      const p = find(id);
      const clean = name.trim().slice(0, 60);
      if (p && clean) await save({ ...p, name: clean, updatedAt: Date.now() });
    },
    async remove(id) {
      const p = find(id);
      await deletePlaylist(id);
      set({ list: get().list.filter((p) => p.id !== id) });
      if (p) marcarBorrada(p);
    },
    async add(id, trackIds) {
      const p = find(id);
      if (!p) return 0;
      const fresh = trackIds.filter((t) => !p.trackIds.includes(t));
      if (fresh.length) await save({ ...p, trackIds: [...p.trackIds, ...fresh], updatedAt: Date.now() });
      return fresh.length;
    },
    async removeAt(id, index) {
      const p = find(id);
      if (!p) return;
      await save({ ...p, trackIds: p.trackIds.filter((_, i) => i !== index), updatedAt: Date.now() });
    },
    async moveTracks(id, moved, targetId, after) {
      const p = find(id);
      const mover = new Set(moved);
      if (!p || !moved.length || mover.has(targetId)) return;
      const resto = p.trackIds.filter((t) => !mover.has(t));
      let k = resto.indexOf(targetId);
      if (k < 0) return;
      if (after) k++;
      resto.splice(k, 0, ...p.trackIds.filter((t) => mover.has(t)));
      if (resto.every((t, i) => t === p.trackIds[i])) return;
      await save({ ...p, trackIds: resto, updatedAt: Date.now() });
    },
    async removeIndices(id, indices) {
      const p = find(id);
      if (!p || !indices.length) return;
      const fuera = new Set(indices);
      await save({ ...p, trackIds: p.trackIds.filter((_, i) => !fuera.has(i)), updatedAt: Date.now() });
    },
    async markPlayed(id) {
      const p = find(id);
      if (p) await save({ ...p, playedAt: Date.now() });
    },
    async setPublic(id, pub) {
      const p = find(id);
      if (p && !!p.public !== pub) await save({ ...p, public: pub, updatedAt: Date.now() });
    },
    async setPinned(id, on) {
      const p = find(id);
      if (p && !!p.pinnedAt !== on) await save({ ...p, pinnedAt: on ? Date.now() : undefined, updatedAt: Date.now() });
    },
    async setFoto(id, foto, actualizada) {
      const p = find(id);
      if (!p) return;
      const n = { ...p, foto: foto ?? undefined, updatedAt: Math.max(p.updatedAt, actualizada) };
      await putPlaylist(n);
      set({ list: get().list.map((x) => (x.id === id ? n : x)) });
    },
    async applyRemote(put, removeIds) {
      for (const p of put) await putPlaylist(p);
      for (const id of removeIds) await deletePlaylist(id);
      const byId = new Map(get().list.map((p) => [p.id, p]));
      for (const p of put) byId.set(p.id, p);
      for (const id of removeIds) byId.delete(id);
      set({ list: [...byId.values()] });
    },
  };
});
