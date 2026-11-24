import type { Playlist } from '../db';
import { usePlaylists } from '../library/playlists';
import { api, useCuenta } from './cuenta';

/**
 * Tus playlists se guardan en tu cuenta del servidor: aparecen en cualquier aparato donde entres, y las
 * públicas las ven tus amigos y "De la comunidad".
 *
 * - Cada cambio se sube al rato (si no hay conexión, queda pendiente y se sube en la próxima sincronización).
 * - Al abrir la app, al entrar a la cuenta y al volver a la app se bajan las de otros aparatos.
 * - Si la misma playlist cambió en dos aparatos, gana el cambio más nuevo.
 * - El aparato solo guarda una copia de las playlists de la cuenta con sesión abierta. Al cerrar sesión o entrar
 *   con otra cuenta, las de la cuenta anterior se borran de este aparato (siguen en el servidor). Antes de cerrar
 *   sesión se suben los cambios pendientes.
 * - Lo que falta subir o borrar en el servidor se anota POR CUENTA: un borrado hecho con una cuenta nunca se
 *   manda con la sesión de otra.
 * - Las playlists hechas sin sesión (sin cuenta) se suben a la cuenta con que se entre después.
 */

interface PlaylistServidor {
  id: string;
  nombre: string;
  canciones: string[];
  publica: boolean;
  borrada: boolean;
  creada: number;
  actualizada: number;
  reproducida: number | null;
  foto?: string | null;
  origen?: string | null;
  faltan?: number;
  fijada?: number | null;
}

/** Listas de pendientes de cada cuenta (antes eran una sola para todas: un borrado podía salir con otra sesión). */
const PENDIENTES = (cuenta: string) => `playlistsPendientes:${cuenta}`;
const BORRADAS = (cuenta: string) => `playlistsBorradas:${cuenta}`;
try {
  // Las listas viejas (sin cuenta) se descartan: no se sabe de quién eran. Lo que no alcanzó a subirse se vuelve
  // a comparar en la próxima sincronización.
  localStorage.removeItem('playlistsPendientes');
  localStorage.removeItem('playlistsBorradas');
} catch {
  /* sin almacenamiento */
}

const leer = (k: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '[]');
  } catch {
    return [];
  }
};
const escribir = (k: string, v: string[]) => {
  try {
    localStorage.setItem(k, JSON.stringify([...new Set(v)]));
  } catch {
    /* sin espacio */
  }
};

/** Nombre (en minúsculas) de la cuenta con sesión abierta, o null. */
export function cuentaActual() {
  const c = useCuenta.getState();
  return c.token && c.nombre ? c.nombre.toLowerCase() : null;
}

const esMia = (p: Playlist, cuenta: string) => !p.cuenta || p.cuenta === cuenta;

/** ¿Se puede ver esta playlist en este aparato? Las hechas sin sesión, o las de la cuenta abierta. */
export function visibleAhora(p: Playlist) {
  return !p.cuenta || p.cuenta === cuentaActual();
}

let timer: ReturnType<typeof setTimeout> | undefined;
function pronto() {
  clearTimeout(timer);
  timer = setTimeout(() => void subirPendientes(), 1200);
}

export function marcarCambio(id: string) {
  const cuenta = cuentaActual();
  if (!cuenta) return; // sin sesión: se sube a la cuenta con que se entre (sincronizarPlaylists)
  escribir(PENDIENTES(cuenta), [...leer(PENDIENTES(cuenta)), id]);
  pronto();
}

export function marcarBorrada(p: Playlist) {
  const cuenta = cuentaActual();
  // Solo se borra en el servidor una playlist de la cuenta abierta. Una sin cuenta nunca se subió.
  if (!cuenta || p.cuenta !== cuenta) return;
  escribir(PENDIENTES(cuenta), leer(PENDIENTES(cuenta)).filter((x) => x !== p.id));
  escribir(BORRADAS(cuenta), [...leer(BORRADAS(cuenta)), p.id]);
  pronto();
}

const aServidor = (p: Playlist) => ({
  nombre: p.name,
  canciones: p.trackIds,
  publica: !!p.public,
  creada: p.createdAt,
  actualizada: p.updatedAt,
  reproducida: p.playedAt ?? null,
  fijada: p.pinnedAt ?? null,
});

