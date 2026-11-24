import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Un `.carousel` con flechas ‹ › a los lados, para quien usa mouse (en PC no hay cómo deslizar). Cada flecha
 * desaparece cuando ya no hay más hacia ese lado. En el celular las flechas no se ven (solo con puntero fino,
 * ver styles.css): ahí se sigue deslizando con el dedo como siempre.
 */
export function Carrusel({ className = '', children }: { className?: string; children: React.ReactNode }) {
  const caja = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ ini: true, fin: true });

  const medir = useCallback(() => {
    const el = caja.current;
    if (!el) return;
    // Margen de unos píxeles: el scroll suave y el zoom dejan decimales.
    setBordes({ ini: el.scrollLeft <= 4, fin: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    window.addEventListener('resize', medir);
    // También cuando cambia el tamaño de la caja o de su contenido (se cargan portadas, cambia la lista).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    for (const hijo of Array.from(el.children)) ro?.observe(hijo);
    return () => {
      el.removeEventListener('scroll', medir);
      window.removeEventListener('resize', medir);
      ro?.disconnect();
    };
  }, [medir, children]);

  // Una "página": casi todo el ancho visible (queda un pedazo de la última tarjeta para ubicarse).
  const mover = (dir: number) => {
    const el = caja.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <div className="carrusel-caja">
      <div ref={caja} className={`carousel ${className}`.trim()}>
        {children}
      </div>
      {!bordes.ini && (
        <button type="button" className="carrusel-flecha ant" onClick={() => mover(-1)} aria-label="Anteriores">
          ‹
        </button>
      )}
      {!bordes.fin && (
        <button type="button" className="carrusel-flecha sig" onClick={() => mover(1)} aria-label="Siguientes">
          ›
        </button>
      )}
    </div>
  );
}
