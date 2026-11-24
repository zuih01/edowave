import { useEffect, useState } from 'react';

/**
 * App de PC: "Minimizar a la bandeja" (apagado por defecto). Encendido, al minimizar la ventana se esconde de la
 * barra de tareas y la música sigue; se vuelve a abrir desde el ícono junto al reloj (el cajón de la flecha ^).
 * La parte de Rust está en escritorio-pc\app\src-tauri\src\bandeja.rs; aquí se guarda el ajuste.
 */
type Tauri = { core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
const tauri = () => (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

const CLAVE = 'minimizarABandeja';
const leer = () => {
  try {
    return localStorage.getItem(CLAVE) === 'on';
  } catch {
    return false;
  }
};

/** Se monta una vez en la vista de PC: le cuenta a Rust el ajuste guardado. */
export function useBandejaPc() {
  useEffect(() => {
    void tauri()?.core.invoke('bandeja', { activar: leer() }).catch(() => {});
  }, []);
}

/** Configuración, solo en la app de PC. */
export function BandejaPc() {
  const [on, setOn] = useState(leer);
  const t = tauri();
  if (!t) return null;
  const cambiar = () => {
    const nuevo = !on;
    setOn(nuevo);
    try {
      localStorage.setItem(CLAVE, nuevo ? 'on' : 'off');
    } catch {
      /* sin almacenamiento: vale hasta cerrar la app */
    }
    void t.core.invoke('bandeja', { activar: nuevo }).catch(() => {});
  };
  return (
    <button className="settings-row" role="switch" aria-checked={on} onClick={cambiar}>
      <span className="settings-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5v-3h3.56a3.5 3.5 0 0 0 6.88 0H19v3zm0-5h-4.99a2 2 0 0 1-4.02 0H5V5h14v9z" />
        </svg>
      </span>
      <span className="track-text">
        <span className="settings-label">Minimizar a la bandeja</span>
        <span className="settings-sub">Al minimizar, Edowave sigue sonando y se abre desde el ícono junto al reloj</span>
      </span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