const desdeServidor = (s: PlaylistServidor, cuenta: string): Playlist => ({
  id: s.id,
  name: s.nombre,
  trackIds: s.canciones,
  createdAt: s.creada,
  updatedAt: s.actualizada,
  playedAt: s.reproducida ?? undefined,
  public: s.publica,
  cuenta,
  foto: s.foto ?? undefined,
  origen: s.origen ?? undefined,
  faltan: s.faltan || undefined,
  pinnedAt: s.fijada ?? undefined,
});

let subiendo: Promise<void> | null = null;

/** Sube lo que cambió en este aparato. */
async function subirPendientes(): Promise<void> {
  if (subiendo) return subiendo;
  subiendo = (async () => {
    const cuenta = cuentaActual();
    if (!cuenta) return;
    const pl = usePlaylists.getState();
    for (const id of leer(BORRADAS(cuenta))) {
      if (cuentaActual() !== cuenta) return; // cambió la sesión a mitad de camino
      try {
        await api(`/api/playlists/${id}`, { method: 'DELETE' });
        escribir(BORRADAS(cuenta), leer(BORRADAS(cuenta)).filter((x) => x !== id));
      } catch {
        return; // sin conexión: se intenta más tarde
      }
    }
    for (const id of leer(PENDIENTES(cuenta))) {
      if (cuentaActual() !== cuenta) return;
      const p = usePlaylists.getState().list.find((x) => x.id === id);
      if (p && esMia(p, cuenta)) {
        try {
          await api(`/api/playlists/${id}`, { method: 'PUT', body: aServidor(p) });
          if (!p.cuenta) await pl.applyRemote([{ ...p, cuenta }], []);
        } catch (e) {
          if ((e as { status?: number }).status === 409) {
            // el id ya lo usa otra cuenta (casi imposible): se deja solo en este aparato
          } else return;
        }
      }
      escribir(PENDIENTES(cuenta), leer(PENDIENTES(cuenta)).filter((x) => x !== id));
    }
  })().finally(() => (subiendo = null));
  return subiendo;
}

/** Antes de cerrar sesión: sube lo que falte (como mucho 5 s; sin conexión, queda anotado para esa cuenta). */
export async function subirAntesDeSalir() {
  clearTimeout(timer);
  await Promise.race([subirPendientes(), new Promise((r) => setTimeout(r, 5000))]);
}

/** Borra de este aparato las playlists de otra cuenta (o todas las de alguna cuenta, si no hay sesión). */
export async function olvidarAjenas() {
  const pl = usePlaylists.getState();
  if (!pl.loaded) return; // load() ya las deja fuera
  const ajenas = pl.list.filter((p) => !visibleAhora(p)).map((p) => p.id);
  if (ajenas.length) await pl.applyRemote([], ajenas);
}

// ---------------- Importar de Spotify ----------------

export interface Importada {
  id: string;
  nombre: string;
  encontradas: number;
  faltan: number;
  /** Canciones que se pudieron leer de Spotify, y cuántas tiene en total (sin clave, Spotify muestra 100). */
  leidas: number;
  total: number;
  completa: boolean;
}

/** Importa una playlist pública de Spotify a la cuenta (la arma el servidor) y la deja en este aparato. */
export async function importarDeSpotify(enlace: string): Promise<Importada> {
  const cuenta = cuentaActual();
  if (!cuenta) throw new Error('Entra a tu cuenta para importar playlists');
  const r = await api<Omit<Importada, 'id' | 'nombre'> & { playlist: PlaylistServidor }>('/api/playlists/importar', { method: 'POST', body: { enlace } });
  const pl = usePlaylists.getState();
  if (!pl.loaded) await pl.load();
  await usePlaylists.getState().applyRemote([desdeServidor(r.playlist, cuenta)], []);
  return { id: r.playlist.id, nombre: r.playlist.nombre, encontradas: r.encontradas, faltan: r.faltan, leidas: r.leidas, total: r.total, completa: r.completa };
}

export interface Faltante {
  id: number;
  titulo: string;
  artistas: string[];
  duracion: number | null;
  /** Canción de la playlist que va justo antes ('' = al principio; null = al final). */
  despuesDe: string | null;
}

