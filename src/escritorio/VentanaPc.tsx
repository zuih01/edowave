import { useEffect, useState } from 'react';

/**
 * App de PC: la barra de Windows (título, minimizar, maximizar, cerrar) va integrada en la barra de arriba de la
 * interfaz, como Spotify. La ventana no tiene marco (tauri.conf.json → decorations: false); estos botones y el
 * arrastre de la barra la reemplazan. En la web no se dibuja nada.
 */
type Ventana = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  startDragging: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (f: () => void) => Promise<() => void>;
};
type Tauri = { window: { getCurrentWindow: () => Ventana } };

const ventana = (): Ventana | null => {
  try {
    return (window as unknown as { __TAURI__?: Tauri }).__TAURI__?.window.getCurrentWindow() ?? null;
  } catch {
    return null;
  }
};

export const esAppPc = import.meta.env.VITE_PLATAFORMA === 'pc';

/**
 * Arrastrar la ventana desde la barra de arriba (en sus partes vacías) y doble clic para maximizar.
 * No cuenta si se tocó un botón, el buscador o un enlace.
 */
export function arrastrarVentana(e: React.MouseEvent) {
  if (!esAppPc || e.button !== 0) return;
  const t = e.target as Element;
  if (t.closest('button, input, a, kbd, [role="dialog"], .esc-buscador-caja, .esc-perfil-velo')) return;
  const v = ventana();
  if (!v) return;
  if (e.detail === 2) void v.toggleMaximize().catch(() => {});
  else void v.startDragging().catch(() => {});
}

export function BotonesVentana() {
  const [max, setMax] = useState(false);
  useEffect(() => {
    const v = ventana();
    if (!v) return;
    let quitar: (() => void) | undefined;
    const revisar = () => void v.isMaximized().then(setMax).catch(() => {});
    revisar();
    void v
      .onResized(revisar)
      .then((f) => (quitar = f))
      .catch(() => {});
    return () => quitar?.();
  }, []);
  if (!esAppPc || !ventana()) return null;
  const v = ventana()!;
  return (
    <div className="esc-ventana">
      <button onClick={() => void v.minimize()} aria-label="Minimizar" title="Minimizar">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button onClick={() => void v.toggleMaximize()} aria-label={max ? 'Restaurar' : 'Maximizar'} title={max ? 'Restaurar' : 'Maximizar'}>
        {max ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5v-2h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button className="cerrar" onClick={() => void v.close()} aria-label="Cerrar" title="Cerrar">
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  );
}
