import { useEffect, useRef } from 'react';

/**
 * Fondo animado de la letra (idea de "Beautiful Lyrics"): la carátula, muy borrosa, en cuatro círculos que giran a
 * distintas velocidades. Se dibuja en un lienzo diminuto (unos 64 px) que el navegador agranda y difumina: cuesta casi
 * nada y no necesita WebGL. Sin carátula queda el color de fondo. Con "reducir movimiento" se dibuja una sola vez.
 */
export function FondoLetra({ url, color }: { url?: string; color: string }) {
  const lienzo = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = lienzo.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!url) return;
    let vivo = true;
    let raf = 0;
    const img = new Image();
    img.onload = () => {
      if (!vivo) return;
      // Carátula cuadrada y recortada en círculo, ya algo borrosa (una sola vez)
      const lado = 96;
      const base = document.createElement('canvas');
      base.width = base.height = lado;
      const b = base.getContext('2d');
      if (!b) return;
      const m = Math.min(img.naturalWidth, img.naturalHeight);
      b.beginPath();
      b.arc(lado / 2, lado / 2, lado / 2, 0, Math.PI * 2);
      b.clip();
      if ('filter' in b) b.filter = 'blur(4px) saturate(1.35)';
      b.drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, lado, lado);

      const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let ultimo = 0;
      const dibujar = (ahora: number) => {
        if (!vivo) return;
        if (!quieto) raf = requestAnimationFrame(dibujar);
        if (ahora - ultimo < 33) return; // ~30 cuadros por segundo bastan
        ultimo = ahora;
        // El lienzo sigue la forma de la caja, pero con muy pocos píxeles
        const r = c.getBoundingClientRect();
        const w = 64;
        const h = Math.max(24, Math.round((64 * r.height) / Math.max(1, r.width)));
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const L = Math.max(w, h);
        const vertical = h > w;
        const t = ahora / 3500;
        ctx.clearRect(0, 0, w, h);
        const circulo = (x: number, y: number, diametro: number, alfa: number, giro: number) => {
          ctx.save();
          ctx.globalAlpha = alfa;
          ctx.translate(x, y);
          ctx.rotate(giro);
          ctx.drawImage(base, -diametro / 2, -diametro / 2, diametro, diametro);
          ctx.restore();
        };
        circulo(w / 2, h / 2, L * 1.5, 1, t * -0.25); // fondo, lento
        circulo(w / 2, h / 2, L * (vertical ? 0.75 : 1), 0.75, t * 0.5); // centro
        circulo(0, h, L * 0.75, 0.5, t); // abajo a la izquierda
        circulo(w, 0, L * (vertical ? 0.5 : 0.65), 0.5, t * -0.75); // arriba a la derecha
      };
      raf = requestAnimationFrame(dibujar);
    };
    img.src = url;
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
    };
  }, [url]);

  return (
    <div className="fondo-letra" style={{ background: color }} aria-hidden="true">
      <canvas ref={lienzo} />
    </div>
  );
}
