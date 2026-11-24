import { useRef, useState } from 'react';

/**
 * Piezas compartidas de todo equipo "de rack" (Pultec, rack de efectos): misma estética siempre.
 * Panel con 4 tornillos, palanca de encendido, foco que se ilumina cuando está activo,
 * perillas estriadas con escala y selectores "cabeza de pollo".
 */

export const hz = (f: number) => (f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`);
const short = (f: number) => (f >= 1000 ? String(f / 1000) : String(f));
export const lvl = (v: number) => (v % 1 ? v.toFixed(1) : String(v));

/** Posición en el arco de 270° (de -135° a +135°) → coordenadas, con el centro en (0,0). */
const polar = (t: number, r: number) => {
  const a = ((-135 + t * 270) * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)] as const;
};

/**
 * Perilla como las del panel Pultec:
 *  - `round`: perilla redonda estriada con la escala 0–10 alrededor.
 *  - `pointer`: selector "cabeza de pollo" que salta entre frecuencias impresas alrededor.
 * Se gira arrastrando hacia arriba/abajo; doble toque la regresa a su posición inicial.
 */
export function Knob({
  caption,
  value,
  onChange,
  options,
  labels,
  format,
  def,
  variant = 'round',
}: {
  caption: string;
  value: number;
  onChange: (v: number) => void;
  /** Posiciones fijas (selector). Sin esto, va de 0 a 10 en medios puntos. */
  options?: number[];
  /** Textos de la escala; por defecto 0–10 o las opciones. */
  labels?: { t: number; text: string }[];
  format: (v: number) => string;
  def: number;
  variant?: 'round' | 'pointer';
}) {
  const start = useRef<{ y: number; pos: number } | null>(null);
  const [active, setActive] = useState(false);
  const steps = options ? options.length - 1 : 20;
  const pos = options ? Math.max(0, options.indexOf(value)) / steps : value / 10;
  const set = (p: number) => {
    const c = Math.min(1, Math.max(0, p));
    if (options) onChange(options[Math.round(c * steps)]);
    else onChange(Math.round(c * steps) / 2);
  };
  const scale =
    labels ??
    (options
      ? options.map((o, i) => ({ t: i / steps, text: short(o) }))
      : Array.from({ length: 11 }, (_, i) => ({ t: i / 10, text: String(i) })));
  const angle = -135 + pos * 270;
  const [ax, ay] = polar(0, 30);
  const [bx, by] = polar(pos, 30);
  const end = () => {
    start.current = null;
    setActive(false);
  };

  return (
    <div className={`pk ${active ? 'active' : ''}`}>
      <div className="pk-caption">{caption}</div>
      <div
        className="pk-dial"
        role="slider"
        tabIndex={0}
        aria-label={caption}
        aria-valuetext={format(value)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = { y: e.clientY, pos };
          setActive(true);
        }}
        onPointerMove={(e) => {
          if (start.current) set(start.current.pos + (start.current.y - e.clientY) / 160);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => onChange(def)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(pos + 1 / steps);
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(pos - 1 / steps);
        }}
      >
        <svg viewBox="-50 -48 100 92" aria-hidden="true">
          {scale.map(({ t, text }) => {
            const [x, y] = polar(t, 41);
            const on = options ? Math.abs(t - pos) < 0.001 : false;
            return (
              <text key={text + t} x={x} y={y} className={`pk-num ${on ? 'on' : ''}`} textAnchor="middle" dominantBaseline="central">
                {text}
              </text>
            );
          })}
          {variant === 'round' && pos > 0.001 && (
            <path d={`M ${ax} ${ay} A 30 30 0 ${pos > 2 / 3 ? 1 : 0} 1 ${bx} ${by}`} className="pk-arc" />
          )}
          <g transform={`rotate(${angle})`}>
            {variant === 'round' ? (
              <>
                <circle r="24" className="pk-knurl" />
                <circle r="17" className="pk-cap" />
                <line x1="0" y1="-8" x2="0" y2="-22" className="pk-pointer" />
              </>
            ) : (
              <>
                <circle r="11" className="pk-cap" />
                <path d="M -7 8 Q 0 13 7 8 L 4.5 -25 Q 0 -28 -4.5 -25 Z" className="pk-chicken" />
                <line x1="0" y1="-4" x2="0" y2="-23" className="pk-pointer" />
              </>
            )}
          </g>
        </svg>
        {active && <span className="pk-tip">{format(value)}</span>}
      </div>
    </div>
  );
}

/** Interruptor de palanca (encendido / apagado), como el del panel. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`pt-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <svg viewBox="-12 -16 24 32" aria-hidden="true">
        <circle r="9" className="pt-toggle-base" />
        <circle r="5" className="pt-toggle-nut" />
        <rect x="-3" y={on ? -15 : 0} width="6" height="15" rx="3" className="pt-toggle-lever" />
      </svg>
    </button>
  );
}

/** Panel de rack: tornillos en las esquinas, palanca a la izquierda, nombre al centro y foco a la derecha. */
export function RackPanel({
  name,
  on,
  onToggle,
  toggleLabel,
  children,
}: {
  name: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  toggleLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`pt-panel ${on ? 'on' : ''}`}>
      <i className="pt-screw tl" />
      <i className="pt-screw tr" />
      <i className="pt-screw bl" />
      <i className="pt-screw br" />
      <div className="pt-head">
        <Toggle on={on} onChange={onToggle} label={toggleLabel} />
        <span className="pt-name">{name}</span>
        <span className={`pt-lamp ${on ? 'on' : ''}`} aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}

/** Sección del panel con su título centrado y una fila de perillas. */
export function RackSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-section">
      <div className="pt-title">{title}</div>
      <div className="pt-row">{children}</div>
    </div>
  );
}
