import { useMemo } from 'react';
import { hz, Knob, lvl, RackPanel, RackSection } from './rack/RackParts';
import { useEq } from '../player/equalizer';
import {
  ATTEN_FREQS,
  HIGH_FREQS,
  LOW_FREQS,
  logFreqs,
  PULTEC_DEFAULT,
  pultecSpecs,
  responseDb,
  type PultecSettings,
} from '../player/pultec';

const CURVE_FREQS = logFreqs(140);
const RANGE = 18; // dB arriba y abajo en la gráfica
const W = 1000;
const H = 160;

function PultecCurve({ p, on }: { p: PultecSettings; on: boolean }) {
  const d = useMemo(() => {
    const db = responseDb(pultecSpecs(p), CURVE_FREQS);
    let path = '';
    db.forEach((v, i) => {
      const x = (i / (db.length - 1)) * W;
      const y = H / 2 - (Math.max(-RANGE, Math.min(RANGE, v)) / RANGE) * (H / 2);
      path += `${i ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    return path;
  }, [p]);
  const xOf = (f: number) => (Math.log(f / 20) / Math.log(1000)) * W;
  return (
    <div className={`pultec-curve ${on ? '' : 'off'}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="pfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.4" />
            <stop offset="0.5" stopColor="var(--accent)" stopOpacity="0.05" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        {[100, 1000, 10000].map((f) => (
          <line key={f} x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} className="eq-zero" />
        ))}
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="eq-zero" />
        <path d={`${d} L ${W} ${H / 2} L 0 ${H / 2} Z`} fill="url(#pfill)" />
        <path d={d} className="eq-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="pultec-axis">
        <span style={{ left: 0 }}>20</span>
        <span style={{ left: `${(xOf(100) / W) * 100}%` }}>100</span>
        <span style={{ left: `${(xOf(1000) / W) * 100}%` }}>1k</span>
        <span style={{ left: `${(xOf(10000) / W) * 100}%` }}>10k</span>
      </div>
      <div className="pultec-db">
        <span>+{RANGE}</span>
        <span>0</span>
        <span>−{RANGE}</span>
      </div>
    </div>
  );
}

/** Ecualizador estilo Pultec EQP-1A, acomodado como un panel de rack: títulos arriba, selectores y perillas con escala. */
export function PultecPanel() {
  const { enabled, pultec: p, setPultec, setEnabled } = useEq();
  const change = (patch: Partial<PultecSettings>) => {
    if (!enabled) setEnabled(true);
    setPultec(patch);
  };

  return (
    <div className="pultec">
      <PultecCurve p={p} on={enabled} />

      <RackPanel name="Program Equalizer" on={enabled} onToggle={setEnabled} toggleLabel="Encender Pultec">
        <RackSection title="Graves">
            <Knob caption="Hz" variant="pointer" value={p.lowFreq} options={LOW_FREQS} format={hz} def={PULTEC_DEFAULT.lowFreq} onChange={(v) => change({ lowFreq: v })} />
            <Knob caption="BOOST" value={p.lowBoost} format={lvl} def={0} onChange={(v) => change({ lowBoost: v })} />
            <Knob caption="ATTEN" value={p.lowAtten} format={lvl} def={0} onChange={(v) => change({ lowAtten: v })} />
        </RackSection>

        <RackSection title="Agudos">
            <Knob caption="kHz" variant="pointer" value={p.highFreq} options={HIGH_FREQS} format={hz} def={PULTEC_DEFAULT.highFreq} onChange={(v) => change({ highFreq: v })} />
            <Knob
              caption="ANCHO"
              value={p.bandwidth}
              labels={[
                { t: 0, text: 'AGUDO' },
                { t: 1, text: 'ANCHO' },
              ]}
              format={(v) => (v <= 2 ? 'Agudo' : v >= 8 ? 'Ancho' : lvl(v))}
              def={PULTEC_DEFAULT.bandwidth}
              onChange={(v) => change({ bandwidth: v })}
            />
            <Knob caption="BOOST" value={p.highBoost} format={lvl} def={0} onChange={(v) => change({ highBoost: v })} />
        </RackSection>

        <RackSection title="Atenuación de agudos">
            <Knob caption="kHz" variant="pointer" value={p.attenFreq} options={ATTEN_FREQS} format={hz} def={PULTEC_DEFAULT.attenFreq} onChange={(v) => change({ attenFreq: v })} />
            <Knob caption="ATTEN" value={p.highAtten} format={lvl} def={0} onChange={(v) => change({ highAtten: v })} />
        </RackSection>
      </RackPanel>

      <div className="pultec-actions">
        <button className="pill" onClick={() => setPultec({ ...PULTEC_DEFAULT })}>
          Restablecer
        </button>
      </div>
      <p className="eq-note">
        Arrastra cada perilla hacia arriba o abajo; doble toque la regresa a su posición inicial. Truco clásico: sube Boost y Atten
        de graves a la vez para unos graves firmes sin embarrar.
      </p>
    </div>
  );
}
