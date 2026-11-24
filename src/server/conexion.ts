import { create } from 'zustand';
import { useCuenta } from './cuenta';

/**
 * ¿Hay conexión con el servidor de música?
 *
 * Se sabe por lo que va pasando (una petición que falla, el aviso en vivo que se corta, una canción que no
 * carga). Mientras no hay conexión se pregunta cada 8 s si volvió. La música del servidor depende de él:
 * sin conexión solo suena lo que está en el teléfono (lo importado y las ≤3 canciones que se guardan).
 */
interface Conexion {
  servidor: boolean;
  /**
   * El servidor lleva más de 1:30 sin contestar. Recién ahí se avisa ("Sin conexión con el servidor"), las
   * canciones del servidor se ven en gris y el reproductor salta a lo que hay en el teléfono. Un corte corto
   * (internet lento, un segundo sin señal) no se nota: el reproductor espera y sigue solo.
   */
  largo: boolean;
  /** Cambia cuando cambian las canciones guardadas en el teléfono (para redibujar lo que se ve en gris). */
  guardadas: number;
}

export const useConexion = create<Conexion>(() => ({ servidor: true, largo: false, guardadas: 0 }));

/** Cuánto tiene que estar caído el servidor para avisar. */
export const AVISO_MS = 90_000;
let avisoLargo: ReturnType<typeof setTimeout> | undefined;

/** Respuestas que en realidad significan "el servidor no contesta" (las da el puente de desarrollo). */
export const esCaida = (status: number) => status === 0 || status === 502 || status === 503 || status === 504;

let sondeo: ReturnType<typeof setInterval> | undefined;

export function marcarConectado() {
  if (sondeo) {
    clearInterval(sondeo);
    sondeo = undefined;
  }
  clearTimeout(avisoLargo);
  avisoLargo = undefined;
  if (!useConexion.getState().servidor || useConexion.getState().largo) useConexion.setState({ servidor: true, largo: false });
}

/** (`_base` se ignora: siempre se usa la dirección actual de la cuenta.) */
export function marcarSinConexion(_base?: string) {
  if (useConexion.getState().servidor) useConexion.setState({ servidor: false });
  avisoLargo ??= setTimeout(() => {
    avisoLargo = undefined;
    if (!useConexion.getState().servidor) useConexion.setState({ largo: true });
  }, AVISO_MS);
  if (!sondeo) sondeo = setInterval(() => void probar(), 8000);
}

/** Pregunta (rápido, máx. 3 s) si el servidor contesta. */
export async function probar(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${useCuenta.getState().base}/api/salud`, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      marcarConectado();
      return true;
    }
  } catch {
    /* sigue sin conexión */
  }
  marcarSinConexion();
  return false;
}

/**
 * El teléfono mismo dice que no tiene internet (modo avión, sin señal ni Wi-Fi): no hace falta esperar 1:30,
 * se pasa al modo sin conexión al tiro. Al volver internet se pregunta al servidor.
 */
function sinInternet() {
  clearTimeout(avisoLargo);
  avisoLargo = undefined;
  useConexion.setState({ servidor: false, largo: true });
  if (!sondeo) sondeo = setInterval(() => void probar(), 8000);
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', sinInternet);
  window.addEventListener('online', () => void probar());
  if (typeof navigator !== 'undefined' && navigator.onLine === false) sinInternet();
}

export const avisarCambioGuardadas = () => useConexion.setState((s) => ({ guardadas: s.guardadas + 1 }));