/** Cuántas líneas pegadas se mandan por vez (el servidor lee cada enlace en Spotify: ~1/3 s por canción). */
const TANDA = 50;

/**
 * Completar una playlist importada con lo que se copió en Spotify (Ctrl+A, Ctrl+C): enlaces de canciones o líneas
 * "Artista - Canción". Se manda en tandas para ir mostrando el avance; lo que ya estaba no se repite.
 */
export async function completarConPegadas(id: string, texto: string, progreso: (hechas: number, total: number) => void) {
  const cuenta = cuentaActual();
  if (!cuenta) throw new Error('Entra a tu cuenta para importar playlists');
  const lineas = texto
    .split(/[\r\n]+|\s+(?=https:\/\/open\.spotify\.com\/)/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lineas.length) throw new Error('No hay nada pegado');
  const suma = { encontradas: 0, faltan: 0, noLeidas: 0 };
  for (let i = 0; i < lineas.length; i += TANDA) {
    progreso(i, lineas.length);
    const r = await api<{ playlist: PlaylistServidor; encontradas: number; faltan: number; noLeidas: number }>(
      `/api/playlists/${encodeURIComponent(id)}/completar`,
      { method: 'POST', body: { texto: lineas.slice(i, i + TANDA).join('\n') } },
    );
    suma.encontradas += r.encontradas;
    suma.faltan += r.faltan;
    suma.noLeidas += r.noLeidas;
    await usePlaylists.getState().applyRemote([desdeServidor(r.playlist, cuenta)], []);
  }
  progreso(lineas.length, lineas.length);
  return { ...suma, lineas: lineas.length };
}

/** Las canciones de una playlist importada que todavía no están en el servidor. */
export const faltantesDe = (id: string) => api<Faltante[]>(`/api/playlists/${encodeURIComponent(id)}/faltantes`);

/** Dejar de esperar una canción que falta. */
export const quitarFaltante = (id: string, faltante: number) =>
  api(`/api/playlists/${encodeURIComponent(id)}/faltantes/${faltante}`, { method: 'DELETE' });

let ultima = 0;

/** Baja las playlists de la cuenta y sube las de este aparato que falten o sean más nuevas. */
export async function sincronizarPlaylists(forzar = false) {
  const cuenta = cuentaActual();
  if (!cuenta || !usePlaylists.getState().loaded) return;
  if (!forzar && Date.now() - ultima < 30_000) return;
  ultima = Date.now();
  await subirPendientes();
  let remotas: PlaylistServidor[];
  try {
    remotas = await api<PlaylistServidor[]>('/api/playlists');
  } catch {
    return;
  }
  const locales = new Map(usePlaylists.getState().list.map((p) => [p.id, p]));
  const poner: Playlist[] = [];
  const quitar: string[] = [];
  const subir: string[] = [];
  for (const r of remotas) {
    const l = locales.get(r.id);
    if (r.borrada) {
      if (l && esMia(l, cuenta) && l.updatedAt <= r.actualizada) quitar.push(r.id);
      continue;
    }
    if (!l || r.actualizada > l.updatedAt) poner.push(desdeServidor(r, cuenta));
    else if (l.updatedAt > r.actualizada) subir.push(r.id);
    else if (!l.cuenta) poner.push({ ...l, cuenta });
  }
  const enServidor = new Set(remotas.map((r) => r.id));
  for (const l of locales.values()) if (!enServidor.has(l.id) && esMia(l, cuenta)) subir.push(l.id);
  if (poner.length || quitar.length) await usePlaylists.getState().applyRemote(poner, quitar);
  if (subir.length) {
    escribir(PENDIENTES(cuenta), [...leer(PENDIENTES(cuenta)), ...subir]);
    await subirPendientes();
  }
}

// Al entrar a una cuenta: se sincroniza enseguida. Al volver a la app: como mucho cada 30 s.
let tokenAntes = useCuenta.getState().token;
useCuenta.subscribe((c) => {
  if (c.token === tokenAntes) return;
  tokenAntes = c.token;
  // Saliste o cambiaste de cuenta: las playlists de la cuenta anterior se van de este aparato.
  void olvidarAjenas().then(() => {
    if (c.token) void sincronizarPlaylists(true);
  });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void sincronizarPlaylists();
});
