import { useRef, useState } from 'react';
import { BANDS, BASS, MAX_DB, useEq } from '../player/equalizer';

/** "400", "1k", "2,5k", "6,3k", "16k" (con coma decimal, como en español). */
const label = (hz: number) => (hz >= 1000 ? `${String(hz / 1000).replace('.', ',')}k` : String(hz));
const fmt = (v: number) => `${v > 0 ? '+' : ''}${String(v).replace('.', ',')} dB`;
const TICKS = Array.from({ length: 2 * MAX_DB + 1 }, (_, i) => MAX_DB - i); // +10 … −10

/**
 * Control deslizante grueso, pensado para el dedo. Toda la columna (o fila) es zona táctil:
 * tocas en cualquier punto y la bolita salta ahí; luego arrastras.
 */
function Slider({
  value,
  onChange,
  vertical,
  name,
}: {
  value: number;
  onChange: (v: number) => void;
  vertical?: boolean;
  name: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const { enabled, setEnabled } = useEq();

  const valueAt = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const t = vertical ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const c = Math.min(1, Math.max(0, t));
    return vertical ? MAX_DB - c * 2 * MAX_DB : -MAX_DB + c * 2 * MAX_DB;
  };
  const pct = ((value + MAX_DB) / (2 * MAX_DB)) * 100; // 0 = −10, 100 = +10
  const pos = vertical ? { top: `${100 - pct}%` } : { left: `${pct}%` };

  return (
    <div
      className={`bs ${vertical ? 'v' : 'h'} ${drag ? 'drag' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuemin={-MAX_DB}
      aria-valuemax={MAX_DB}
      aria-valuenow={value}
      aria-valuetext={fmt(value)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!enabled) setEnabled(true);
        setDrag(true);
        onChange(valueAt(e));
      }}
      onPointerMove={(e) => drag && onChange(valueAt(e))}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onDoubleClick={() => onChange(0)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(value + 1);
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(value - 1);
      }}
    >
      <div className="bs-track" ref={ref}>
        <div className="bs-rail" />
        <div className="bs-thumb" style={pos}>
          {drag && <span className="bs-tip">{fmt(value)}</span>}
        </div>
      </div>
    </div>
  );
}

/** Columna de rayitas entre las barras (cada rayita = 1 dB; más largas en ±10 y 0). */
function TickColumn() {
  return (
    <div className="bs-ticks" aria-hidden="true">
      {TICKS.map((t) => (
        <i key={t} className={t === 0 || Math.abs(t) === MAX_DB ? 'major' : ''} />
      ))}
    </div>
  );
}

/** Ecualizador por bandas: 5 barras verticales gruesas + Graves en horizontal. */
export function BandsPanel() {
  const { enabled, gains, setBand } = useEq();
  return (
    <div className={`bands ${enabled ? '' : 'off'}`}>
      <div className="bands-main">
        <div className="bands-scale" aria-hidden="true">
          <span>+{MAX_DB}</span>
          <span>0</span>
          <span>−{MAX_DB}</span>
        </div>
        <div className="bands-grid">
          {BANDS.map((hz, i) => (
            <div key={hz} className="bands-col-wrap">
              {i > 0 && <TickColumn />}
              <div className="bands-col">
                <Slider vertical name={`${label(hz)} Hz`} value={gains[i]} onChange={(v) => setBand(i, v)} />
                <span className="bands-freq">{label(hz)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bass-row">
        <div className="bass-badge" aria-hidden="true">
          <b>GRAVES</b>
          <i />
          <i />
          <i />
        </div>
        <div className="bass-slider">
          <Slider name="Graves" value={gains[BASS]} onChange={(v) => setBand(BASS, v)} />
          <div className="bass-ticks" aria-hidden="true">
            {TICKS.map((t) => (
              <i key={t} className={t === 0 || Math.abs(t) === MAX_DB ? 'major' : ''} />
            ))}
          </div>
          <div className="bass-labels" aria-hidden="true">
            <span>−{MAX_DB}</span>
            <span>0</span>
            <span>+{MAX_DB}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
