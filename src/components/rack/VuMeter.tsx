import { useEffect, useRef } from 'react';

/**
 * Medidor de aguja con luz cálida (como el VU de los niveladores ópticos clásicos).
 * Muestra la reducción de ganancia en dB: la aguja descansa en 0 (derecha) y baja hacia la izquierda
 * cuanto más comprime. Lee el valor 60 veces por segundo con `read` y lo suaviza como una aguja real.
 */
const MARKS = [0, -1, -2, -3, -5, -7, -10, -20];
/** Números que se escriben (los demás solo llevan rayita, para que no se encimen). */
const NUMBERED = new Set([0, -1, -3, -5, -10, -20]);
const CX = 100;
const CY = 122; // pivote de la aguja (debajo de la cara, como en un VU real)
const SPAN = 56; // grados a cada lado

/** 0 dB → 1 (derecha), -20 dB → 0 (izquierda); los primeros dB ocupan más espacio, como en un VU. */
const posOf = (db: number) => 1 - Math.sqrt(Math.min(20, Math.max(0, -db)) / 20);
const angleOf = (db: number) => -SPAN + posOf(db) * SPAN * 2;

export function VuMeter({ read, on }: { read: () => number; on: boolean }) {
  const needle = useRef<SVGLineElement>(null);
  const shown = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const target = on ? read() : 0;
      // Inercia de aguja (~120 ms)
      shown.current += (target - shown.current) * (1 - Math.exp(-dt / 0.12));
      needle.current?.setAttribute('transform', `rotate(${angleOf(shown.current)} ${CX} ${CY})`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read, on]);

  const pt = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return [CX + r * Math.sin(a), CY - r * Math.cos(a)] as const;
  };

  return (
    <div className={`vu ${on ? 'on' : ''}`}>
      <svg viewBox="0 0 200 92" aria-hidden="true">
        <defs>
          <radialGradient id="vuFace" cx="0.5" cy="0.9" r="0.9">
            <stop offset="0" stopColor="#fff3d1" />
            <stop offset="1" stopColor="#e8c983" />
          </radialGradient>
        </defs>
        <rect x="2" y="2" width="196" height="88" rx="10" className="vu-face" />
        {/* Arco de la escala */}
        <path d={`M ${pt(-SPAN, 92).join(' ')} A 92 92 0 0 1 ${pt(SPAN, 92).join(' ')}`} className="vu-arc" />
        {MARKS.map((m) => {
          const a = angleOf(m);
          const [x1, y1] = pt(a, 86);
          const [x2, y2] = pt(a, 95);
          const [tx, ty] = pt(a, 76);
          return (
            <g key={m}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="vu-tick" />
              {NUMBERED.has(m) && (
                <text x={tx} y={ty} className="vu-num" textAnchor="middle" dominantBaseline="central">
                  {m === 0 ? '0' : m}
                </text>
              )}
            </g>
          );
        })}
        <text x={CX} y="80" className="vu-label" textAnchor="middle">
          REDUCCIÓN dB
        </text>
        {/* Aguja */}
        <line ref={needle} x1={CX} y1={CY} x2={CX} y2={CY - 96} className="vu-needle" transform={`rotate(${angleOf(0)} ${CX} ${CY})`} />
      </svg>
    </div>
  );
}
