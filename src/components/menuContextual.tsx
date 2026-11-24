import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { escritorioActivo } from '../escritorio/activo';

/**
 * Menús contextuales de la versión de PC (como Spotify): el menú ⋮ de una canción o de una playlist aparece junto
 * al lugar donde hiciste clic (o clic derecho), no como ventana al centro. En el teléfono siguen siendo la hoja que
 * sube desde abajo.
 *
 * Se recuerda el último clic fuera de un menú: ahí se ancla el menú que se abra. Mientras un menú está abierto,
 * los clics dentro de él no mueven el ancla (así "Eliminar" → confirmar queda en el mismo lugar).
 */
let punto = { x: innerWidth / 2, y: innerHeight / 3 };
const anotar = (e: MouseEvent) => {
  if (e.target instanceof Element && e.target.closest('.sheet')) return;
  punto = { x: e.clientX, y: e.clientY };
};
document.addEventListener('pointerdown', anotar, true);
document.addEventListener('contextmenu', anotar, true);

export const menuContextual = () => escritorioActivo();

/** Menú abierto con el teclado (atajo P): aparece al centro de la ventana, no donde quedó el último clic. */
export function anclarAlCentro(ancho = 300, alto = 360) {
  punto = { x: Math.max(8, (innerWidth - ancho) / 2), y: Math.max(8, (innerHeight - alto) / 2) };
}

/** Coloca el menú junto al último clic, sin salirse de la ventana. Devuelve la ref para el `.sheet`. */
export function useAnclaMenu<T extends HTMLElement>(activo: boolean) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!activo || !el || !menuContextual()) return;
    const { x, y } = punto;
    const ubicar = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = x + 2;
      if (left + w > innerWidth - 8) left = Math.max(8, x - w - 2);
      let top = y + 2;
      if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    ubicar();
    const ro = new ResizeObserver(ubicar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activo]);
  return ref;
}

/**
 * Submenú de PC (como "Agregar a otra playlist" en Spotify): al pasar el mouse se abre al lado. En el teléfono es una
 * fila normal que hace `alTocar`.
 */
export function Submenu({ icono, texto, alTocar, children }: { icono: ReactNode; texto: ReactNode; alTocar: () => void; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const fila = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useLayoutEffect(() => {
    const f = fila.current;
    const p = panel.current;
    if (!abierto || !f || !p) return;
    const r = f.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let left = r.right - 4;
    if (left + w > innerWidth - 8) left = Math.max(8, r.left - w + 4);
    let top = r.top - 6;
    if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  }, [abierto]);

  if (!menuContextual()) {
    return (
      <button className="sheet-item" onClick={alTocar}>
        {icono} {texto}
      </button>
    );
  }
  const abrir = () => {
    clearTimeout(timer.current);
    setAbierto(true);
  };
  const cerrar = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAbierto(false), 220);
  };
  return (
    <div
      ref={fila}
      className={`sheet-item ctx-sub ${abierto ? 'on' : ''}`}
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={abierto}
      tabIndex={0}
      onMouseEnter={abrir}
      onMouseLeave={cerrar}
      onClick={(e) => {
        if (!panel.current?.contains(e.target as Node)) setAbierto(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'ArrowRight') setAbierto(true);
        if (e.key === 'ArrowLeft' || e.key === 'Escape') setAbierto(false);
      }}
    >
      {icono} <span className="ctx-sub-texto">{texto}</span>
      <svg className="ctx-sub-flecha" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9 6l6 6-6 6z" />
      </svg>
      {abierto && (
        <div ref={panel} className="ctx-panel" role="menu" onMouseEnter={abrir} onMouseLeave={cerrar} onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}
