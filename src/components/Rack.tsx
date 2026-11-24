import { create } from 'zustand';
import { closeOverlay, openOverlay } from '../nav';
import { compReduction, currentBpm, ECHO_MODES, useRack, type Division, type EchoMode } from '../player/rack';
import { VuMeter } from './rack/VuMeter';
import { usePlayer } from '../player/player';
import { useReco } from '../reco/store';
import { BackIcon } from './Icons';
import { Knob, lvl, RackPanel, RackSection } from './rack/RackParts';
import { useExit } from './useExit';

/** Abierto el rack, el mini reproductor y la barra de abajo siguen visibles encima (como en el ecualizador). */
export const useRackScreen = create<{ open: boolean }>(() => ({ open: false }));

export function openRack() {
  useRackScreen.setState({ open: true });
  openOverlay(() => useRackScreen.setState({ open: false }));
}

const DIVISIONS: Division[] = [16, 8, 4, 2];

/** Pantalla del rack de efectos: interruptor general y los equipos, con la estética del Pultec. */
export function RackScreen() {
  const open = useRackScreen((s) => s.open);
  const { shown, closing } = useExit(open || null, 220);
  const { enabled, echo, comp, flanger, setEnabled, setEcho, setComp, setFlanger } = useRack();
  // Se vuelve a dibujar al cambiar de canción o al terminar el análisis, para mostrar el tempo correcto.
  usePlayer((s) => s.queue[s.index]);
  useReco((s) => s.analyzed);
  if (!shown) return null;

  const bpm = Math.round(currentBpm());
  const echoOn = enabled && echo.on;
  const change = (patch: Parameters<typeof setEcho>[0]) => {
    if (!enabled) setEnabled(true);
    setEcho({ on: true, ...patch });
  };
  const compOn = enabled && comp.on;
  const changeComp = (patch: Parameters<typeof setComp>[0]) => {
    if (!enabled) setEnabled(true);
    setComp({ on: true, ...patch });
  };
  const flangerOn = enabled && flanger.on;
  const changeFlanger = (patch: Parameters<typeof setFlanger>[0]) => {
    if (!enabled) setEnabled(true);
    setFlanger({ on: true, ...patch });
  };
  const pct = (v: number) => String(Math.round(v * 10));
  const scale100 = Array.from({ length: 11 }, (_, i) => ({ t: i / 10, text: String(i * 10) }));

  return (
    <div className={`eq-screen ${closing ? 'closing' : ''}`}>
      <div className="credits-top">
        <button className="icon-btn" onClick={closeOverlay} aria-label="Atrás">
          <BackIcon />
        </button>
        <span className="eq-title">Rack de efectos</span>
        <button
          className={`switch ${enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={enabled}
          aria-label="Activar rack de efectos"
          onClick={() => setEnabled(!enabled)}
        >
          <span />
        </button>
      </div>

      <div className="eq-body">
        {/* 1) Compresor (primero en la cadena, como en un estudio) */}
        <RackPanel
          name="Spicy Compressor"
          on={compOn}
          onToggle={(v) => {
            if (v && !enabled) setEnabled(true);
            setComp({ on: v });
          }}
          toggleLabel="Encender compresor"
        >
          <VuMeter read={compReduction} on={compOn} />
          <RackSection title="Compresor">
            <Knob caption="GANANCIA" value={comp.gain} labels={scale100} format={pct} def={5} onChange={(v) => changeComp({ gain: v })} />
            <Knob
              caption="MODO"
              variant="pointer"
              value={comp.limit ? 1 : 0}
              options={[0, 1]}
              labels={[
                { t: 0, text: 'COMP' },
                { t: 1, text: 'LIMIT' },
              ]}
              format={(v) => (v ? 'LIMIT' : 'COMP')}
              def={0}
              onChange={(v) => changeComp({ limit: v === 1 })}
            />
            <Knob caption="REDUCCIÓN" value={comp.peak} labels={scale100} format={pct} def={4} onChange={(v) => changeComp({ peak: v })} />
          </RackSection>
        </RackPanel>

        <div className="rack-gap" />

        {/* 2) Flanger de dos vinilos */}
        <RackPanel
          name="JET FLANGER"
          on={flangerOn}
          onToggle={(v) => {
            if (v && !enabled) setEnabled(true);
            setFlanger({ on: v });
          }}
          toggleLabel="Encender flanger"
        >
          <RackSection title="Flanger">
            <Knob caption="CANTIDAD" value={flanger.amount} labels={scale100} format={pct} def={6} onChange={(v) => changeFlanger({ amount: v })} />
          </RackSection>
        </RackPanel>

        <div className="rack-gap" />

        {/* 3) Eco */}
        <RackPanel
          name="SPACE ECO"
          on={echoOn}
          onToggle={(v) => {
            if (v && !enabled) setEnabled(true);
            setEcho({ on: v });
          }}
          toggleLabel="Encender eco"
        >
          <RackSection title="Eco">
            <Knob
              caption="MODO"
              variant="pointer"
              value={echo.mode}
              options={[0, 1, 2, 3]}
              labels={ECHO_MODES.map((name, i) => ({ t: i / 3, text: name }))}
              format={(v) => ECHO_MODES[v] ?? ''}
              def={1}
              onChange={(v) => change({ mode: v as EchoMode })}
            />
            <Knob
              caption="TIEMPO"
              variant="pointer"
              value={echo.division}
              options={DIVISIONS}
              labels={DIVISIONS.map((d, i) => ({ t: i / (DIVISIONS.length - 1), text: `1/${d}` }))}
              format={(v) => `1/${v}`}
              def={8}
              onChange={(v) => change({ division: v as Division })}
            />
            <Knob caption="CANTIDAD" value={echo.amount} format={lvl} def={4} onChange={(v) => change({ amount: v })} />
          </RackSection>
          <div className="rack-tempo">
            <span className={`rack-led ${echoOn ? 'on' : ''}`} /> Tempo de la canción: {bpm} BPM
          </div>
        </RackPanel>

        <p className="eq-note">
          <b>Compresor:</b> sube <b>Reducción</b> hasta que la aguja se mueva unos pocos dB y ajusta <b>Ganancia</b> para recuperar el
          volumen. <b>COMP</b> es suave; <b>LIMIT</b> sujeta más los picos.
        </p>
        <p className="eq-note">
          <b>Flanger:</b> como dos vinilos del mismo disco sonando a la vez, con el pitch de uno moviéndose a pulso. <b>Cantidad</b>{' '}
          en 0 % no se escucha; mientras más alto, más se nota el barrido de "avión que pasa".
        </p>
        <p className="eq-note">
          <b>Slap:</b> una repetición seca. <b>Fatty:</b> racimo de repeticiones que engorda el sonido. <b>Space:</b> repeticiones
          que rebotan de lado a lado y se alejan. <b>Cloud:</b> una nube de ecos difusos. El tiempo sigue el tempo de cada canción.
        </p>
      </div>
    </div>
  );
}
