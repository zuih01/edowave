import { create } from 'zustand';
import { closeOverlay, openOverlay } from '../nav';
import { useAutomix } from '../player/automixStore';
import { useVinyl } from '../player/Vinyl';
import { useExit } from './useExit';

/**
 * El modo vinilo y el Automix no pueden estar activados a la vez. Al activar uno con el otro encendido,
 * se pide confirmación y se apaga el otro.
 */
type Mode = 'automix' | 'vinyl';
const useConfirm = create<{ mode: Mode | null }>(() => ({ mode: null }));

/** Activa o desactiva un modo; si choca con el otro, primero pregunta. */
export function toggleMode(mode: Mode) {
  const vinyl = useVinyl.getState();
  const auto = useAutomix.getState();
  if (mode === 'automix') {
    if (auto.on) return auto.set(false);
    if (!vinyl.on) return auto.set(true);
  } else {
    if (vinyl.on) return vinyl.set(false);
    if (!auto.on) return vinyl.set(true);
  }
  useConfirm.setState({ mode });
  openOverlay(() => useConfirm.setState({ mode: null }));
}

function confirm(mode: Mode) {
  // Primero se enciende el nuevo y después se apaga el otro: así la canción sigue sonando sin cortes.
  if (mode === 'automix') {
    useAutomix.getState().set(true);
    useVinyl.getState().set(false);
  } else {
    useVinyl.getState().set(true);
    useAutomix.getState().set(false);
  }
  closeOverlay();
}

export function ModeConfirm() {
  const current = useConfirm((s) => s.mode);
  const { shown: mode, closing } = useExit(current, 180);
  if (!mode) return null;
  const auto = mode === 'automix';
  return (
    <div className={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={closing ? undefined : closeOverlay}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-box">
          <h3>{auto ? '¿Activar Automix?' : '¿Activar el modo vinilo?'}</h3>
          <p>
            El Automix y el modo vinilo no pueden estar activados a la vez.{' '}
            {auto ? 'Al activar el Automix se desactivará el modo vinilo.' : 'Al activar el modo vinilo se desactivará el Automix.'}
          </p>
          <div className="pl-form-buttons">
            <button className="pill" onClick={closeOverlay}>
              Cancelar
            </button>
            <button className="pill primary" onClick={() => confirm(mode)}>
              Activar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
