import { esAppNativa } from '../server/cuenta';

/**
 * ¿Versión de PC o de teléfono?
 * - App de PC (Tauri): siempre la de PC (aunque achiques la ventana; la distribución se ajusta).
 * - App de Android: siempre la de teléfono.
 * - Web (musica.empanados.io, también el servidor de desarrollo): según el aparato. Un computador con mouse ve la
 *   de PC; un teléfono o tablet (iPhone, iPad, Android) ve la de teléfono. Se puede forzar en Configuración → Vista
 *   (localStorage.escritorio = 'on' / 'off').
 */
export type VistaWeb = 'auto' | 'pc' | 'telefono';

/** ¿Este aparato es un computador? (mouse o touchpad y no es un teléfono ni una tablet) */
function esComputador() {
  try {
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return false;
    // El iPad con iPadOS se presenta como Mac, pero tiene pantalla táctil
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false;
    return matchMedia('(pointer: fine)').matches || matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

export const esWeb = import.meta.env.VITE_PLATAFORMA !== 'pc' && !esAppNativa;

export function vistaWeb(): VistaWeb {
  try {
    const v = localStorage.getItem('escritorio');
    if (v === 'on') return 'pc';
    if (v === 'off') return 'telefono';
  } catch {
    /* sin almacenamiento */
  }
  return 'auto';
}

/** Cambia la vista de la web y recarga (la distribución se elige al abrir). */
export function cambiarVistaWeb(v: VistaWeb) {
  try {
    if (v === 'auto') localStorage.removeItem('escritorio');
    else localStorage.setItem('escritorio', v === 'pc' ? 'on' : 'off');
  } catch {
    /* sin almacenamiento */
  }
  location.reload();
}

function permitido() {
  if (import.meta.env.VITE_PLATAFORMA === 'pc') return true;
  if (esAppNativa) return false;
  const v = vistaWeb();
  return v === 'auto' ? esComputador() : v === 'pc';
}

const activo = permitido();

/** ¿Se está usando la versión de PC? (para lugares que no son componentes) */
export const escritorioActivo = () => activo;

export function useEscritorio() {
  return activo;
}
