import { useState } from 'react';
import { create } from 'zustand';
import { closeOverlay, openOverlay } from '../nav';
import { FLAT, useEq } from '../player/equalizer';
import { BandsPanel } from './BandsPanel';
import { BackIcon, CloseIcon, PlusIcon } from './Icons';
import { PultecPanel } from './Pultec';
import { useExit } from './useExit';

/** Abierto el ecualizador, el mini reproductor y la barra de abajo siguen visibles encima. */
export const useEqScreen = create<{ open: boolean }>(() => ({ open: false }));

export function openEqualizer() {
  useEqScreen.setState({ open: true });
  openOverlay(() => useEqScreen.setState({ open: false }));
}


/** Pantalla del ecualizador (teléfono): interruptor, selector Bandas / Pultec y ajustes guardados. */
export function EqualizerScreen() {
  const open = useEqScreen((s) => s.open);
  const { shown, closing } = useExit(open || null, 220);
  const { enabled, setEnabled } = useEq();

  if (!shown) return null;

  return (
    <div className={`eq-screen ${closing ? 'closing' : ''}`}>
      <div className="credits-top">
        <button className="icon-btn" onClick={closeOverlay} aria-label="Atrás">
          <BackIcon />
        </button>
        <span className="eq-title">Ecualizador</span>
        <button
          className={`switch ${enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={enabled}
          aria-label="Activar ecualizador"
          onClick={() => setEnabled(!enabled)}
        >
          <span />
        </button>
      </div>
      <PanelEcualizador />
    </div>
  );
}

/**
 * Lo de adentro del ecualizador: selector Bandas / Pultec, las barras o el Pultec y los ajustes guardados.
 * Va en la pantalla del teléfono y, en PC, directo en Configuración (sin abrir otra ventana).
 */
export function PanelEcualizador() {
  const { enabled, preset, saved, mode, setMode, setEnabled, applyPreset, savePreset, deletePreset } = useEq();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  /** Ajuste que se está por borrar (confirmación dentro de la app, no con confirm() del navegador). */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  return (
    <>
      <div className="eq-modes" role="tablist">
        <button role="tab" aria-selected={mode === 'bands'} className={mode === 'bands' ? 'active' : ''} onClick={() => setMode('bands')}>
          Bandas
        </button>
        <button role="tab" aria-selected={mode === 'pultec'} className={mode === 'pultec' ? 'active' : ''} onClick={() => setMode('pultec')}>
          Pultec
        </button>
      </div>

      <div className="eq-body">
        {mode === 'pultec' ? (
          <PultecPanel />
        ) : (
          <>
        <BandsPanel />

        <h3 className="credits-head">Ajustes</h3>
        <div className="eq-presets">
          {[FLAT, ...saved].map((p) => (
            <span key={p.id} className={`chip eq-chip ${preset === p.id ? 'active' : ''}`}>
              <button
                onClick={() => {
                  applyPreset(p.id);
                  if (!enabled && p.id !== 'flat') setEnabled(true);
                }}
              >
                {p.name}
              </button>
              {p.id !== 'flat' && preset === p.id && (
                <button
                  className="eq-chip-x"
                  aria-label={`Borrar ${p.name}`}
                  onClick={() => setConfirmDel(p.id)}
                >
                  <CloseIcon />
                </button>
              )}
            </span>
          ))}
          <span className={`chip eq-chip ${preset === 'custom' ? 'active' : ''}`}>
            <button
              onClick={() => {
                applyPreset('custom');
                if (!enabled) setEnabled(true);
              }}
            >
              Personalizado
            </button>
          </span>
          <button
            className="chip eq-add"
            aria-label="Guardar ajuste"
            disabled={preset !== 'custom'}
            onClick={() => {
              setName(`Mi ajuste ${saved.length + 1}`);
              setNaming(true);
            }}
          >
            <PlusIcon size={20} />
          </button>
        </div>

        {confirmDel && (
          <div className="eq-save eq-confirm">
            <span>¿Borrar "{saved.find((x) => x.id === confirmDel)?.name}"?</span>
            <button type="button" className="pill" onClick={() => setConfirmDel(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="pill danger"
              onClick={() => {
                deletePreset(confirmDel);
                setConfirmDel(null);
              }}
            >
              Borrar
            </button>
          </div>
        )}
        {naming && (
          <form
            className="eq-save"
            onSubmit={(e) => {
              e.preventDefault();
              savePreset(name);
              setNaming(false);
            }}
          >
            <input
              autoFocus
              value={name}
              maxLength={30}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.target.select()}
              aria-label="Nombre del ajuste"
            />
            <button type="button" className="pill" onClick={() => setNaming(false)}>
              Cancelar
            </button>
            <button type="submit" className="pill primary" disabled={!name.trim()}>
              Guardar
            </button>
          </form>
        )}
        <p className="eq-note">
          {preset === 'custom'
            ? 'Toca + para guardar estas barras con un nombre.'
            : 'Arrastra las barras para crear tu ajuste; luego toca + para guardarlo.'}
        </p>
          </>
        )}
      </div>
    </>
  );
}
