import type { PlayEvent } from '../db';
import { api, useCuenta } from './cuenta';

/**
 * Tus datos viven en el SERVIDOR, no en el teléfono: escuchas (historial), "me gusta", búsquedas recientes,
 * ajustes y lo que estaba sonando. Así en el teléfono, la tablet o el PC ves lo mismo.
 *
 * Lo único que la app guarda un rato: las escuchas que no se pudieron mandar (sin conexión) hasta que se
 * mandan, y la sesión abierta.
 */

const conSesion = () => !!useCuenta.getState().token;

// ---------------- Escuchas ----------------

const PENDIENTES = 'escuchasPorMandar';
type EscuchaParaMandar = PlayEvent & { clienteId: string };

const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function leerPendientes(): EscuchaParaMandar[] {
  try {
    return JSON.parse(localStorage.getItem(PENDIENTES) ?? '[]');
  } catch {
    return [];
  }
}
function guardarPendientes(l: EscuchaParaMandar[]) {
  try {
    if (l.length) localStorage.setItem(PENDIENTES, JSON.stringify(l.slice(-2000)));
    else localStorage.removeItem(PENDIENTES);
  } catch {
    /* sin espacio */
  }
}

let mandando: Promise<void> | null = null;
/** Manda las escuchas pendientes (las que no salieron por falta de conexión). */
export function mandarPendientes(): Promise<void> {
  if (!conSesion()) return Promise.resolve();
  if (mandando) return mandando;
  // La marca se borra al terminar la promesa (no dentro: si no había nada que mandar, se borraba antes de
  // ponerse y quedaba puesta para siempre: las escuchas dejaban de llegar al servidor).
  const p = (async () => {
    try {
      const l = leerPendientes();
      if (!l.length) return;
      await api('/api/escuchas', { method: 'POST', body: { escuchas: l } });
      // Solo se quitan las que se mandaron (pudieron llegar otras mientras tanto).
      const enviadas = new Set(l.map((e) => e.clienteId));
      guardarPendientes(leerPendientes().filter((e) => !enviadas.has(e.clienteId)));
      escuchasCambiaron();
    } catch {
      /* sin conexión: se reintenta en la próxima */
    }
  })();
  mandando = p;
  void p.finally(() => {
    if (mandando === p) mandando = null;
  });
  return p;
}

/** Guarda una escucha en tu cuenta. `alCerrar` = la app se está cerrando: se deja lista para mandar después. */
export function registrarEscucha(e: PlayEvent, alCerrar = false) {
  if (!conSesion()) return;
  guardarPendientes([...leerPendientes(), { ...e, clienteId: nuevoId() }]);
  if (!alCerrar) void mandarPendientes();
}

const oyentesEscuchas = new Set<() => void>();
/** Avisa cuando llegan escuchas nuevas al servidor (para recalcular el feed, el historial…). */
export function alCambiarEscuchas(fn: () => void) {
  oyentesEscuchas.add(fn);
  return () => oyentesEscuchas.delete(fn);
}
const escuchasCambiaron = () => oyentesEscuchas.forEach((fn) => fn());

/** Tu historial (lo más reciente primero). */
export async function cargarHistorial(limite = 1000): Promise<PlayEvent[]> {
  if (!conSesion()) return [];
  try {
    return await api<PlayEvent[]>(`/api/historial?limite=${limite}`);
  } catch {
    return [];
  }
}

// ---------------- "Me gusta" ----------------

export async function cargarValoraciones(): Promise<{ trackId: string; value: 1 | -1; at: number }[]> {
  if (!conSesion()) return [];
  try {
    return await api('/api/valoraciones');
  } catch {
    return [];
  }
}
export async function guardarValoracion(trackId: string, value: 1 | -1 | 0) {
  if (!conSesion()) return;
  await api('/api/valoraciones', { method: 'PUT', body: { cancion: trackId, valor: value } }).catch(() => {});
}

// ---------------- Estado: ajustes, cola, búsquedas ----------------

export interface Busquedas {
  queries: string[];
  tracks: string[];
}
export interface ColaGuardada {
  queue: string[];
  index: number;
  position: number;
  repeat: 'off' | 'all' | 'one';
  shuffle: boolean;
  originalQueue: string[] | null;
  at: number;
}
export interface Estado {
  ajustes: Record<string, string>;
  cola: ColaGuardada | null;
  busquedas: Busquedas;
  migrado: boolean;
  actualizado: number;
}

export async function cargarEstado(): Promise<Estado | null> {
  if (!conSesion()) return null;
  try {
    return await api<Estado>('/api/estado');
  } catch {
    return null;
  }
}

export function guardarEstado(parte: Partial<Pick<Estado, 'ajustes' | 'cola' | 'busquedas' | 'migrado'>>) {
  if (!conSesion()) return Promise.resolve();
  return api('/api/estado', { method: 'PUT', body: parte }).then(
    () => undefined,
    () => undefined,
  );
}

/** Junta varios cambios seguidos en un solo envío (p. ej. mover una perilla del ecualizador). */
export function despuesDe<T>(ms: number, fn: (v: T) => void) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let ultimo: T;
  const ya = () => {
    clearTimeout(t);
    t = undefined;
    fn(ultimo);
  };
  const programar = (v: T) => {
    ultimo = v;
    clearTimeout(t);
    t = setTimeout(ya, ms);
  };
  programar.ahora = () => t !== undefined && ya();
  return programar;
}
