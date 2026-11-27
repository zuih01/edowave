import { Capacitor } from '@capacitor/core';
import { useNav } from './nav';
import { usePlayer } from './player/player';
import { api, useCuenta } from './server/cuenta';

/**
 * Estadísticas que manda la app (el admin las ve agrupadas en su panel, nunca por persona):
 *  - desde dónde se puso cada canción (accesos directos, búsqueda, radio, álbum…),
 *  - qué canciones se mostraron en pantalla (para el CTR: mostradas vs. tocadas),
 *  - cuánto tiempo está abierta la app y cuánto suena música (cada minuto),
 *  - el aparato y la versión de la app.
 */

export type Origen =
  | 'accesos'
  | 'busqueda'
  | 'radio'
  | 'playlist'
  | 'album'
  | 'artista'
  | 'amigos'
  | 'comunidad'
  | 'aleatorio'
  | 'animo'
  | 'redescubre'
  | 'historial'
  | 'biblioteca'
  | 'otro';

/** Qué aparato es (Android con la app, Android en el navegador, iPhone o PC). */
export const aparato = (() => {
  if (Capacitor.isNativePlatform()) return 'android-app';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/android/i.test(ua)) return 'android-web';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iphone';
  return 'pc';
})();
export const versionApp: string = import.meta.env.VITE_VERSION_WEB || 'web';

/**
 * La versión que se muestra junto al perfil: "stable-1.0.0" (o "beta-…" si es de prueba). En la app de PC, la
 * instalada; en la web, la última de la app (la de tauri.conf.json al compilar la web).
 */
export function etiquetaVersion(): string {
  const v = (versionApp !== 'web' && /^\d+\.\d+\.\d+/.test(versionApp) ? versionApp : import.meta.env.VITE_VERSION_APP) || '';
  if (!v) return '';
  return /-/.test(v) ? v : `stable-${v}`;
}

// ---------------- Origen de cada escucha ----------------

let siguiente: Origen | null = null;
/** Lo llama quien pone a sonar algo cuando el origen no se deduce de la pantalla (aleatorio, ánimo, amigos…). */
export function marcarOrigen(o: Origen) {
  siguiente = o;
  setTimeout(() => {
    if (siguiente === o) siguiente = null; // vale solo para lo que se toque ahora
  }, 1500);
}

/** Origen de lo que se pone a sonar ahora: el marcado, o el que corresponde a la pantalla donde estás. */
export function tomarOrigen(): Origen {
  if (siguiente) {
    const o = siguiente;
    siguiente = null;
    return o;
  }
  const { tab, stack } = useNav.getState();
  const top = stack[stack.length - 1];
  if (top) {
    const porPagina: Record<string, Origen> = {
      album: 'album',
      artist: 'artista',
      playlist: 'playlist',
      history: 'historial',
      comunidad: 'comunidad',
      usuario: 'amigos',
    };
    return porPagina[top.type] ?? 'otro';
  }
  return tab === 'home' ? 'accesos' : tab === 'search' ? 'busqueda' : tab === 'library' ? 'biblioteca' : 'otro';
}

// ---------------- Impresiones (canciones que se mostraron) ----------------

const pendientes = new Map<Origen, Set<string>>();
let timer: ReturnType<typeof setTimeout> | undefined;
/** Avisa que estas canciones se mostraron en pantalla (se mandan juntas, cada pocos segundos). */
export function mostradas(origen: Origen, ids: string[]) {
  if (!useCuenta.getState().token || !ids.length) return;
  const s = pendientes.get(origen) ?? new Set<string>();
  for (const id of ids) if (id.startsWith('s:')) s.add(id);
  pendientes.set(origen, s);
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const [o, set] of pendientes) {
      if (set.size) void api('/api/estadisticas/impresiones', { method: 'POST', body: { origen: o, ids: [...set] } }).catch(() => {});
    }
    pendientes.clear();
  }, 4000);
}

// ---------------- Tiempo de uso ----------------

let abierta = 0;
let sonando = 0;
function mandarLatido() {
  if (!useCuenta.getState().token || (!abierta && !sonando)) return;
  const body = { abierta, sonando, aparato, version: versionApp };
  abierta = 0;
  sonando = 0;
  void api('/api/estadisticas/latido', { method: 'POST', body }).catch(() => {});
}

let iniciado = false;
export function iniciarEstadisticas() {
  if (iniciado) return;
  iniciado = true;
  // Cada 5 s se cuenta si la app está en pantalla y si suena música; cada minuto se manda.
  setInterval(() => {
    if (document.visibilityState === 'visible') abierta += 5;
    if (usePlayer.getState().playing) sonando += 5;
  }, 5000);
  setInterval(mandarLatido, 60_000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && mandarLatido());
}
